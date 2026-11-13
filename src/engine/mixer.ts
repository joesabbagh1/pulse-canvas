import * as Tone from 'tone';
import type { BeatClock } from './clock';
import type { Groove } from './groove';
import type { GraphBlock, NoteShape } from './scheduler';
import type { NoteGate } from './holds';
import { Voices } from './voices';
import { EMPTY_BUS_WAVES, motionSum, movedTone, type BusWaves, type MotionCurve } from './wave';

// Every region is a bus: its own instruments, through its own effects, into
// its own channel. Blocks outside every region play on the canvas bus. All
// buses meet at one limiter.
//
//   voices → filter → echo → reverb → channel (level, pan, mute) → limiter
//
// A region's cutoff motions own the filter while they exist. The tone slider
// stays the centre they bend around; without a motion, the slider sets it.

export interface Mix {
  /** Decibels. */
  level: number;
  /** -1 (left) to 1 (right). */
  pan: number;
  mute: boolean;
}

export interface Fx {
  /** 0 (dark) to 1 (open): a low-pass filter's cutoff, on a log scale. */
  tone: number;
  /** Echo wet level, 0 to 1. */
  echo: number;
  /** Echo time, in beats, so it follows the tempo. */
  echoBeats: number;
  /** Reverb wet level, 0 to 1. */
  reverb: number;
}

export interface BusSettings {
  mix: Mix;
  fx: Fx;
  /** A stored sample (see samples.ts) for this bus's tones to play. */
  sample?: string;
  /** Applied by the engine when it schedules a note, not by the mixer. */
  groove?: Groove;
}

export const DEFAULT_MIX: Mix = { level: 0, pan: 0, mute: false };
export const DEFAULT_FX: Fx = { tone: 1, echo: 0, echoBeats: 0.75, reverb: 0.25 };
export const MIN_LEVEL = -40;

/** The filter cutoff for a tone setting: 200 Hz to 20 kHz. */
export const toneHz = (tone: number) => 200 * 100 ** tone;

// Parameter changes glide this long, so dragging a slider while playing
// doesn't click.
const GLIDE = 0.04;

class Bus {
  readonly voices: Voices;
  settings?: BusSettings;
  private channel: Tone.Channel;
  private reverb: Tone.Reverb;
  private echo: Tone.FeedbackDelay;
  private filter: Tone.Filter;
  private motions: MotionCurve[] = [];
  /** The filter is being driven by motions, so the tone slider must leave it alone. */
  private automated = false;
  /** The drawing or the slider changed: the scheduled curve is stale. */
  private dirty = false;
  /** Audio time up to which the filter curve is already scheduled. */
  private scheduledTo = 0;

  constructor(output: Tone.InputNode) {
    this.channel = new Tone.Channel().connect(output);
    this.reverb = new Tone.Reverb({ decay: 3, wet: 0 }).connect(this.channel);
    this.echo = new Tone.FeedbackDelay({ delayTime: 0.4, feedback: 0.35, wet: 0 }).connect(this.reverb);
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: toneHz(1), rolloff: -12 }).connect(this.echo);
    this.voices = new Voices(this.filter);
  }

  apply(settings: BusSettings, secondsPerBeat: number) {
    const { mix, fx } = settings;
    this.settings = settings;
    this.channel.volume.rampTo(mix.level <= MIN_LEVEL ? -Infinity : mix.level, GLIDE);
    this.channel.pan.rampTo(mix.pan, GLIDE);
    this.channel.mute = mix.mute;
    if (!this.automated) this.filter.frequency.rampTo(toneHz(fx.tone), GLIDE);
    this.echo.wet.rampTo(fx.echo, GLIDE);
    this.echo.delayTime.rampTo(fx.echoBeats * secondsPerBeat, GLIDE);
    this.reverb.wet.rampTo(fx.reverb, GLIDE);
  }

  /** Takes a new cycle and new motions. Marks the filter curve stale. */
  install(spec: BusWaves) {
    this.voices.setCycle(spec.cycle);
    this.voices.setInstrumentPrograms(spec.instruments);
    this.motions = spec.motions;
    this.dirty = true;
  }

  /**
   * Schedules the filter through `until`. Motions are read at the beat the
   * clock gives each moment, so a tempo change is picked up on the next pass.
   */
  advance(baseTone: number, clock: BeatClock, now: number, until: number) {
    if (!this.motions.length) {
      this.release(now);
      this.voices.advanceInstruments(baseTone, clock, now, until);
      return;
    }
    const hzAt = (time: number) => toneHz(movedTone(baseTone, motionSum(this.motions, clock.beatAt(time))));
    if (this.dirty || !this.automated || this.scheduledTo < now - 0.05) {
      this.filter.frequency.cancelScheduledValues(now);
      this.filter.frequency.setValueAtTime(hzAt(now), now);
      this.scheduledTo = now;
      this.automated = true;
      this.dirty = false;
    }
    while (this.scheduledTo < until - 0.001) {
      const next = Math.min(this.scheduledTo + 0.02, until);
      this.filter.frequency.linearRampToValueAtTime(hzAt(next), next);
      this.scheduledTo = next;
    }
    this.voices.advanceInstruments(baseTone, clock, now, until);
  }

  /** While stopped, hold the filter where the motion is at beat 0 (the left edge). */
  park(baseTone: number, now: number) {
    this.dirty = false;
    this.scheduledTo = 0;
    if (!this.motions.length) {
      this.release(now);
      this.voices.parkInstruments(baseTone, now);
      return;
    }
    this.automated = true;
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.rampTo(toneHz(movedTone(baseTone, motionSum(this.motions, 0))), 0.04);
    this.voices.parkInstruments(baseTone, now);
  }

  /** Hands the filter back to the tone slider. */
  private release(now: number) {
    if (!this.automated && !this.dirty) return;
    this.automated = false;
    this.dirty = false;
    this.scheduledTo = 0;
    this.filter.frequency.cancelScheduledValues(now);
    if (this.settings) this.filter.frequency.rampTo(toneHz(this.settings.fx.tone), GLIDE);
  }

  dispose() {
    this.voices.dispose();
    this.filter.dispose();
    this.echo.dispose();
    this.reverb.dispose();
    this.channel.dispose();
  }
}

const CANVAS = '';

export class Mixer {
  /** Everything heard, after the limiter; recording taps it here. */
  readonly output = new Tone.Limiter(-1).toDestination();
  private canvas = new Bus(this.output);
  private buses = new Map<string, Bus>();
  /**
   * Live notes skip the piece reverb. Its impulse is decaying noise, so a held
   * note was coming out under a steady hiss.
   */
  private live = new Voices(this.output);

  /** `samples` holds decoded samples by id; the engine fills it. */
  constructor(private samples: ReadonlyMap<string, Tone.ToneAudioBuffer>) {}

  /** Makes, updates and removes region buses to match `settings`, keyed by region id. */
  sync(settings: ReadonlyMap<string, BusSettings>, secondsPerBeat: number) {
    this.canvas.apply({ mix: DEFAULT_MIX, fx: DEFAULT_FX }, secondsPerBeat);
    for (const [id, bus] of this.buses) {
      if (settings.has(id)) continue;
      bus.dispose();
      this.buses.delete(id);
    }
    for (const [id, s] of settings) {
      let bus = this.buses.get(id);
      if (!bus) this.buses.set(id, (bus = new Bus(this.output)));
      bus.apply(s, secondsPerBeat);
    }
  }

  /** The drawn cycles and cutoff motions, keyed by region id. '' is the canvas. */
  install(program: ReadonlyMap<string, BusWaves>) {
    const canvas = program.get(CANVAS) ?? EMPTY_BUS_WAVES;
    this.canvas.install(canvas);
    this.live.setCycle(canvas.cycle);
    this.live.setInstrumentPrograms(canvas.instruments);
    for (const [id, bus] of this.buses) bus.install(program.get(id) ?? EMPTY_BUS_WAVES);
  }

  advance(clock: BeatClock, settings: ReadonlyMap<string, BusSettings>, now: number, until: number) {
    this.canvas.advance(DEFAULT_FX.tone, clock, now, until);
    for (const [id, bus] of this.buses) bus.advance(settings.get(id)?.fx.tone ?? DEFAULT_FX.tone, clock, now, until);
  }

  park(settings: ReadonlyMap<string, BusSettings>, now: number) {
    this.canvas.park(DEFAULT_FX.tone, now);
    for (const [id, bus] of this.buses) bus.park(settings.get(id)?.fx.tone ?? DEFAULT_FX.tone, now);
  }

  play(block: GraphBlock, time: number, secondsPerBeat: number, shape?: NoteShape) {
    const bus = (block.bus && this.buses.get(block.bus)) || this.canvas;
    const sampleId = bus.settings?.sample;
    bus.voices.play(block, time, secondsPerBeat, sampleId ? this.samples.get(sampleId) : undefined, shape);
  }

  /** A live note, dry. It holds until the gate is released. */
  attack(block: GraphBlock, time: number, secondsPerBeat: number, velocity: number): NoteGate {
    return this.live.attack(block, time, secondsPerBeat, velocity);
  }

  silence(time: number) {
    this.canvas.voices.silence(time);
    this.live.silence(time);
    for (const bus of this.buses.values()) bus.voices.silence(time);
  }
}
