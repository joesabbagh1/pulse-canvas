import * as Tone from 'tone';
import type { Instrument } from './instruments';

// The club kit and the acid bass. The kit is synthesized, so a shared piece
// still carries no samples: a kick is a falling sine plus a click, hats are
// a few mistuned squares, and a closed hat cuts the open one short. The acid
// bass is one saw into a resonant filter. A louder accent opens that filter,
// and a note that arrives while the previous one is still held glides to it.

type MachineInstrument = Instrument & { voice: 'machine' };
type AcidInstrument = Instrument & { voice: 'acid' };

/** The kick's body, in Hz. A note around middle C is dropped two octaves, the way the plain kick is. */
export function kickBodyHz(hz: number): number {
  if (!(hz > 0)) return 49;
  const fundamental = hz >= 100 ? hz / 4 : hz;
  return Math.min(80, Math.max(36, fundamental));
}

/** Where the kick's pitch starts, before it falls to the body. */
export function kickStartHz(body: number): number {
  return Math.min(240, Math.max(80, body * 3.4));
}

/**
 * The acid filter for one note. An accent opens it and raises the resonance;
 * the note's pitch pulls the cutoff along, so a higher note is a little brighter.
 */
export function acidTone(hz: number, velocity: number, accent: boolean): { cutoff: number; q: number } {
  const vel = Math.min(1, Math.max(0, velocity));
  const open = accent ? 1 : 0.18 + vel * 0.22;
  const tracked = Math.max(40, hz);
  const cutoff = Math.min(6800, (150 + open * 4600) * Math.pow(tracked / 110, 0.42));
  const q = 2.5 + open * 9.5;
  return { cutoff, q };
}

/** True when `time` falls inside a note that has not been let go yet. That is a slide. */
export function acidSlides(heldUntil: number, time: number): boolean {
  return heldUntil > time + 0.012;
}

const HAT_PARTIALS = [987, 1481, 2113, 2797];

interface Held {
  drop(): void;
}

function heardHz(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function later(time: number, fn: () => void) {
  const wait = Math.max(0.05, time - Tone.now() + 0.08);
  Tone.getContext().setTimeout(fn, wait);
}

/** One drum machine for a bus. Hits that overlap in the lookahead each get their own envelope. */
export class MachineKit {
  private kickDrive: Tone.Distortion;
  private clickFilter: Tone.Filter;
  private hatFilter: Tone.Filter;
  private clapFilter: Tone.Filter;
  private openChoke: Tone.Gain | null = null;
  private gates: Tone.AmplitudeEnvelope[] = [];
  private live: Held[] = [];

  constructor(private output: Tone.InputNode) {
    this.kickDrive = new Tone.Distortion({ distortion: 0.38, wet: 1, oversample: '2x' }).connect(output);
    this.clickFilter = new Tone.Filter({ type: 'highpass', frequency: 1800, Q: 0.6 }).connect(this.kickDrive);
    this.hatFilter = new Tone.Filter({ type: 'highpass', frequency: 4200, Q: 0.7 }).connect(output);
    this.clapFilter = new Tone.Filter({ type: 'bandpass', frequency: 1200, Q: 0.8 }).connect(output);
  }

  hit(inst: MachineInstrument, hz: number, time: number, velocity: number) {
    const vel = Math.min(1, Math.max(0, velocity));
    if (!(vel > 0)) return;
    switch (inst.hit) {
      case 'kick':
        this.hitKick(hz, time, vel, inst.gain);
        break;
      case 'hat':
        this.choke(time);
        this.hitHat(false, time, vel, inst.gain);
        break;
      case 'open':
        this.choke(time);
        this.hitHat(true, time, vel, inst.gain);
        break;
      case 'clap':
        this.hitClap(time, vel, inst.gain);
        break;
      case 'rim':
        this.hitRim(time, vel, inst.gain);
        break;
    }
  }

  /** Let go of anything still ringing, for when playback stops. */
  silence(time: number) {
    this.choke(time);
    for (const env of this.gates) {
      try {
        env.triggerRelease(time);
      } catch {
        // The envelope is already on its way out.
      }
    }
  }

  dispose() {
    this.silence(Tone.now());
    for (const held of this.live) held.drop();
    this.live = [];
    this.gates = [];
    this.kickDrive.dispose();
    this.clickFilter.dispose();
    this.hatFilter.dispose();
    this.clapFilter.dispose();
  }

  private hitKick(hz: number, time: number, velocity: number, gain: number) {
    const body = kickBodyHz(hz);
    const start = kickStartHz(body);
    const env = this.envelope(this.kickDrive, 0.001, 0.42, 0.05, gain, time + 0.55);
    const osc = new Tone.Oscillator({ type: 'sine', frequency: start }).connect(env);
    osc.frequency.setValueAtTime(start, time);
    osc.frequency.exponentialRampToValueAtTime(body, time + 0.055);
    osc.start(time);
    osc.stop(time + 0.5);
    env.triggerAttackRelease(0.45, time, velocity);
    this.watch(env, time + 0.55);
    this.keep(osc, time + 0.55);
    this.noise(this.clickFilter, time, 0.012, velocity * 0.85, gain - 4);
  }

  private hitHat(open: boolean, time: number, velocity: number, gain: number) {
    const decay = open ? 0.36 : 0.032;
    const choke = open ? new Tone.Gain(1).connect(this.hatFilter) : null;
    const dest = choke ?? this.hatFilter;
    const env = this.envelope(dest, 0.001, decay, Math.min(0.05, decay), gain, time + decay + 0.08);
    // Several squares sum, so each one is only its share of the hit.
    const mix = new Tone.Gain(1 / HAT_PARTIALS.length).connect(env);
    this.keep(mix, time + decay + 0.08);
    for (const freq of HAT_PARTIALS) {
      const osc = new Tone.Oscillator({ type: 'square', frequency: freq }).connect(mix);
      osc.start(time);
      osc.stop(time + decay + 0.06);
      this.keep(osc, time + decay + 0.08);
    }
    env.triggerAttackRelease(decay, time, velocity);
    this.watch(env, time + decay + 0.08);
    if (choke) {
      this.openChoke = choke;
      this.hold(() => {
        if (this.openChoke === choke) this.openChoke = null;
        choke.dispose();
      }, time + decay + 0.1);
    }
    this.noise(dest, time, Math.min(0.04, decay), velocity * 0.45, gain - 8);
  }

  private hitClap(time: number, velocity: number, gain: number) {
    for (const delay of [0, 0.011, 0.022]) this.noise(this.clapFilter, time + delay, 0.02, velocity * (delay ? 0.65 : 1), gain);
    this.noise(this.clapFilter, time + 0.03, 0.15, velocity * 0.8, gain - 3);
  }

  private hitRim(time: number, velocity: number, gain: number) {
    for (const [freq, decay, down] of [
      [455, 0.045, 0],
      [1680, 0.018, 6],
    ] as const) {
      const env = this.envelope(this.output, 0.001, decay, 0.012, gain - down, time + decay + 0.06);
      const osc = new Tone.Oscillator({ type: 'sine', frequency: freq }).connect(env);
      osc.start(time);
      osc.stop(time + decay + 0.04);
      env.triggerAttackRelease(decay, time, velocity);
      this.watch(env, time + decay + 0.06);
      this.keep(osc, time + decay + 0.06);
    }
  }

  /** The next closed hat, or a new open one, shuts the open hat that is still ringing. */
  private choke(time: number) {
    const choke = this.openChoke;
    this.openChoke = null;
    if (!choke) return;
    try {
      const gain = choke.gain;
      gain.cancelScheduledValues(time);
      gain.setValueAtTime(Math.max(0.0001, gain.getValueAtTime(time)), time);
      gain.linearRampToValueAtTime(0.0001, time + 0.012);
    } catch {
      // The open hat has already been torn down.
    }
  }

  private noise(dest: Tone.InputNode, time: number, decay: number, velocity: number, gain: number) {
    const env = this.envelope(dest, 0.001, decay, Math.min(0.04, Math.max(0.008, decay)), gain, time + decay + 0.08);
    const noise = new Tone.Noise('white').connect(env);
    noise.start(time);
    noise.stop(time + decay + 0.05);
    env.triggerAttackRelease(Math.max(0.012, decay), time, Math.min(1, velocity));
    this.watch(env, time + decay + 0.08);
    this.keep(noise, time + decay + 0.08);
  }

  private envelope(dest: Tone.InputNode, attack: number, decay: number, release: number, gainDb: number, until: number) {
    const level = new Tone.Gain(Tone.dbToGain(gainDb)).connect(dest);
    this.keep(level, until);
    return new Tone.AmplitudeEnvelope({ attack, decay, sustain: 0, release }).connect(level);
  }

  private watch(env: Tone.AmplitudeEnvelope, until: number) {
    this.gates.push(env);
    this.hold(() => {
      this.gates = this.gates.filter((item) => item !== env);
      env.dispose();
    }, until);
  }

  private keep(node: { dispose(): void }, until: number) {
    this.hold(() => node.dispose(), until);
  }

  private hold(dispose: () => void, until: number) {
    let gone = false;
    const held: Held = {
      drop() {
        if (gone) return;
        gone = true;
        dispose();
      },
    };
    this.live.push(held);
    later(until, () => {
      this.live = this.live.filter((item) => item !== held);
      held.drop();
    });
  }
}

/** One monophonic bass for a bus. The oscillator stays running; the gate does the note. */
export class AcidVoice {
  private osc: Tone.Oscillator;
  private gate: Tone.Gain;
  private filter: Tone.Filter;
  private level: Tone.Gain;
  private started = false;
  /** Audio time the current note's gate lets go. Infinity while a key is held. */
  private heldUntil = 0;

  constructor(output: Tone.InputNode) {
    this.level = new Tone.Gain(1).connect(output);
    this.filter = new Tone.Filter({ type: 'lowpass', rolloff: -24, Q: 6, frequency: 280 }).connect(this.level);
    this.gate = new Tone.Gain(0).connect(this.filter);
    this.osc = new Tone.Oscillator({ type: 'sawtooth', frequency: 110 }).connect(this.gate);
  }

  play(inst: AcidInstrument, hz: number, time: number, velocity: number, length: number | null, secondsPerBeat: number, accent: boolean) {
    if (this.osc.type !== inst.wave) this.osc.type = inst.wave;
    const dur = Math.max(0.04, length ?? Math.min(0.45, secondsPerBeat * 0.5));
    this.sound(hz, time, velocity, accent, time + dur, inst.gain);
  }

  /** A live note. A firm press is the accent. Letting go is the caller's job. */
  hold(hz: number, time: number, velocity: number, gain = -8): { release(time: number): void } {
    this.sound(hz, time, velocity, velocity >= 0.85, null, gain);
    return { release: (at) => this.release(at) };
  }

  silence(time: number) {
    this.release(time);
    this.heldUntil = 0;
  }

  dispose() {
    if (this.started) {
      try {
        this.osc.stop();
      } catch {
        // Already stopped.
      }
    }
    this.osc.dispose();
    this.gate.dispose();
    this.filter.dispose();
    this.level.dispose();
  }

  private sound(hz: number, time: number, velocity: number, accent: boolean, end: number | null, gain: number) {
    const vel = Math.min(1, Math.max(0, velocity));
    if (!(hz > 20) || !(vel > 0)) return;
    const slide = acidSlides(this.heldUntil, time);
    if (!this.started) {
      this.osc.start(time);
      this.started = true;
    }
    this.level.gain.setValueAtTime(Tone.dbToGain(gain), time);
    this.glide(Math.max(20, hz), time, slide, end ?? time + 0.4);
    this.shapeFilter(hz, time, vel, accent, end ?? time + 0.25);
    this.shapeGate(time, end, slide, vel, accent);
    this.heldUntil = end ?? Number.POSITIVE_INFINITY;
  }

  private release(time: number) {
    this.heldUntil = time;
    const gain = this.gate.gain;
    gain.cancelScheduledValues(time);
    gain.setValueAtTime(Math.max(0.0001, gain.getValueAtTime(time)), time);
    gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
  }

  private glide(hz: number, time: number, slide: boolean, end: number) {
    const freq = this.osc.frequency;
    freq.cancelScheduledValues(time);
    if (!slide) {
      freq.setValueAtTime(hz, time);
      return;
    }
    freq.setValueAtTime(heardHz(freq.getValueAtTime(time), hz), time);
    const glide = Math.min(0.08, Math.max(0.025, (end - time) * 0.45));
    freq.exponentialRampToValueAtTime(hz, time + glide);
  }

  private shapeFilter(hz: number, time: number, velocity: number, accent: boolean, end: number) {
    const { cutoff, q } = acidTone(hz, velocity, accent);
    const freq = this.filter.frequency;
    freq.cancelScheduledValues(time);
    freq.setValueAtTime(heardHz(freq.getValueAtTime(time), 280), time);
    freq.exponentialRampToValueAtTime(cutoff, time + 0.015);
    const tailAt = Math.max(time + 0.05, Math.min(end, time + 0.22));
    if (tailAt > time + 0.03) freq.exponentialRampToValueAtTime(Math.max(90, cutoff * (accent ? 0.42 : 0.55)), tailAt);
    this.filter.Q.cancelScheduledValues(time);
    this.filter.Q.setValueAtTime(q, time);
  }

  private shapeGate(time: number, end: number | null, slide: boolean, velocity: number, accent: boolean) {
    const gain = this.gate.gain;
    const peak = Math.min(0.9, (accent ? 0.85 : 0.55) * (0.35 + 0.65 * velocity));
    gain.cancelScheduledValues(time);
    gain.setValueAtTime(slide ? Math.max(0.0001, gain.getValueAtTime(time)) : 0.0001, time);
    gain.linearRampToValueAtTime(Math.max(0.0001, peak), time + (slide ? 0.012 : 0.005));
    if (end === null) return;
    const holdAt = Math.max(time + 0.02, end);
    gain.setValueAtTime(Math.max(0.0001, peak), holdAt);
    gain.exponentialRampToValueAtTime(0.0001, holdAt + 0.06);
  }
}
