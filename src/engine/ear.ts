import * as Tone from 'tone';

/**
 * A private listen-only voice for each pattern box. Notes played by the box
 * also ping a short oscillator into an analyser that never reaches the speakers,
 * so the box can show its own waveform.
 */
export class Ear {
  private readonly ears = new Map<string, { gain: Tone.Gain; analyser: Tone.Analyser }>();

  private ensure(id: string) {
    let ear = this.ears.get(id);
    if (!ear) {
      const analyser = new Tone.Analyser('waveform', 256);
      analyser.smoothing = 0;
      const gain = new Tone.Gain(0.8).connect(analyser);
      ear = { gain, analyser };
      this.ears.set(id, ear);
    }
    return ear;
  }

  /** A short tone at `hz`, heard only by this box's scope. */
  ping(id: string, hz: number, time: number, seconds: number) {
    if (!(hz > 20 && hz < 20000) || !(seconds > 0)) return;
    const { gain } = this.ensure(id);
    const osc = new Tone.Oscillator({ frequency: hz, type: 'sawtooth', volume: -8 }).connect(gain);
    const dur = Math.min(1.5, Math.max(0.04, seconds));
    osc.start(time);
    osc.stop(time + dur);
    const wait = Math.max(0, (time + dur + 0.15 - Tone.now()) * 1000);
    window.setTimeout(() => osc.dispose(), wait);
  }

  /** The latest waveform for a box, or null if it has never sounded. */
  wave(id: string): Float32Array | null {
    const ear = this.ears.get(id);
    if (!ear) return null;
    const value = ear.analyser.getValue();
    return value instanceof Float32Array ? value : new Float32Array(value[0] ?? []);
  }

  drop(ids: ReadonlySet<string>) {
    for (const [id, ear] of this.ears) {
      if (ids.has(id)) continue;
      ear.gain.dispose();
      ear.analyser.dispose();
      this.ears.delete(id);
    }
  }
}
