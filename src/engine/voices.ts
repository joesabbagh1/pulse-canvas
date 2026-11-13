import * as Tone from 'tone';
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
  private kicks: Pool<Tone.MembraneSynth>;
  private snares: Pool<SnareVoice>;
  private hats: Pool<Tone.NoiseSynth>;
  private hatFilter: Tone.Filter;
  private sampleNotes: Tone.ToneBufferSource[] = [];

  constructor(private output: Tone.InputNode) {
    this.tone = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.3, sustain: 0.1, release: 0.8 },
    }).connect(output);
    this.tone.maxPolyphony = 32;
    this.tone.volume.value = -12;

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

  /**
   * With a `sample`, tones play it instead of the synth, as if it were
   * recorded at C4. Pluck and bass keep their own voices. The shape's velocity
   * scales every instrument; its length sets how long a pitched note sounds
   * (drums are one-shots, so keep their own).
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

  silence(time: number) {
    this.tone.releaseAll(time);
    this.bass.releaseAll(time);
    for (const pluck of this.plucks.voices) pluck.triggerRelease(time);
    for (const note of this.sampleNotes) note.stop(time);
  }

  dispose() {
    this.tone.dispose();
    for (const pluck of this.plucks.voices) pluck.dispose();
    this.bass.dispose();
    this.bassFilter.dispose();
    for (const k of this.kicks.voices) k.dispose();
    for (const s of this.snares.voices) s.dispose();
    for (const h of this.hats.voices) h.dispose();
    this.hatFilter.dispose();
    for (const note of this.sampleNotes) note.dispose();
  }
}
