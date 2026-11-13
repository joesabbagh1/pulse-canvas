import * as Tone from 'tone';
import type { Partials } from './wave';
import { PLAIN, type GraphBlock, type NoteShape } from './scheduler';
import { ROOT_HZ, degreeToHz } from './tuning';

// Tone.js throws if a one-shot voice is started twice at the same instant, so
// drum hits rotate through a few copies and each copy only takes later times.
class Pool<T> {
  private last: number[];
  private next = 0;

  constructor(readonly voices: T[]) {
    this.last = voices.map(() => -Infinity);
  }

  take(time: number): T | null {
    for (let i = 0; i < this.voices.length; i++) {
      const k = (this.next + i) % this.voices.length;
      if (time > this.last[k] + 0.001) {
        this.last[k] = time;
        this.next = k + 1;
        return this.voices[k];
      }
    }
    return null;
  }
}

// A loop that keeps transposing climbs out of hearing; those notes are skipped
// rather than sent to the synths.
const AUDIBLE_HZ = [20, 16000];
const audible = (hz: number) => hz >= AUDIBLE_HZ[0] && hz <= AUDIBLE_HZ[1];

// Sample notes ring out to their end, so a fast part could stack up hundreds;
// past this many the oldest is cut.
const MAX_SAMPLE_NOTES = 24;
const MAX_DRAWN_NOTES = 16;

/** The native node a Tone node accepts audio on. */
function audioInput(target: { input?: unknown }): AudioNode {
  let node: unknown = target;
  const seen = new Set<unknown>();
  while (node && typeof node === 'object' && !seen.has(node)) {
    seen.add(node);
    if (node instanceof AudioNode) return node;
    node = (node as { input?: unknown }).input;
  }
  throw new Error('No audio input');
}

// A jaw harp's tongue sits around here. The note you hear is a harmonic of it,
// the way the mouth picks one out, rather than the tongue changing pitch.
const JAW_TONGUE_HZ = [70, 130];

/** Tongue frequency for `noteHz`: a harmonic of the note, held in a jaw harp's range. Low notes are the tongue itself. */
export function jawTongueHz(noteHz: number): number {
  if (!(noteHz > 0) || noteHz <= JAW_TONGUE_HZ[1] + 10) return noteHz;
  let n = Math.min(16, Math.max(2, Math.round(noteHz / 96)));
  while (n < 16 && noteHz / n > JAW_TONGUE_HZ[1]) n += 1;
  return noteHz / n;
}

// The two strings of a morin khuur are a fifth apart. Below the melody until
// that would leave the instrument's range, then a fifth above.
const KHUUR_FIFTH = 3 / 2;
const KHUUR_LOW = 55;

/** The khuur's other string, a just fifth from `noteHz`. */
export function khuurDroneHz(noteHz: number): number {
  const below = noteHz / KHUUR_FIFTH;
  return below >= KHUUR_LOW ? below : noteHz * KHUUR_FIFTH;
}

/**
 * A plucked lamella plus the mouth. The buzz is the tongue; a resonant
 * bandpass at the note pulls one harmonic out of it, which is the pitch you hear.
 */
class JawHarpVoice {
  private mouth: Tone.Filter;
  private tongue: Tone.Synth;
  private buzz: Tone.Synth;
  private click: Tone.NoiseSynth;

  constructor(output: Tone.InputNode) {
    this.mouth = new Tone.Filter({ type: 'bandpass', frequency: 440, Q: 11 }).connect(output);
    this.tongue = new Tone.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.04 },
      volume: -12,
    }).connect(this.mouth);
    this.buzz = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.2, sustain: 0.35, release: 0.16 },
      volume: -14,
    }).connect(output);
    this.click = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.018, sustain: 0, release: 0.01 },
      volume: -18,
    }).connect(this.mouth);
  }

  hit(noteHz: number, time: number, velocity: number, length: number) {
    const f0 = jawTongueHz(noteHz);
    const dur = Math.max(0.1, length);
    const harmonic = Math.max(1, noteHz / f0);
    // Higher harmonics of a saw are quieter, so the tongue is turned up to keep the note even.
    this.tongue.volume.setValueAtTime(-12 + Tone.gainToDb(Math.min(3.2, Math.sqrt(harmonic))), time);
    this.mouth.frequency.cancelScheduledValues(time);
    this.mouth.frequency.setValueAtTime(Math.max(30, noteHz * 0.72), time);
    this.mouth.frequency.exponentialRampToValueAtTime(Math.max(30, noteHz), time + 0.03);
    this.tongue.triggerAttackRelease(f0, Math.min(0.22, dur), time, velocity);
    this.click.triggerAttackRelease(0.02, time, velocity);
    this.buzz.frequency.cancelScheduledValues(time);
    this.buzz.triggerAttackRelease(f0, dur, time, velocity);
    // The lamella starts sharp and drops, which is the twang. The mouth stays on the note.
    this.buzz.frequency.cancelScheduledValues(time);
    this.buzz.frequency.setValueAtTime(f0 * 1.08, time);
    this.buzz.frequency.exponentialRampToValueAtTime(f0, time + 0.045);
  }

  release(time: number) {
    this.tongue.triggerRelease(time);
    this.buzz.triggerRelease(time);
  }

  dispose() {
    this.tongue.dispose();
    this.buzz.dispose();
    this.click.dispose();
    this.mouth.dispose();
  }
}

/** One bowed string of a morin khuur: a saw with a slow vibrato that arrives with the bow. */
class KhuurString extends Tone.Synth {
  private vibrato: Tone.LFO;

  constructor(options?: Tone.SynthOptions) {
    super(options);
    this.vibrato = new Tone.LFO({ context: this.context, frequency: 4.6, min: -20, max: 20 });
    this.vibrato.connect(this.detune);
    this.vibrato.start();
  }

  dispose() {
    this.vibrato.dispose();
    return super.dispose();
  }
}

/** The scrape of horsehair as the bow takes the string. */
class BowScratch {
  private filter: Tone.Filter;
  private noise: Tone.NoiseSynth;

  constructor(output: Tone.InputNode) {
    this.filter = new Tone.Filter({ type: 'bandpass', frequency: 2100, Q: 0.6 }).connect(output);
    this.noise = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.004, decay: 0.07, sustain: 0, release: 0.02 },
      volume: -20,
    }).connect(this.filter);
  }

  hit(time: number, velocity: number) {
    this.noise.triggerAttackRelease(0.05, time, velocity);
  }

  dispose() {
    this.noise.dispose();
    this.filter.dispose();
  }
}

/** A noise crack plus a short body, so a snare isn't just another hat. */
class SnareVoice {
  private filter: Tone.Filter;
  private noise: Tone.NoiseSynth;
  private body: Tone.MembraneSynth;

  constructor(output: Tone.InputNode) {
    this.filter = new Tone.Filter({ frequency: 1800, type: 'bandpass', Q: 0.8 }).connect(output);
    this.noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.04 },
      volume: -4,
    }).connect(this.filter);
    this.body = new Tone.MembraneSynth({
      pitchDecay: 0.01,
      octaves: 2.5,
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.02 },
      volume: -8,
    }).connect(output);
  }

  hit(time: number, velocity: number) {
    this.noise.triggerAttackRelease(0.08, time, velocity);
    this.body.triggerAttackRelease(190, 0.06, time, velocity);
  }

  dispose() {
    this.noise.dispose();
    this.body.dispose();
    this.filter.dispose();
  }
}

/** One set of instruments, playing into one region's bus. */
export class Voices {
  private tone: Tone.PolySynth<Tone.Synth>;
  private plucks: Pool<Tone.PluckSynth>;
  private bass: Tone.PolySynth<Tone.Synth>;
  private bassFilter: Tone.Filter;
  private jawharps: Pool<JawHarpVoice>;
  private khuur: Tone.PolySynth<KhuurString>;
  private khuurDrone: Tone.PolySynth<KhuurString>;
  private khuurBody: Tone.Filter;
  private khuurLow: Tone.Filter;
  private bows: Pool<BowScratch>;
  private kicks: Pool<Tone.MembraneSynth>;
  private snares: Pool<SnareVoice>;
  private hats: Pool<Tone.NoiseSynth>;
  private hatFilter: Tone.Filter;
  private sampleNotes: Tone.ToneBufferSource[] = [];
  private drawnOut: Tone.Gain;
  private drawnWave: PeriodicWave | null = null;
  private drawnNotes: { osc: OscillatorNode; env: Tone.AmplitudeEnvelope; gone: boolean }[] = [];

  constructor(private output: Tone.InputNode) {
    this.tone = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.3, sustain: 0.1, release: 0.8 },
    }).connect(output);
    this.tone.maxPolyphony = 32;
    this.tone.volume.value = -12;
    // The drawn cycle is the same loudness as the triangle it replaces.
    this.drawnOut = new Tone.Gain(Tone.dbToGain(-12)).connect(output);

    this.plucks = new Pool(
      Array.from({ length: 8 }, () =>
        new Tone.PluckSynth({ attackNoise: 2, dampening: 5000, resonance: 0.92, release: 0.4, volume: -8 }).connect(output),
      ),
    );

    // A saw through a low pass, so a bass line isn't the melody synth an octave down.
    this.bassFilter = new Tone.Filter({ type: 'lowpass', frequency: 420, rolloff: -12 }).connect(output);
    this.bass = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.008, decay: 0.2, sustain: 0.45, release: 0.28 },
    }).connect(this.bassFilter);
    this.bass.maxPolyphony = 8;
    this.bass.volume.value = -8;

    this.jawharps = new Pool(Array.from({ length: 4 }, () => new JawHarpVoice(output)));

    // A fixed wooden resonance, then a low pass to take the digital edge off the bow.
    this.khuurLow = new Tone.Filter({ type: 'lowpass', frequency: 2800, rolloff: -12 }).connect(output);
    this.khuurBody = new Tone.Filter({ type: 'peaking', frequency: 1500, Q: 0.9, gain: 7 }).connect(this.khuurLow);
    this.khuur = new Tone.PolySynth(KhuurString, {
      oscillator: { type: 'fatsawtooth', count: 2, spread: 12 },
      envelope: { attack: 0.07, decay: 0.14, sustain: 0.8, release: 0.4 },
    }).connect(this.khuurBody);
    this.khuur.maxPolyphony = 6;
    this.khuur.volume.value = -9;
    this.khuurDrone = new Tone.PolySynth(KhuurString, {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.1, decay: 0.16, sustain: 0.75, release: 0.45 },
    }).connect(this.khuurBody);
    this.khuurDrone.maxPolyphony = 6;
    this.khuurDrone.volume.value = -17;
    this.bows = new Pool(Array.from({ length: 3 }, () => new BowScratch(output)));

    this.kicks = new Pool(
      Array.from({ length: 4 }, () =>
        new Tone.MembraneSynth({
          pitchDecay: 0.04,
          octaves: 5,
          envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.05 },
          volume: -6,
        }).connect(output),
      ),
    );

    this.snares = new Pool(Array.from({ length: 4 }, () => new SnareVoice(output)));

    this.hatFilter = new Tone.Filter(7500, 'highpass').connect(output);
    this.hats = new Pool(
      Array.from({ length: 4 }, () =>
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
          volume: -14,
        }).connect(this.hatFilter),
      ),
    );
  }

  /** Tones play this drawing instead of the triangle. Null goes back to the triangle. Already-sounding notes pick it up. */
  setCycle(partials: Partials | null) {
    if (!partials) {
      this.drawnWave = null;
      return;
    }
    const wave = Tone.getContext().createPeriodicWave(partials.real, partials.imag, { disableNormalization: true });
    this.drawnWave = wave;
    for (const note of this.drawnNotes) note.osc.setPeriodicWave(wave);
  }

  /**
   * With a `sample`, tones play it instead of the synth, as if it were
   * recorded at C4. Pluck, bass, jaw harp and khuur keep their own voices. The
   * shape's velocity scales every instrument; its length sets how long a pitched
   * note sounds (drums are one-shots, so keep their own). A drawn cycle replaces
   * the triangle; a sample still wins, since loading one was a choice.
   */
  play(block: GraphBlock, time: number, secondsPerBeat: number, sample?: Tone.ToneAudioBuffer, shape: NoteShape = PLAIN) {
    const hz = degreeToHz(block.degree, block.scale, block.rootHz);
    const { velocity } = shape;
    const length = shape.length === null ? null : shape.length * secondsPerBeat;
    if (velocity <= 0) return;
    try {
      switch (block.kind) {
        case 'tone':
          if (!audible(hz)) break;
          if (sample) this.playSample(sample, hz / ROOT_HZ, time, velocity, length);
          else if (this.drawnWave) this.playDrawn(hz, time, 0.8 * velocity, length ?? Math.min(0.6, secondsPerBeat * 0.5));
          else this.tone.triggerAttackRelease(hz, length ?? Math.min(0.6, secondsPerBeat * 0.5), time, 0.8 * velocity);
          break;
        case 'pluck':
          if (!audible(hz)) break;
          this.pluck(hz, time, velocity, length ?? Math.min(0.5, secondsPerBeat * 0.5));
          break;
        case 'bass':
          if (!audible(hz)) break;
          this.bass.triggerAttackRelease(hz, length ?? Math.min(0.8, secondsPerBeat), time, velocity);
          break;
        case 'jawharp':
          if (!audible(hz)) break;
          this.jawharps.take(time)?.hit(hz, time, velocity, length ?? Math.min(0.45, secondsPerBeat * 0.5));
          break;
        case 'khuur': {
          if (!audible(hz)) break;
          const held = length ?? Math.min(1.8, Math.max(0.4, secondsPerBeat));
          this.khuur.triggerAttackRelease(hz, held, time, velocity);
          const drone = khuurDroneHz(hz);
          if (audible(drone)) this.khuurDrone.triggerAttackRelease(drone, held, time, velocity);
          this.bows.take(time)?.hit(time, velocity);
          break;
        }
        case 'kick':
          if (audible(hz / 4)) this.kicks.take(time)?.triggerAttackRelease(hz / 4, 0.1, time, velocity);
          break;
        case 'snare':
          this.snares.take(time)?.hit(time, velocity);
          break;
        case 'hat':
          this.hats.take(time)?.triggerAttackRelease(0.03, time, velocity);
          break;
        case 'start':
          break;
      }
    } catch (err) {
      console.warn('Voice failed to play', err);
    }
  }

  /** PluckSynth has no velocity argument, so the voice's volume carries it. */
  private pluck(hz: number, time: number, velocity: number, length: number) {
    const voice = this.plucks.take(time);
    if (!voice) return;
    voice.volume.setValueAtTime(-8 + Tone.gainToDb(Math.min(1, velocity)), time);
    voice.triggerAttack(hz, time);
    voice.triggerRelease(time + Math.max(0.05, length));
  }

  /** `length` in seconds cuts the sample short; null lets it ring to its end. */
  private playSample(sample: Tone.ToneAudioBuffer, rate: number, time: number, gain: number, length: number | null) {
    const note = new Tone.ToneBufferSource({ url: sample, playbackRate: rate, fadeOut: 0.01 }).connect(this.output);
    note.onended = () => {
      this.sampleNotes = this.sampleNotes.filter((n) => n !== note);
      note.dispose();
    };
    note.start(time, 0, length ?? undefined, gain);
    this.sampleNotes.push(note);
    if (this.sampleNotes.length > MAX_SAMPLE_NOTES) this.sampleNotes[0].stop(time);
  }

  /** The same envelope as the triangle synth, so a cycle changes the timbre and not the shape of the note. */
  private playDrawn(hz: number, time: number, velocity: number, length: number) {
    const wave = this.drawnWave;
    if (!wave || this.drawnNotes.length >= MAX_DRAWN_NOTES) return;
    const env = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.3, sustain: 0.1, release: 0.8 }).connect(this.drawnOut);
    const osc = Tone.getContext().rawContext.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(hz, time);
    osc.connect(audioInput(env));
    const dur = Math.max(0.02, length);
    env.triggerAttackRelease(dur, time, velocity);
    osc.start(time);
    osc.stop(time + dur + 0.85);
    const note = { osc, env, gone: false };
    this.drawnNotes.push(note);
    osc.onended = () => {
      if (note.gone) return;
      note.gone = true;
      osc.disconnect();
      env.dispose();
      this.drawnNotes = this.drawnNotes.filter((n) => n !== note);
    };
  }

  silence(time: number) {
    this.tone.releaseAll(time);
    this.bass.releaseAll(time);
    for (const pluck of this.plucks.voices) pluck.triggerRelease(time);
    for (const jaw of this.jawharps.voices) jaw.release(time);
    this.khuur.releaseAll(time);
    this.khuurDrone.releaseAll(time);
    for (const note of this.sampleNotes) note.stop(time);
    for (const note of this.drawnNotes) {
      note.env.triggerRelease(time);
      try {
        note.osc.stop(time);
      } catch {
        // Already stopped.
      }
    }
  }

  dispose() {
    this.tone.dispose();
    this.drawnOut.dispose();
    for (const note of this.drawnNotes) {
      note.gone = true;
      try {
        note.osc.disconnect();
      } catch {
        // Already disconnected.
      }
      note.env.dispose();
    }
    for (const pluck of this.plucks.voices) pluck.dispose();
    this.bass.dispose();
    this.bassFilter.dispose();
    for (const jaw of this.jawharps.voices) jaw.dispose();
    this.khuur.dispose();
    this.khuurDrone.dispose();
    this.khuurBody.dispose();
    this.khuurLow.dispose();
    for (const bow of this.bows.voices) bow.dispose();
    for (const k of this.kicks.voices) k.dispose();
    for (const s of this.snares.voices) s.dispose();
    for (const h of this.hats.voices) h.dispose();
    this.hatFilter.dispose();
    for (const note of this.sampleNotes) note.dispose();
  }
}
