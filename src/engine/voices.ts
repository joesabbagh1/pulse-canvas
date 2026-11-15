import * as Tone from 'tone';
import { CatalogVoices } from './catalogVoices';
import { NO_GATE, ONCE_GATE, type NoteGate } from './holds';
import { instrumentById } from './instruments';
import { Pool } from './pool';
import { motionSum, movedTone, type InstrumentProgram, type MotionCurve, type Partials } from './wave';
import type { BeatClock } from './clock';
import { PLAIN, type GraphBlock, type NoteShape } from './scheduler';
import { ROOT_HZ, degreeToHz } from './tuning';

// A loop that keeps transposing climbs out of hearing; those notes are skipped
// rather than sent to the synths.
const AUDIBLE_HZ = [20, 16000];
const audible = (hz: number) => hz >= AUDIBLE_HZ[0] && hz <= AUDIBLE_HZ[1];

// Sample notes ring out to their end, so a fast part could stack up hundreds;
// past this many the oldest is cut.
const MAX_SAMPLE_NOTES = 24;
const MAX_DRAWN_NOTES = 16;
/** Same curve as the region filter, so an instrument cutoff bends around the Tone slider too. */
const toneHz = (tone: number) => 200 * 100 ** tone;

/** One instrument's private lowpass, plus the drawn notes that use its cycle. */
interface Shade {
  input: Tone.InputNode;
  filter: Tone.Filter;
  /** Frequency when no cutoff drawing is driving it. */
  rest: number;
  automated: boolean;
  dirty: boolean;
  scheduledTo: number;
  wave: PeriodicWave | null;
  notes: DrawnNote[];
}

interface DrawnNote {
  osc: OscillatorNode;
  env: Tone.AmplitudeEnvelope;
  gone: boolean;
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

  /** The buzz holds until `release`. The click is still a short strike. */
  begin(noteHz: number, time: number, velocity: number) {
    const f0 = jawTongueHz(noteHz);
    const harmonic = Math.max(1, noteHz / f0);
    this.tongue.volume.setValueAtTime(-12 + Tone.gainToDb(Math.min(3.2, Math.sqrt(harmonic))), time);
    this.mouth.frequency.cancelScheduledValues(time);
    this.mouth.frequency.setValueAtTime(Math.max(30, noteHz * 0.72), time);
    this.mouth.frequency.exponentialRampToValueAtTime(Math.max(30, noteHz), time + 0.03);
    this.tongue.triggerAttack(f0, time, velocity);
    this.click.triggerAttackRelease(0.02, time, velocity);
    this.buzz.triggerAttack(f0, time, velocity);
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

/**
 * One set of instruments, playing into one region's bus.
 *
 * An instrument is built by the first note that needs it. Every region, every
 * pattern block with its own filter, and the live keys hold a set each, and a
 * synth costs audio time whether or not it is sounding. Built up front, the
 * jaw harps, khuur and plucked strings of a piece that never played them put
 * the audio thread behind real time: the sound broke up, then went quiet.
 */
export class Voices {
  private tone: Tone.PolySynth<Tone.Synth> | null = null;
  private plucks: Pool<Tone.PluckSynth> | null = null;
  private bass: Tone.PolySynth<Tone.Synth> | null = null;
  private jawharps: Pool<JawHarpVoice> | null = null;
  private khuur: { strings: Tone.PolySynth<KhuurString>; drone: Tone.PolySynth<KhuurString>; bows: Pool<BowScratch> } | null = null;
  private kicks: Pool<Tone.MembraneSynth> | null = null;
  private snares: Pool<SnareVoice> | null = null;
  private hats: Pool<Tone.NoiseSynth> | null = null;
  private catalog: CatalogVoices;
  private programs = new Map<string, InstrumentProgram>();
  private shades = new Map<string, Shade>();
  /** Every node built so far, for dispose. */
  private built: { dispose(): unknown }[] = [];
  private sampleNotes: Tone.ToneBufferSource[] = [];
  private drawnOut: Tone.Gain | null = null;
  private drawnWave: PeriodicWave | null = null;
  private drawnNotes: DrawnNote[] = [];

  constructor(private output: Tone.InputNode) {
    this.catalog = new CatalogVoices(output);
  }

  /** Cycles and cutoffs aimed at single instruments. The region tone and filter are separate. */
  setInstrumentPrograms(programs: ReadonlyMap<string, InstrumentProgram>) {
    this.programs = new Map(programs);
    for (const [id, program] of programs) {
      const shade = this.shade(id);
      shade.dirty = true;
      const wave = program.cycle
        ? Tone.getContext().createPeriodicWave(program.cycle.real, program.cycle.imag, { disableNormalization: true })
        : null;
      shade.wave = wave;
      if (wave) for (const note of shade.notes) note.osc.setPeriodicWave(wave);
    }
    for (const [id, shade] of this.shades) {
      if (programs.has(id)) continue;
      shade.wave = null;
      shade.dirty = true;
    }
  }

  /** Schedules each instrument cutoff across the lookahead. No motions hands the filter back. */
  advanceInstruments(baseTone: number, clock: BeatClock, now: number, until: number) {
    for (const [id, shade] of this.shades) this.scheduleShade(shade, this.programs.get(id)?.motions ?? [], baseTone, clock, now, until, false);
  }

  /** While stopped, each instrument cutoff rests where its drawing is at beat 0. */
  parkInstruments(baseTone: number, now: number) {
    for (const [id, shade] of this.shades) this.scheduleShade(shade, this.programs.get(id)?.motions ?? [], baseTone, null, now, now, true);
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
          else if (this.playCycle('tone', hz, time, 0.8 * velocity, length ?? Math.min(0.6, secondsPerBeat * 0.5))) {
            // A cycle aimed at Tone replaces the triangle, and the region's own cycle.
          } else if (this.drawnWave) this.playDrawn(hz, time, 0.8 * velocity, length ?? Math.min(0.6, secondsPerBeat * 0.5));
          else this.toneSynth().triggerAttackRelease(hz, length ?? Math.min(0.6, secondsPerBeat * 0.5), time, 0.8 * velocity);
          break;
        case 'pluck':
          if (!audible(hz)) break;
          if (!this.playCycle('pluck', hz, time, velocity, length ?? Math.min(0.5, secondsPerBeat * 0.5))) {
            this.pluck(hz, time, velocity, length ?? Math.min(0.5, secondsPerBeat * 0.5));
          }
          break;
        case 'bass':
          if (!audible(hz)) break;
          if (!this.playCycle('bass', hz, time, velocity, length ?? Math.min(0.8, secondsPerBeat))) {
            this.bassSynth().triggerAttackRelease(hz, length ?? Math.min(0.8, secondsPerBeat), time, velocity);
          }
          break;
        case 'jawharp':
          if (!audible(hz)) break;
          if (!this.playCycle('jawharp', hz, time, velocity, length ?? Math.min(0.45, secondsPerBeat * 0.5))) {
            this.jawPool().take(time)?.hit(hz, time, velocity, length ?? Math.min(0.45, secondsPerBeat * 0.5));
          }
          break;
        case 'khuur': {
          if (!audible(hz)) break;
          const held = length ?? Math.min(1.8, Math.max(0.4, secondsPerBeat));
          if (!this.playCycle('khuur', hz, time, velocity, held)) {
            const khuur = this.khuurRig();
            khuur.strings.triggerAttackRelease(hz, held, time, velocity);
            const drone = khuurDroneHz(hz);
            if (audible(drone)) khuur.drone.triggerAttackRelease(drone, held, time, velocity);
            khuur.bows.take(time)?.hit(time, velocity);
          }
          break;
        }
        case 'kick':
          if (audible(hz / 4)) this.kickPool().take(time)?.triggerAttackRelease(hz / 4, 0.1, time, velocity);
          break;
        case 'snare':
          this.snarePool().take(time)?.hit(time, velocity);
          break;
        case 'hat':
          this.hatPool().take(time)?.triggerAttackRelease(0.03, time, velocity);
          break;
        case 'start':
          break;
        default: {
          const inst = instrumentById(block.kind);
          if (!inst) break;
          if (inst.pitched && !audible(hz)) break;
          const held = length ?? Math.min(1.2, Math.max(0.3, secondsPerBeat));
          if (!(inst.pitched && this.playCycle(block.kind, hz, time, velocity, held))) {
            this.catalog.play(inst, hz, time, velocity, length, secondsPerBeat, shape.accent === true);
          }
          break;
        }
      }
    } catch (err) {
      console.warn('Voice failed to play', err);
    }
  }

  /**
   * A live note. It sounds until the returned gate is released. Drums, hats,
   * and other strikes play out and are not choked by letting go.
   */
  attack(block: GraphBlock, time: number, secondsPerBeat: number, velocity: number, sample?: Tone.ToneAudioBuffer): NoteGate {
    const hz = degreeToHz(block.degree, block.scale, block.rootHz);
    if (!(velocity > 0)) return NO_GATE;
    try {
      switch (block.kind) {
        case 'tone':
          return this.attackTone(hz, time, velocity, sample);
        case 'pluck':
          return this.attackPluck(hz, time, velocity);
        case 'bass':
          return this.attackBass(hz, time, velocity);
        case 'jawharp':
          return this.attackJaw(hz, time, velocity);
        case 'khuur':
          return this.attackKhuur(hz, time, velocity);
        case 'kick':
        case 'snare':
        case 'hat':
          this.play(block, time, secondsPerBeat, sample, { velocity, length: null });
          return ONCE_GATE;
        case 'start':
          return NO_GATE;
        default: {
          const inst = instrumentById(block.kind);
          if (!inst) return NO_GATE;
          if (!inst.pitched || inst.voice === 'drum') {
            this.play(block, time, secondsPerBeat, sample, { velocity, length: null });
            return ONCE_GATE;
          }
          if (!audible(hz)) return NO_GATE;
          const cycle = this.attackCycle(block.kind, hz, time, velocity);
          if (cycle) return cycle;
          return this.catalog.attack(inst, hz, time, velocity);
        }
      }
    } catch (err) {
      console.warn('Voice failed to attack', err);
      return NO_GATE;
    }
  }

  private attackTone(hz: number, time: number, velocity: number, sample?: Tone.ToneAudioBuffer): NoteGate {
    if (!audible(hz)) return NO_GATE;
    const vel = 0.8 * velocity;
    if (sample) return this.attackSample(sample, hz / ROOT_HZ, time, velocity);
    const cycle = this.attackCycle('tone', hz, time, vel);
    if (cycle) return cycle;
    if (this.drawnWave) return this.attackDrawn(hz, time, vel);
    const tone = this.toneSynth();
    tone.triggerAttack(hz, time, vel);
    return { release: (at) => tone.triggerRelease(hz, at) };
  }

  private attackPluck(hz: number, time: number, velocity: number): NoteGate {
    if (!audible(hz)) return NO_GATE;
    const cycle = this.attackCycle('pluck', hz, time, velocity);
    if (cycle) return cycle;
    const plucks = this.pluckPool();
    const held = plucks.hold(time);
    if (!held) return NO_GATE;
    held.voice.volume.setValueAtTime(-8 + Tone.gainToDb(Math.min(1, velocity)), time);
    held.voice.triggerAttack(hz, time);
    return {
      release: (at) => {
        held.voice.triggerRelease(at);
        plucks.free(held.index, at);
      },
    };
  }

  private attackBass(hz: number, time: number, velocity: number): NoteGate {
    if (!audible(hz)) return NO_GATE;
    const cycle = this.attackCycle('bass', hz, time, velocity);
    if (cycle) return cycle;
    const bass = this.bassSynth();
    bass.triggerAttack(hz, time, velocity);
    return { release: (at) => bass.triggerRelease(hz, at) };
  }

  private attackJaw(hz: number, time: number, velocity: number): NoteGate {
    if (!audible(hz)) return NO_GATE;
    const cycle = this.attackCycle('jawharp', hz, time, velocity);
    if (cycle) return cycle;
    const jawharps = this.jawPool();
    const held = jawharps.hold(time);
    if (!held) return NO_GATE;
    held.voice.begin(hz, time, velocity);
    return {
      release: (at) => {
        held.voice.release(at);
        jawharps.free(held.index, at);
      },
    };
  }

  private attackKhuur(hz: number, time: number, velocity: number): NoteGate {
    if (!audible(hz)) return NO_GATE;
    const cycle = this.attackCycle('khuur', hz, time, velocity);
    if (cycle) return cycle;
    const khuur = this.khuurRig();
    khuur.strings.triggerAttack(hz, time, velocity);
    const drone = khuurDroneHz(hz);
    const withDrone = audible(drone);
    if (withDrone) khuur.drone.triggerAttack(drone, time, velocity);
    khuur.bows.take(time)?.hit(time, velocity);
    return {
      release: (at) => {
        khuur.strings.triggerRelease(hz, at);
        if (withDrone) khuur.drone.triggerRelease(drone, at);
      },
    };
  }

  private keep<T extends { dispose(): unknown }>(part: T): T {
    this.built.push(part);
    return part;
  }

  private pool<T extends { dispose(): unknown }>(count: number, make: () => T): Pool<T> {
    return new Pool(Array.from({ length: count }, () => this.keep(make())));
  }

  private lowpass(frequency: number) {
    return this.keep(new Tone.Filter({ type: 'lowpass', frequency, rolloff: -12 }).connect(this.output));
  }

  /**
   * The filter an instrument plays through, made when it is first asked for.
   * `input` is where a drawn cycle enters. `filter` is what a cutoff drawing moves.
   */
  private shade(id: string): Shade {
    const existing = this.shades.get(id);
    if (existing) return existing;
    let filter: Tone.Filter;
    let input: Tone.InputNode;
    // Open unless a cutoff drawing is aimed at the instrument. The region filter still follows.
    let rest = 18000;
    if (id === 'bass') {
      // A saw through a low pass, so a bass line isn't the melody synth an octave down.
      rest = 420;
      input = filter = this.lowpass(rest);
    } else if (id === 'khuur') {
      // A fixed wooden resonance, then a low pass to take the digital edge off the bow.
      rest = 2800;
      filter = this.lowpass(rest);
      input = this.keep(new Tone.Filter({ type: 'peaking', frequency: 1500, Q: 0.9, gain: 7 }).connect(filter));
    } else {
      input = filter = this.lowpass(rest);
    }
    const shade: Shade = { input, filter, rest, automated: false, dirty: false, scheduledTo: 0, wave: null, notes: [] };
    this.shades.set(id, shade);
    return shade;
  }

  private toneSynth() {
    if (!this.tone) {
      this.tone = this.keep(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.004, decay: 0.3, sustain: 0.1, release: 0.8 },
        }).connect(this.shade('tone').filter),
      );
      this.tone.maxPolyphony = 32;
      this.tone.volume.value = -12;
    }
    return this.tone;
  }

  /** Where the region's drawn cycle goes in, at the loudness of the triangle it replaces. */
  private drawnInput() {
    return (this.drawnOut ??= this.keep(new Tone.Gain(Tone.dbToGain(-12)).connect(this.shade('tone').filter)));
  }

  private pluckPool() {
    if (!this.plucks) {
      const filter = this.shade('pluck').filter;
      this.plucks = this.pool(8, () =>
        new Tone.PluckSynth({ attackNoise: 2, dampening: 5000, resonance: 0.92, release: 0.4, volume: -8 }).connect(filter),
      );
    }
    return this.plucks;
  }

  private bassSynth() {
    if (!this.bass) {
      this.bass = this.keep(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.008, decay: 0.2, sustain: 0.45, release: 0.28 },
        }).connect(this.shade('bass').filter),
      );
      this.bass.maxPolyphony = 8;
      this.bass.volume.value = -8;
    }
    return this.bass;
  }

  private jawPool() {
    if (!this.jawharps) {
      const filter = this.shade('jawharp').filter;
      this.jawharps = this.pool(4, () => new JawHarpVoice(filter));
    }
    return this.jawharps;
  }

  private khuurRig() {
    if (!this.khuur) {
      const { input, filter } = this.shade('khuur');
      const strings = this.keep(
        new Tone.PolySynth(KhuurString, {
          oscillator: { type: 'fatsawtooth', count: 2, spread: 12 },
          envelope: { attack: 0.07, decay: 0.14, sustain: 0.8, release: 0.4 },
        }).connect(input),
      );
      strings.maxPolyphony = 6;
      strings.volume.value = -9;
      const drone = this.keep(
        new Tone.PolySynth(KhuurString, {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.1, decay: 0.16, sustain: 0.75, release: 0.45 },
        }).connect(input),
      );
      drone.maxPolyphony = 6;
      drone.volume.value = -17;
      this.khuur = { strings, drone, bows: this.pool(3, () => new BowScratch(filter)) };
    }
    return this.khuur;
  }

  private kickPool() {
    if (!this.kicks) {
      const filter = this.shade('kick').filter;
      this.kicks = this.pool(4, () =>
        new Tone.MembraneSynth({
          pitchDecay: 0.04,
          octaves: 5,
          envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.05 },
          volume: -6,
        }).connect(filter),
      );
    }
    return this.kicks;
  }

  private snarePool() {
    if (!this.snares) {
      const filter = this.shade('snare').filter;
      this.snares = this.pool(4, () => new SnareVoice(filter));
    }
    return this.snares;
  }

  private hatPool() {
    if (!this.hats) {
      const highpass = this.keep(new Tone.Filter(7500, 'highpass').connect(this.shade('hat').filter));
      this.hats = this.pool(4, () =>
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
          volume: -14,
        }).connect(highpass),
      );
    }
    return this.hats;
  }

  /** Plays the instrument's cycle into its own filter. False when that instrument has no cycle. */
  private playCycle(id: string, hz: number, time: number, velocity: number, length: number) {
    const shade = this.shades.get(id) ?? (this.programs.has(id) ? this.shade(id) : undefined);
    const wave = shade?.wave;
    if (!shade || !wave) return false;
    if (shade.notes.length >= MAX_DRAWN_NOTES) return true;
    const env = new Tone.AmplitudeEnvelope({ attack: 0.008, decay: 0.22, sustain: 0.5, release: 0.35 }).connect(shade.input);
    const osc = Tone.getContext().rawContext.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(hz, time);
    Tone.connect(osc, env);
    const dur = Math.max(0.02, length);
    env.triggerAttackRelease(dur, time, velocity);
    osc.start(time);
    osc.stop(time + dur + 0.4);
    const note: DrawnNote = { osc, env, gone: false };
    shade.notes.push(note);
    osc.onended = () => {
      if (note.gone) return;
      note.gone = true;
      osc.disconnect();
      env.dispose();
      shade.notes = shade.notes.filter((n) => n !== note);
    };
    return true;
  }

  /** A cycle that holds until release. Null when this instrument has no cycle. */
  private attackCycle(id: string, hz: number, time: number, velocity: number): NoteGate | null {
    const shade = this.shades.get(id) ?? (this.programs.has(id) ? this.shade(id) : undefined);
    const wave = shade?.wave;
    if (!shade || !wave) return null;
    if (shade.notes.length >= MAX_DRAWN_NOTES) return NO_GATE;
    const env = new Tone.AmplitudeEnvelope({ attack: 0.008, decay: 0.22, sustain: 0.5, release: 0.35 }).connect(shade.input);
    const osc = Tone.getContext().rawContext.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(hz, time);
    Tone.connect(osc, env);
    env.triggerAttack(time, velocity);
    osc.start(time);
    const note: DrawnNote = { osc, env, gone: false };
    shade.notes.push(note);
    const finish = () => {
      if (note.gone) return;
      note.gone = true;
      osc.disconnect();
      env.dispose();
      shade.notes = shade.notes.filter((n) => n !== note);
    };
    osc.onended = finish;
    return {
      release: (at) => {
        if (note.gone) return;
        env.triggerRelease(at);
        try {
          osc.stop(at + 0.4);
        } catch {
          finish();
        }
      },
    };
  }

  private scheduleShade(shade: Shade, motions: MotionCurve[], baseTone: number, clock: BeatClock | null, now: number, until: number, park: boolean) {
    if (!motions.length) {
      if (!shade.automated && !shade.dirty) return;
      shade.automated = false;
      shade.dirty = false;
      shade.scheduledTo = 0;
      shade.filter.frequency.cancelScheduledValues(now);
      shade.filter.frequency.rampTo(shade.rest, 0.05);
      return;
    }
    const at = (time: number) => toneHz(movedTone(baseTone, motionSum(motions, clock ? clock.beatAt(time) : 0)));
    if (park) {
      shade.automated = true;
      shade.dirty = false;
      shade.scheduledTo = 0;
      shade.filter.frequency.cancelScheduledValues(now);
      shade.filter.frequency.rampTo(at(now), 0.04);
      return;
    }
    if (shade.dirty || !shade.automated || shade.scheduledTo < now - 0.05) {
      // The filter may have just been created, which already wrote a value at
      // this exact time. A second event there throws and must not escape.
      const when = Math.max(now, shade.scheduledTo) + 0.001;
      try {
        shade.filter.frequency.cancelScheduledValues(when);
        shade.filter.frequency.setValueAtTime(at(when), when);
      } catch {
        // The curve already covers this moment. Keep playing.
      }
      shade.scheduledTo = when;
      shade.automated = true;
      shade.dirty = false;
    }
    while (shade.scheduledTo < until - 0.001) {
      const next = Math.min(shade.scheduledTo + 0.02, until);
      try {
        shade.filter.frequency.linearRampToValueAtTime(at(next), next);
      } catch {
        shade.scheduledTo = until;
        break;
      }
      shade.scheduledTo = next;
    }
  }

  /** PluckSynth has no velocity argument, so the voice's volume carries it. */
  private pluck(hz: number, time: number, velocity: number, length: number) {
    const voice = this.pluckPool().take(time);
    if (!voice) return;
    voice.volume.setValueAtTime(-8 + Tone.gainToDb(Math.min(1, velocity)), time);
    voice.triggerAttack(hz, time);
    voice.triggerRelease(time + Math.max(0.05, length));
  }

  /** `length` in seconds cuts the sample short; null lets it ring to its end. */
  private playSample(sample: Tone.ToneAudioBuffer, rate: number, time: number, gain: number, length: number | null) {
    const note = new Tone.ToneBufferSource({ url: sample, playbackRate: rate, fadeOut: 0.01 }).connect(this.shade('tone').filter);
    note.onended = () => {
      this.sampleNotes = this.sampleNotes.filter((n) => n !== note);
      note.dispose();
    };
    note.start(time, 0, length ?? undefined, gain);
    this.sampleNotes.push(note);
    if (this.sampleNotes.length > MAX_SAMPLE_NOTES) this.sampleNotes[0].stop(time);
  }

  private attackSample(sample: Tone.ToneAudioBuffer, rate: number, time: number, gain: number): NoteGate {
    const note = new Tone.ToneBufferSource({ url: sample, playbackRate: rate, fadeOut: 0.02 }).connect(this.shade('tone').filter);
    let gone = false;
    const finish = () => {
      if (gone) return;
      gone = true;
      this.sampleNotes = this.sampleNotes.filter((n) => n !== note);
      note.dispose();
    };
    note.onended = finish;
    note.start(time, 0, undefined, gain);
    this.sampleNotes.push(note);
    if (this.sampleNotes.length > MAX_SAMPLE_NOTES) this.sampleNotes[0].stop(time);
    return {
      release: (at) => {
        if (gone) return;
        try {
          note.stop(at);
        } catch {
          finish();
        }
      },
    };
  }

  private attackDrawn(hz: number, time: number, velocity: number): NoteGate {
    const wave = this.drawnWave;
    if (!wave || this.drawnNotes.length >= MAX_DRAWN_NOTES) return NO_GATE;
    const env = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.3, sustain: 0.1, release: 0.8 }).connect(this.drawnInput());
    const osc = Tone.getContext().rawContext.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(hz, time);
    Tone.connect(osc, env);
    env.triggerAttack(time, velocity);
    osc.start(time);
    const note = { osc, env, gone: false };
    this.drawnNotes.push(note);
    const finish = () => {
      if (note.gone) return;
      note.gone = true;
      osc.disconnect();
      env.dispose();
      this.drawnNotes = this.drawnNotes.filter((n) => n !== note);
    };
    osc.onended = finish;
    return {
      release: (at) => {
        if (note.gone) return;
        env.triggerRelease(at);
        try {
          osc.stop(at + 0.85);
        } catch {
          finish();
        }
      },
    };
  }

  /** The same envelope as the triangle synth, so a cycle changes the timbre and not the shape of the note. */
  private playDrawn(hz: number, time: number, velocity: number, length: number) {
    const wave = this.drawnWave;
    if (!wave || this.drawnNotes.length >= MAX_DRAWN_NOTES) return;
    const env = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.3, sustain: 0.1, release: 0.8 }).connect(this.drawnInput());
    const osc = Tone.getContext().rawContext.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(hz, time);
    Tone.connect(osc, env);
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
    this.tone?.releaseAll(time);
    this.bass?.releaseAll(time);
    for (const pluck of this.plucks?.voices ?? []) pluck.triggerRelease(time);
    this.plucks?.releaseAll(time);
    for (const jaw of this.jawharps?.voices ?? []) jaw.release(time);
    this.jawharps?.releaseAll(time);
    this.khuur?.strings.releaseAll(time);
    this.khuur?.drone.releaseAll(time);
    this.catalog.silence(time);
    for (const shade of this.shades.values()) {
      for (const note of shade.notes) {
        note.env.triggerRelease(time);
        try {
          note.osc.stop(time);
        } catch {
          // Already stopped.
        }
      }
    }
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
    for (const note of this.drawnNotes) {
      note.gone = true;
      try {
        note.osc.disconnect();
      } catch {
        // Already disconnected.
      }
      note.env.dispose();
    }
    for (const part of this.built) part.dispose();
    this.built = [];
    this.catalog.dispose();
    for (const note of this.sampleNotes) note.dispose();
  }
}
