// The viz stage reads the same side-taps the scope uses (see engine/mixer.ts):
// a waveform in -1..1 and an FFT in decibels. Everything here is math on those
// two arrays — no Tone nodes, no audio context — so it runs in tests and can
// never disturb playback. One VizEar per stage keeps the histories (flux
// baseline, pitch histogram, envelopes) between frames.

export interface VizFrame {
  /** Smoothed loudness, 0..1, with a fast attack and a slow release. */
  rms: number;
  /** The raw peak of this frame's waveform, 0..1. */
  peak: number;
  /** Band energies, 0..1: low, mid and high of the mix right now. */
  bass: number;
  mid: number;
  treble: number;
  /** Spectral brightness, 0..1 (where the spectrum's centre of mass sits). */
  centroid: number;
  /** Spectral flux this frame: how much the spectrum grew, 0..1. */
  flux: number;
  /** A decaying envelope that jumps to 1 on a detected onset. */
  onset: number;
  /** How many onsets have been detected, ever. */
  onsetCount: number;
  /** The loudest partial's pitch class, 0..11, held over a few frames. Null when nothing pitched is loud. */
  pitchClass: number | null;
  /** A copy of the waveform, -1..1. Zeros when nothing is playing. */
  wave: Float32Array;
  /** The FFT as normalized magnitudes, 0..1, low to high. Empty when nothing is playing. */
  bands: Float32Array;
  /** True when nothing at all is coming through. */
  silent: boolean;
}

const dB = (db: number) => Math.min(1, Math.max(0, (db + 78) / 66));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** An envelope that rises quickly and falls slowly, so peaks feel punchy. */
function envelope(previous: number, target: number, dt: number, attack: number, release: number) {
  const k = target > previous ? 1 - Math.exp(-dt / attack) : 1 - Math.exp(-dt / release);
  return previous + (target - previous) * k;
}

export class VizEar {
  private wave: Float32Array = new Float32Array(0);
  private bands: Float32Array = new Float32Array(0);
  private previous: Float32Array = new Float32Array(0);
  private fluxHistory: number[] = [];
  private rms = 0;
  private centroid = 0.4;
  private onsetEnv = 0;
  private lastOnsetAt = -1;
  private onsets = 0;
  private pitchVotes = new Float32Array(12);
  private pitchClass: number | null = null;
  private frames = 0;

  constructor(
    /** The audio context's rate, so band edges and pitch land on real frequencies. */
    private sampleRate = 48000,
  ) {}

  /** Folds the mixer's latest taps into the running picture. Null taps (audio not started) read as silence. */
  update(wave: Float32Array | null, bands: Float32Array | null, dt: number): VizFrame {
    this.frames += 1;

    // Waveform: copy so the analyser's own buffer can't change under a mode mid-draw.
    if (wave && wave.length) {
      if (this.wave.length !== wave.length) this.wave = new Float32Array(wave.length);
      this.wave.set(wave);
    } else if (this.wave.length) {
      this.wave.fill(0);
    }

    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < this.wave.length; i++) {
      const v = this.wave[i];
      sumSquares += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rawRms = this.wave.length ? Math.sqrt(sumSquares / this.wave.length) : 0;
    this.rms = envelope(this.rms, rawRms, dt, 0.03, 0.35);

    // Spectrum: normalized magnitudes, plus the three band averages the modes think in.
    const n = bands?.length ?? 0;
    if (n && n !== this.bands.length) {
      this.bands = new Float32Array(n);
      this.previous = new Float32Array(n);
    }
    if (n) {
      for (let i = 0; i < n; i++) this.bands[i] = dB(bands![i]);
    } else if (this.bands.length) {
      this.bands.fill(0);
    }
    const binHz = n ? this.sampleRate / 2 / n : 0;
    const bandEdge = (hz: number) => (binHz ? clamp(Math.round(hz / binHz), 0, n) : 0);
    const bassEnd = bandEdge(260);
    const midEnd = bandEdge(2000);
    const trebleEnd = bandEdge(8000);
    const average = (from: number, to: number) => {
      if (to <= from) return 0;
      let sum = 0;
      for (let i = from; i < to; i++) sum += this.bands[i];
      return sum / (to - from);
    };
    const bass = average(0, bassEnd);
    const mid = average(bassEnd, midEnd);
    const treble = average(midEnd, trebleEnd);

    // Brightness: the spectrum's centre of mass, over everything below 8 kHz.
    let weighted = 0;
    let total = 0;
    for (let i = 0; i < trebleEnd; i++) {
      weighted += this.bands[i] * i;
      total += this.bands[i];
    }
    if (total > 0.4) this.centroid = clamp(weighted / total / Math.max(1, trebleEnd - 1), 0, 1);
    else this.centroid = envelope(this.centroid, 0.35, dt, 0.2, 0.8);

    // Onsets: spectral flux against an adaptive baseline. A hit is any frame
    // whose growth stands well clear of the recent average, at most every 90 ms.
    let flux = 0;
    if (n) {
      let grew = 0;
      for (let i = 0; i < n; i++) {
        const d = this.bands[i] - this.previous[i];
        if (d > 0) grew += d;
      }
      flux = clamp(grew / Math.max(1, n), 0, 1);
      this.previous.set(this.bands);
    }
    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > 43) this.fluxHistory.shift();
    const mean = this.fluxHistory.reduce((a, b) => a + b, 0) / this.fluxHistory.length;
    const variance = this.fluxHistory.reduce((a, b) => a + (b - mean) ** 2, 0) / this.fluxHistory.length;
    const spread = Math.sqrt(variance);
    const at = this.frames;
    const isOnset = flux > 0.012 && flux > mean + 1.7 * spread && at - this.lastOnsetAt > 3;
    if (isOnset) {
      this.lastOnsetAt = at;
      this.onsets += 1;
    }
    const spike = isOnset ? clamp(0.45 + flux * 4, 0.45, 1) : 0;
    this.onsetEnv = Math.max(this.onsetEnv * Math.exp(-dt / 0.16), spike);

    // Pitch: the strongest partial between 80 Hz and 4 kHz, voted into a
    // histogram that forgets slowly, so the class holds through vibrato.
    let pitchClass = this.pitchClass;
    if (n) {
      const lo = bandEdge(80);
      const hi = bandEdge(4000);
      let bestBin = -1;
      let best = 0.3;
      for (let i = lo; i < hi; i++) {
        if (this.bands[i] > best) {
          best = this.bands[i];
          bestBin = i;
        }
      }
      if (bestBin >= 0) {
        const hz = (bestBin + 0.5) * binHz;
        const midi = 69 + 12 * Math.log2(hz / 440);
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        for (let i = 0; i < 12; i++) this.pitchVotes[i] *= 0.82;
        this.pitchVotes[pc] += 1;
        let winner = 0;
        for (let i = 1; i < 12; i++) if (this.pitchVotes[i] > this.pitchVotes[winner]) winner = i;
        if (this.pitchVotes[winner] > 1.2) pitchClass = winner;
      }
    }
    this.pitchClass = pitchClass;

    const silent = rawRms < 0.004 && bass + mid + treble < 0.005;

    return {
      rms: this.rms,
      peak,
      bass,
      mid,
      treble,
      centroid: this.centroid,
      flux,
      onset: this.onsetEnv,
      onsetCount: this.onsets,
      pitchClass,
      wave: this.wave,
      bands: this.bands,
      silent,
    };
  }
}
