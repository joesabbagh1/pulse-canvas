import * as Tone from 'tone';
import type { GraphBlock, NoteShape } from './scheduler';
import { Voices } from './voices';

// Every region is a bus: its own instruments, through its own effects, into
// its own channel. Blocks outside every region play on the canvas bus. All
// buses meet at one limiter.
//
//   voices → filter → echo → reverb → channel (level, pan, mute) → limiter

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
    this.filter.frequency.rampTo(toneHz(fx.tone), GLIDE);
    this.echo.wet.rampTo(fx.echo, GLIDE);
    this.echo.delayTime.rampTo(fx.echoBeats * secondsPerBeat, GLIDE);
    this.reverb.wet.rampTo(fx.reverb, GLIDE);
  }

  dispose() {
    this.voices.dispose();
    this.filter.dispose();
    this.echo.dispose();
    this.reverb.dispose();
    this.channel.dispose();
  }
}

export class Mixer {
  /** Everything heard, after the limiter; recording taps it here. */
  readonly output = new Tone.Limiter(-1).toDestination();
  private canvas = new Bus(this.output);
  private buses = new Map<string, Bus>();

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

  play(block: GraphBlock, time: number, secondsPerBeat: number, shape?: NoteShape) {
    const bus = (block.bus && this.buses.get(block.bus)) || this.canvas;
    const sampleId = bus.settings?.sample;
    bus.voices.play(block, time, secondsPerBeat, sampleId ? this.samples.get(sampleId) : undefined, shape);
  }

  silence(time: number) {
    this.canvas.voices.silence(time);
    for (const bus of this.buses.values()) bus.voices.silence(time);
  }
}
