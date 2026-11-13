import { PX_PER_BEAT, linkBeats, type XY } from './geometry';

// A wave is a drawing. A cycle is one period of the oscillator; a motion loops
// in beats and bends the filter. In both, width runs left to right and up is
// positive. 72px above the baseline is full scale.

export const WAVE_AMP = 72;
export const WAVE_SAMPLES = 256;
export const MAX_PARTIALS = 64;
export const MAX_WAVE_POINTS = 64;
export const MIN_WAVE_WIDTH = 16;
/** How far a full-scale motion (±1) pushes the region's tone slider. */
export const MOTION_DEPTH = 0.5;

export type WaveRole = 'cycle' | 'motion';

export interface Wave {
  id: string;
  role: WaveRole;
  points: XY[];
  /**
   * Instrument this drawing sounds on. Absent means the region: a cycle
   * replaces Tone, and a cutoff bends the filter everything in the region shares.
   */
  instrument?: string;
}

export type Stamp = 'saw' | 'square' | 'sine' | 'decay';

export interface WaveBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
}

export interface Partials {
  real: Float32Array;
  imag: Float32Array;
}

export interface MotionCurve {
  samples: number[];
  beats: number;
}

/** A cycle and the cutoff motions aimed at one instrument. */
export interface InstrumentProgram {
  cycle: Partials | null;
  motions: MotionCurve[];
}

export interface BusWaves {
  /** The cycle that replaces Tone. Null when the region has no untargeted cycle. */
  cycle: Partials | null;
  /** Cutoff motions for the whole region. Instrument motions are not in here. */
  motions: MotionCurve[];
  /** Keyed by instrument id. The last cycle for that instrument is the one that sounds. */
  instruments: Map<string, InstrumentProgram>;
}

export const EMPTY_BUS_WAVES: BusWaves = { cycle: null, motions: [], instruments: new Map() };

export function waveBounds(points: readonly XY[]): WaveBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY, width: points.length ? maxX - minX : 0 };
}

/** The middle of the drawing, which decides which region it belongs to. */
export function waveCenter(points: readonly XY[]): XY {
  const b = waveBounds(points);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** The horizontal line values bend around: halfway between the two ends. */
export function baselineY(points: readonly XY[]): number {
  if (!points.length) return 0;
  return (points[0].y + points[points.length - 1].y) / 2;
}

/**
 * The drawing's y at `x`. Segments are walked in order and later ones win, so
 * a stroke that crosses itself keeps the part drawn last.
 */
export function polylineY(points: readonly XY[], x: number): number {
  let y = points[0]?.y ?? 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    if (dx === 0) {
      if (a.x === x) y = b.y;
      continue;
    }
    const t = (x - a.x) / dx;
    if (t >= 0 && t <= 1) y = a.y + t * (b.y - a.y);
  }
  return y;
}

/** One left-to-right pass, about −1..1. Up on the canvas is positive. Null when the drawing is too narrow to be a wave. */
export function sampleWave(points: readonly XY[], n = WAVE_SAMPLES): number[] | null {
  if (points.length < 2) return null;
  const { minX, width } = waveBounds(points);
  if (width < MIN_WAVE_WIDTH) return null;
  const base = baselineY(points);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((base - polylineY(points, minX + (i / n) * width)) / WAVE_AMP);
  return out;
}

/** `phase` is 0..1 around the sampled wave. */
export function samplePhase(samples: readonly number[], phase: number): number {
  const n = samples.length;
  if (!n) return 0;
  const wrapped = ((phase % 1) + 1) % 1;
  const x = wrapped * n;
  const i = Math.floor(x) % n;
  const t = x - Math.floor(x);
  return samples[i] * (1 - t) + samples[(i + 1) % n] * t;
}

/** A motion's loop, in beats: its width, snapped the same way a link's length is. */
export function motionBeats(points: readonly XY[], snap: boolean): number {
  return linkBeats(waveBounds(points).width, snap);
}

export function motionValue(samples: readonly number[], beats: number, beat: number): number {
  if (beats <= 0 || !samples.length) return 0;
  const phase = (((beat % beats) + beats) % beats) / beats;
  return samplePhase(samples, phase);
}

export function motionSum(motions: readonly MotionCurve[], beat: number): number {
  let sum = 0;
  for (const m of motions) sum += motionValue(m.samples, m.beats, beat);
  return sum;
}

/** The tone-slider value after motions push it. 0 is dark, 1 is open. */
export function movedTone(base: number, motion: number): number {
  return Math.min(1, Math.max(0, base + motion * MOTION_DEPTH));
}

/** Sine/cosine harmonics of one cycle, DC removed. Bin 0 is unused. */
export function wavePartials(samples: readonly number[], harmonics = MAX_PARTIALS): Partials {
  const n = samples.length;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  if (!n) return { real, imag };
  let dc = 0;
  for (const s of samples) dc += s;
  dc /= n;
  for (let h = 1; h <= harmonics; h++) {
    let re = 0;
    let im = 0;
    for (let k = 0; k < n; k++) {
      const s = samples[k] - dc;
      const angle = (2 * Math.PI * h * k) / n;
      re += s * Math.cos(angle);
      im += s * Math.sin(angle);
    }
    real[h] = (2 * re) / n;
    imag[h] = (2 * im) / n;
  }
  return { real, imag };
}

/** Region bus, or that bus plus an instrument, so two cycles can both sound. */
function waveTarget(region: string, instrument?: string) {
  return instrument ? `${region}/${instrument}` : region;
}

/**
 * Waves whose centre falls in the same place share a bus. `regionOf` returns
 * the region id, or undefined for the canvas. A drawing aimed at an instrument
 * stays off the shared tone and the shared filter. The last cycle on a target
 * is the one that sounds; motions on the same target add together.
 */
export function compileWaves(waves: readonly Wave[], regionOf: (at: XY) => string | undefined, snap: boolean): Map<string, BusWaves> {
  const map = new Map<string, BusWaves>();
  const bus = (id: string) => {
    let found = map.get(id);
    if (!found) map.set(id, (found = { cycle: null, motions: [], instruments: new Map() }));
    return found;
  };
  const bucket = (entry: BusWaves, instrument?: string): InstrumentProgram => {
    if (!instrument) return entry;
    let found = entry.instruments.get(instrument);
    if (!found) entry.instruments.set(instrument, (found = { cycle: null, motions: [] }));
    return found;
  };
  for (const wave of waves) {
    const samples = sampleWave(wave.points);
    if (!samples) continue;
    const entry = bus(regionOf(waveCenter(wave.points)) ?? '');
    const target = bucket(entry, wave.instrument);
    if (wave.role === 'cycle') target.cycle = wavePartials(samples);
    else target.motions.push({ samples, beats: motionBeats(wave.points, snap) });
  }
  return map;
}

/** The cycle you hear on each target: the last one wide enough to be a wave. */
export function heardCycleIds(waves: readonly Wave[], regionOf: (at: XY) => string | undefined): Set<string> {
  const heard = new Map<string, string>();
  for (const wave of waves) {
    if (wave.role !== 'cycle' || !sampleWave(wave.points)) continue;
    heard.set(waveTarget(regionOf(waveCenter(wave.points)) ?? '', wave.instrument), wave.id);
  }
  return new Set(heard.values());
}

/** Drop points that sit on top of each other, and keep at most `max`. */
export function simplifyStroke(points: readonly XY[], minDist = 8, max = MAX_WAVE_POINTS): XY[] {
  if (!points.length) return [];
  const kept: XY[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const last = kept[kept.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) kept.push(p);
  }
  if (points.length > 1) {
    const end = points[points.length - 1];
    const last = kept[kept.length - 1];
    if (Math.hypot(end.x - last.x, end.y - last.y) > 0.5) kept.push(end);
  }
  if (kept.length <= max) return kept;
  return Array.from({ length: max }, (_, i) => kept[Math.round((i * (kept.length - 1)) / (max - 1))]);
}

/** A starting shape, centred on `at`. Saw, square and sine are cycles; decay is a cutoff motion two beats long. */
export function stampOf(kind: Stamp, at: XY): { role: WaveRole; points: XY[] } {
  const amp = WAVE_AMP * 0.92;
  const width = kind === 'decay' ? PX_PER_BEAT * 2 : PX_PER_BEAT * 1.25;
  const x0 = at.x - width / 2;
  const y = at.y;
  if (kind === 'saw') {
    return { role: 'cycle', points: [{ x: x0, y: y - amp }, { x: x0 + width, y: y + amp }] };
  }
  if (kind === 'square') {
    return {
      role: 'cycle',
      points: [
        { x: x0, y: y - amp },
        { x: x0 + width / 2, y: y - amp },
        { x: x0 + width / 2, y: y + amp },
        { x: x0 + width, y: y + amp },
      ],
    };
  }
  if (kind === 'sine') {
    // Eight steps is still one harmonic, and each point is far enough apart to grab.
    const n = 8;
    return {
      role: 'cycle',
      points: Array.from({ length: n + 1 }, (_, i) => {
        const t = i / n;
        return { x: x0 + t * width, y: y - Math.sin(t * Math.PI * 2) * amp };
      }),
    };
  }
  // Opens on the downbeat and falls shut. Points bunch up where the fall is steep.
  const k = 4.5;
  const settle = 1 - Math.exp(-k);
  const times = [0, 0.05, 0.12, 0.22, 0.4, 0.7, 1];
  return {
    role: 'motion',
    points: times.map((t) => {
      const v = 1 - (2 * (1 - Math.exp(-k * t))) / settle;
      return { x: x0 + t * width, y: y - v * amp };
    }),
  };
}

export function busWavesKey(program: ReadonlyMap<string, BusWaves>): string {
  const parts: unknown[] = [];
  for (const id of [...program.keys()].sort()) {
    const bus = program.get(id)!;
    const aimed = [...bus.instruments.keys()].sort().map((instrument) => {
      const program = bus.instruments.get(instrument)!;
      return [instrument, program.cycle ? [Array.from(program.cycle.real), Array.from(program.cycle.imag)] : null, program.motions];
    });
    parts.push(id, bus.cycle ? [Array.from(bus.cycle.real), Array.from(bus.cycle.imag)] : null, bus.motions, aimed);
  }
  return JSON.stringify(parts);
}
