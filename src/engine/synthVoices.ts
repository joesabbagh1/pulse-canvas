import * as Tone from 'tone';
import type { Instrument } from './instruments';
import type { NoteGate } from './holds';
import { synthNoteSeconds } from './synth';

// The synth machines' voices, one SynthMachineVoices per mixer bus. A poly
// machine is a shared PolySynth through its own resonant low-pass, so chords
// work. A mono machine keeps one oscillator running (like the acid bass) and
// lets the gate and the pitch param do the note, which is what makes a glide
// between consecutive notes possible. Patch changes are picked up lazily: the
// next note applies the new shape, so a running loop shifts without a click.

type SynthInstrument = Instrument & { voice: 'synth' };

/** One machine's patch shape; compared between notes so a running machine only updates on a real change. */
function patchKey(inst: SynthInstrument): string {
  return `${inst.wave}|${inst.cutoff}|${inst.q}|${inst.attack}|${inst.decay}|${inst.sustain}|${inst.release}|${inst.glide}|${inst.gain}`;
}

function atTime(
  param: { cancelScheduledValues(time: number): void; setValueAtTime(value: number, time: number): void },
  value: number,
  time: number,
) {
  if (!Number.isFinite(value) || !Number.isFinite(time)) return;
  param.cancelScheduledValues(time);
  param.setValueAtTime(value, time);
}

/** The oscillator's frequency right now, or the fallback when nothing is scheduled yet. */
function heardHz(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

class PolyMachine {
  readonly synth: Tone.PolySynth;
  private readonly filter: Tone.Filter;
  private readonly level: Tone.Gain;
  private key = '';

  constructor(output: Tone.InputNode, inst: SynthInstrument) {
    this.level = new Tone.Gain(Tone.dbToGain(inst.gain)).connect(output);
    this.filter = new Tone.Filter({ type: 'lowpass', rolloff: -24, frequency: inst.cutoff, Q: inst.q }).connect(this.level);
    this.synth = new Tone.PolySynth(Tone.Synth, {
      envelope: { attack: inst.attack, decay: inst.decay, sustain: inst.sustain, release: inst.release },
    }).connect(this.filter);
    this.synth.maxPolyphony = 24;
    // The wave goes on through set(): the inner voices use omnic oscillators,
    // which understand the fat types the constructor options don't.
    this.update(inst, 0);
  }

  private update(inst: SynthInstrument, time: number) {
    const key = patchKey(inst);
    if (key === this.key) return;
    this.key = key;
    this.synth.set({
      oscillator: { type: inst.wave },
      envelope: { attack: inst.attack, decay: inst.decay, sustain: inst.sustain, release: inst.release },
    });
    atTime(this.filter.frequency, inst.cutoff, time);
    atTime(this.filter.Q, inst.q, time);
    atTime(this.level.gain, Tone.dbToGain(inst.gain), time);
  }

  play(inst: SynthInstrument, hz: number, time: number, velocity: number, duration: number) {
    this.update(inst, time);
    this.synth.triggerAttackRelease(hz, duration, time, Math.min(1, velocity));
  }

  hold(inst: SynthInstrument, hz: number, time: number, velocity: number): NoteGate {
    this.update(inst, time);
    this.synth.triggerAttack(hz, time, Math.min(1, velocity));
    return { release: (at) => this.synth.triggerRelease(hz, at) };
  }

  silence(time: number) {
    this.synth.releaseAll(time);
  }

  dispose() {
    this.synth.dispose();
    this.filter.dispose();
    this.level.dispose();
  }
}

/** One monophonic machine. The oscillator stays running; the gate does the note. */
class MonoMachine {
  /** An omnic oscillator, so mono machines can be fat too. */
  private osc: InstanceType<typeof Tone.OmniOscillator>;
  private gate: Tone.Gain;
  private filter: Tone.Filter;
  private level: Tone.Gain;
  private started = false;
  /** Audio time the current note's gate lets go. Infinity while a key is held. */
  private heldUntil = 0;
  /** The current patch's release, so a release scheduled later still knows how long the tail is. */
  private releaseSec = 0.4;

  constructor(output: Tone.InputNode, inst: SynthInstrument) {
    this.level = new Tone.Gain(Tone.dbToGain(inst.gain)).connect(output);
    this.filter = new Tone.Filter({ type: 'lowpass', rolloff: -24, frequency: inst.cutoff, Q: inst.q }).connect(this.level);
    this.gate = new Tone.Gain(0).connect(this.filter);
    this.osc = new Tone.OmniOscillator({ type: inst.wave, frequency: 110 }).connect(this.gate);
  }

  play(inst: SynthInstrument, hz: number, time: number, velocity: number, end: number) {
    this.sound(inst, hz, time, velocity, end);
  }

  /** A live note. Letting go is the caller's job. */
  hold(inst: SynthInstrument, hz: number, time: number, velocity: number): NoteGate {
    this.sound(inst, hz, time, velocity, null);
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

  private shape(inst: SynthInstrument, time: number) {
    if (this.osc.type !== inst.wave) this.osc.type = inst.wave;
    atTime(this.filter.frequency, inst.cutoff, time);
    atTime(this.filter.Q, inst.q, time);
    atTime(this.level.gain, Tone.dbToGain(inst.gain), time);
  }

  private sound(inst: SynthInstrument, hz: number, time: number, velocity: number, end: number | null) {
    const vel = Math.min(1, Math.max(0, velocity));
    if (!(hz > 20) || !(vel > 0)) return;
    this.releaseSec = inst.release;
    this.shape(inst, time);
    if (!this.started) {
      this.osc.start(time);
      this.started = true;
    }
    this.glide(hz, time, inst.glide > 0 && this.heldUntil > time + 0.012, inst.glide);
    this.shapeGate(inst, time, end, vel);
    this.heldUntil = end ?? Number.POSITIVE_INFINITY;
  }

  private release(time: number) {
    this.heldUntil = time;
    const gain = this.gate.gain;
    const tail = Math.max(0.02, this.releaseSec);
    gain.cancelScheduledValues(time);
    gain.setValueAtTime(Math.max(0.0001, gain.getValueAtTime(time)), time);
    gain.exponentialRampToValueAtTime(0.0001, time + tail);
  }

  private glide(hz: number, time: number, slide: boolean, seconds: number) {
    const freq = this.osc.frequency;
    freq.cancelScheduledValues(time);
    if (!slide || !(seconds > 0)) {
      freq.setValueAtTime(hz, time);
      return;
    }
    freq.setValueAtTime(heardHz(freq.getValueAtTime(time), hz), time);
    freq.exponentialRampToValueAtTime(hz, time + Math.max(0.01, Math.min(0.5, seconds)));
  }

  /**
   * The ADSR on the gate. The attack always completes (a note released
   * mid-attack releases from where the envelope got to), the decay settles to
   * the sustain, and the note's end starts the release from wherever the
   * envelope is at that moment.
   */
  private shapeGate(inst: SynthInstrument, time: number, end: number | null, vel: number) {
    const gain = this.gate.gain;
    const peak = Math.min(0.9, 0.85 * (0.3 + 0.7 * vel));
    const attack = Math.max(0.002, inst.attack);
    const decay = Math.max(0.01, inst.decay);
    const sustainLevel = Math.max(0.0001, peak * Math.min(1, inst.sustain));
    gain.cancelScheduledValues(time);
    gain.setValueAtTime(Math.max(0.0001, gain.getValueAtTime(time)), time);
    gain.linearRampToValueAtTime(peak, time + attack);
    gain.linearRampToValueAtTime(sustainLevel, time + attack + decay);
    if (end === null) return;
    const relAt = Math.max(end, time + attack);
    gain.setValueAtTime(Math.max(0.0001, gain.getValueAtTime(relAt)), relAt);
    gain.exponentialRampToValueAtTime(0.0001, relAt + Math.max(0.02, inst.release));
  }
}

export class SynthMachineVoices {
  private poly = new Map<string, PolyMachine>();
  private mono = new Map<string, MonoMachine>();

  constructor(private output: Tone.InputNode) {}

  /** `length` is in seconds; null means a sensible default from the tempo. */
  play(inst: SynthInstrument, hz: number, time: number, velocity: number, length: number | null, secondsPerBeat: number): void {
    const duration = synthNoteSeconds(length, secondsPerBeat);
    if (inst.mode === 'mono') this.monoVoice(inst).play(inst, hz, time, velocity, time + duration);
    else this.polyVoice(inst).play(inst, hz, time, velocity, duration);
  }

  /** Start a note and keep it until the gate is released. */
  hold(inst: SynthInstrument, hz: number, time: number, velocity: number): NoteGate {
    return inst.mode === 'mono'
      ? this.monoVoice(inst).hold(inst, hz, time, velocity)
      : this.polyVoice(inst).hold(inst, hz, time, velocity);
  }

  silence(time: number) {
    for (const voice of this.poly.values()) voice.silence(time);
    for (const voice of this.mono.values()) voice.silence(time);
  }

  dispose() {
    for (const voice of this.poly.values()) voice.dispose();
    for (const voice of this.mono.values()) voice.dispose();
    this.poly.clear();
    this.mono.clear();
  }

  private polyVoice(inst: SynthInstrument): PolyMachine {
    let voice = this.poly.get(inst.id);
    if (!voice) {
      voice = new PolyMachine(this.output, inst);
      this.poly.set(inst.id, voice);
    }
    return voice;
  }

  private monoVoice(inst: SynthInstrument): MonoMachine {
    let voice = this.mono.get(inst.id);
    if (!voice) {
      voice = new MonoMachine(this.output, inst);
      this.mono.set(inst.id, voice);
    }
    return voice;
  }
}
