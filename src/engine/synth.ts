import type { Instrument } from './instruments';

// Synth machines: the user-editable instruments. A machine is a small analog
// patch — one oscillator through a resonant low-pass, an ADSR envelope, and a
// choice of polyphony (chords) or monophony (one voice that can glide between
// notes). Machines live in the piece, not the catalog, so a canvas carries its
// own sounds through saves, share links and files. `machineInstrument` dresses
// one up as a catalog entry, which is what lets every existing lookup — block
// labels, pitch stepping, pattern aliases, the playing surfaces — treat it
// like any other instrument.

export type SynthWave = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'fatsawtooth';
export type SynthMode = 'poly' | 'mono';
export const SYNTH_WAVES: SynthWave[] = ['sine', 'triangle', 'square', 'sawtooth', 'fatsawtooth'];

export type SynthPatch = {
  wave: SynthWave;
  /** Low-pass cutoff in Hz. */
  cutoff: number;
  /** Resonance (filter Q). */
  q: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  mode: SynthMode;
  /** Mono only: the slide between consecutive notes, in seconds. 0 is none. */
  glide: number;
  /** Level in dB. */
  gain: number;
};

/** Clamp tables, shared by the piece reader, the deck and the patch editors. */
export const SYNTH_LIMITS = {
  cutoff: [60, 14000] as const,
  q: [0.1, 18] as const,
  attack: [0, 4] as const,
  decay: [0.01, 4] as const,
  sustain: [0, 1] as const,
  release: [0.01, 6] as const,
  glide: [0, 0.5] as const,
  gain: [-30, 0] as const,
};

export const DEFAULT_PATCH: SynthPatch = {
  wave: 'sawtooth',
  cutoff: 2200,
  q: 1.2,
  attack: 0.01,
  decay: 0.25,
  sustain: 0.6,
  release: 0.4,
  mode: 'poly',
  glide: 0.06,
  gain: -8,
};

type PatchInput = Partial<Record<keyof SynthPatch, unknown>>;

const num = (v: unknown, [min, max]: readonly [number, number], fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Every field arrives clamped or defaulted, so a patch from anywhere is safe to hand to the engine. */
export function clampPatch(raw: unknown): SynthPatch {
  const p: PatchInput = typeof raw === 'object' && raw !== null ? (raw as PatchInput) : {};
  const wave = SYNTH_WAVES.find((candidate) => candidate === p.wave) ?? DEFAULT_PATCH.wave;
  const mode: SynthMode = p.mode === 'mono' ? 'mono' : 'poly';
  return {
    wave,
    cutoff: num(p.cutoff, SYNTH_LIMITS.cutoff, DEFAULT_PATCH.cutoff),
    q: num(p.q, SYNTH_LIMITS.q, DEFAULT_PATCH.q),
    attack: num(p.attack, SYNTH_LIMITS.attack, DEFAULT_PATCH.attack),
    decay: num(p.decay, SYNTH_LIMITS.decay, DEFAULT_PATCH.decay),
    sustain: num(p.sustain, SYNTH_LIMITS.sustain, DEFAULT_PATCH.sustain),
    release: num(p.release, SYNTH_LIMITS.release, DEFAULT_PATCH.release),
    mode,
    glide: num(p.glide, SYNTH_LIMITS.glide, DEFAULT_PATCH.glide),
    gain: num(p.gain, SYNTH_LIMITS.gain, DEFAULT_PATCH.gain),
  };
}

/** Starting points for a new machine. The piece copies them, so they stay editable. */
export const PRESETS: { id: string; name: string; hint: string; patch: SynthPatch }[] = [
  {
    id: 'acid',
    name: 'Acid lead',
    hint: 'one squelchy voice that slides between notes. Mono, so chords collapse into the last note.',
    patch: { wave: 'sawtooth', cutoff: 900, q: 8, attack: 0.005, decay: 0.18, sustain: 0.5, release: 0.15, mode: 'mono', glide: 0.05, gain: -10 },
  },
  {
    id: 'pad',
    name: 'Saw pad',
    hint: 'a wide detuned saw that swells in and hangs around. Slow attack, long release.',
    patch: { wave: 'fatsawtooth', cutoff: 1400, q: 1, attack: 0.6, decay: 0.5, sustain: 0.85, release: 1.6, mode: 'poly', glide: 0, gain: -12 },
  },
  {
    id: 'bass',
    name: 'Square bass',
    hint: 'a fat square an octave down that growls when the resonance is up. Mono with a short slide.',
    patch: { wave: 'square', cutoff: 700, q: 4, attack: 0.004, decay: 0.2, sustain: 0.65, release: 0.2, mode: 'mono', glide: 0.03, gain: -6 },
  },
  {
    id: 'pluck',
    name: 'Soft pluck',
    hint: 'a bright hit that dies away like a plucked string. No sustain, so the decay is the note.',
    patch: { wave: 'sawtooth', cutoff: 3200, q: 2, attack: 0.002, decay: 0.14, sustain: 0, release: 0.3, mode: 'poly', glide: 0, gain: -9 },
  },
  {
    id: 'keys',
    name: 'Warm keys',
    hint: 'a mellow triangle that sits behind a melody. Even attack, gentle release.',
    patch: { wave: 'triangle', cutoff: 3000, q: 1, attack: 0.012, decay: 0.6, sustain: 0.4, release: 0.8, mode: 'poly', glide: 0, gain: -8 },
  },
];

export type SynthMachine = {
  id: string;
  name: string;
  /** Under the note name on the block. At most 7 characters. */
  short: string;
  hint: string;
  patch: SynthPatch;
};

const SHORT_MAX = 7;

export function machineShort(name: string): string {
  return name.trim().slice(0, SHORT_MAX);
}

/** The catalog-shaped entry every lookup dispatches on. */
export function machineInstrument(machine: SynthMachine): Instrument {
  return {
    id: machine.id,
    name: machine.name,
    short: machine.short,
    category: 'synths',
    hint: machine.hint,
    pitched: true,
    steps: true,
    voice: 'synth',
    ...machine.patch,
  };
}

/**
 * The cutoff slider runs 0–1 and maps onto the range logarithmically, like the
 * region tone knob, so the low end gets room to move.
 */
export function cutoffHz(t: number): number {
  const [low, high] = SYNTH_LIMITS.cutoff;
  const x = Math.min(1, Math.max(0, t));
  return low * (high / low) ** x;
}

/** The inverse, for showing a slider position from a patch's Hz. */
export function cutoffNorm(hz: number): number {
  const [low, high] = SYNTH_LIMITS.cutoff;
  return Math.min(1, Math.max(0, Math.log(Math.max(low, Math.min(high, hz)) / low) / Math.log(high / low)));
}

export function cutoffLabel(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${Math.round(hz)} Hz`;
}

/**
 * How long one note sounds when nothing else says: a beat, floored and capped
 * so fast patterns stay articulate and slow ones don't drone.
 */
export function synthNoteSeconds(length: number | null, secondsPerBeat: number): number {
  return length ?? Math.min(1.6, Math.max(0.25, secondsPerBeat));
}
