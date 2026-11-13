import type { Instrument } from './instruments';
import * as Tone from 'tone';

// A monophonic synth throws if it is started twice at the same instant, so
// notes rotate through a few copies and each copy only takes a later time.
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

type SustainInstrument = Instrument & { voice: 'sustain' };
type PluckInstrument = Instrument & {
  voice: 'pluck';
  dampening: number;
  resonance: number;
  attackNoise: number;
  release: number;
  gain: number;
};
type BowInstrument = Instrument & { voice: 'bow' };
type BlowInstrument = Instrument & { voice: 'blow' };
type MalletInstrument = Instrument & { voice: 'mallet' };
type DrumInstrument = Instrument & { voice: 'drum' };

function level(gain: number, velocity: number): number {
  return gain + Tone.gainToDb(Math.min(1, velocity));
}

function atTime(
  param: { cancelScheduledValues(time: number): void; setValueAtTime(value: number, time: number): void },
  value: number,
  time: number,
) {
  param.cancelScheduledValues(time);
  param.setValueAtTime(value, time);
}

/** A low drum falls farther: 4 octaves near 40 Hz, down to 2 by about 240 Hz. */
function membraneOctaves(freq: number): number {
  const climbed = (freq - 40) / 200;
  return 4 - 2 * Math.min(1, Math.max(0, climbed));
}

function armNoise(noise: Tone.NoiseSynth, decay: number, time: number, velocity: number, gain: number, duration = decay) {
  noise.envelope.attack = 0.001;
  noise.envelope.decay = decay;
  noise.envelope.sustain = 0;
  noise.envelope.release = Math.min(0.05, Math.max(0.01, decay));
  atTime(noise.volume, gain, time);
  noise.triggerAttackRelease(duration, time, Math.min(1, velocity));
}

class SustainVoice {
  private filter: Tone.Filter;
  synth: Tone.Synth;

  constructor(output: Tone.InputNode) {
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: 1200, rolloff: -12 }).connect(output);
    this.synth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.3 },
    }).connect(this.filter);
  }

  /** Retune the lowpass at `time` without leaving a later automation from the previous note. */
  cutoff(freq: number, time: number) {
    atTime(this.filter.frequency, freq, time);
  }

  dispose() {
    this.synth.dispose();
    this.filter.dispose();
  }
}

class BowVoice {
  private filter: Tone.Filter;
  synth: Tone.Synth;
  private lfo: Tone.LFO;

  constructor(output: Tone.InputNode) {
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: 1800, rolloff: -12 }).connect(output);
    this.synth = new Tone.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.08, decay: 0.15, sustain: 0.8, release: 0.4 },
    }).connect(this.filter);
    this.lfo = new Tone.LFO({ frequency: 4.8, min: 0, max: 0 });
    this.lfo.connect(this.synth.detune);
    this.lfo.start();
  }

  cutoff(freq: number, time: number) {
    atTime(this.filter.frequency, freq, time);
  }

  /** Vibrato depth is in cents. The LFO itself is already running. */
  vibrato(cents: number) {
    this.lfo.min = -cents;
    this.lfo.max = cents;
  }

  dispose() {
    this.lfo.dispose();
    this.synth.dispose();
    this.filter.dispose();
  }
}

class BlowVoice {
  private filter: Tone.Filter;
  synth: Tone.Synth;
  private breathFilter: Tone.Filter;
  breath: Tone.NoiseSynth;
  private lfo: Tone.LFO;

  constructor(output: Tone.InputNode) {
    this.filter = new Tone.Filter({ type: 'bandpass', frequency: 440, Q: 2, rolloff: -12 }).connect(output);
    this.synth = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.04, decay: 0.12, sustain: 0.7, release: 0.2 },
    }).connect(this.filter);
    this.breathFilter = new Tone.Filter({ type: 'highpass', frequency: 800, rolloff: -12 }).connect(output);
    this.breath = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.004, decay: 0.08, sustain: 0, release: 0.04 },
      volume: -30,
    }).connect(this.breathFilter);
    this.lfo = new Tone.LFO({ frequency: 4.8, min: 0, max: 0 });
    this.lfo.connect(this.synth.detune);
    this.lfo.start();
  }

  /** The band follows the note, at the preset's Q. */
  formant(freq: number, q: number, time: number) {
    atTime(this.filter.frequency, freq, time);
    atTime(this.filter.Q, q, time);
  }

  vibrato(cents: number) {
    this.lfo.min = -cents;
    this.lfo.max = cents;
  }

  dispose() {
    this.lfo.dispose();
    this.breath.dispose();
    this.synth.dispose();
    this.breathFilter.dispose();
    this.filter.dispose();
  }
}

type NoiseChain = { filter: Tone.Filter; noise: Tone.NoiseSynth };

class DrumVoice {
  private membrane: Tone.MembraneSynth | null = null;
  private snare: (NoiseChain & { body: Tone.MembraneSynth }) | null = null;
  private hat: NoiseChain | null = null;
  private cymbal: NoiseChain | null = null;
  private clap: { noise: Tone.NoiseSynth; echo: Tone.NoiseSynth } | null = null;
  private shake: NoiseChain | null = null;
  private wood: Tone.Synth | null = null;
  private fx: NoiseChain | null = null;

  constructor(private output: Tone.InputNode) {}

  hit(inst: DrumInstrument, hz: number, time: number, velocity: number, length: number | null) {
    switch (inst.hit) {
      case 'membrane':
        this.hitMembrane(inst, hz, time, velocity);
        break;
      case 'snare':
        this.hitSnare(inst, time, velocity);
        break;
      case 'hat':
        this.hitHat(inst, time, velocity);
        break;
      case 'cymbal':
        this.hitCymbal(inst, time, velocity);
        break;
      case 'clap':
        this.hitClap(inst, time, velocity);
        break;
      case 'shake':
        this.hitShake(inst, time, velocity);
        break;
      case 'wood':
        this.hitWood(inst, hz, time, velocity);
        break;
      case 'noise':
        this.hitNoise(inst, time, velocity, length);
        break;
    }
  }

  release(time: number) {
    this.membrane?.triggerRelease(time);
    this.snare?.noise.triggerRelease(time);
    this.snare?.body.triggerRelease(time);
    this.hat?.noise.triggerRelease(time);
    this.cymbal?.noise.triggerRelease(time);
    this.clap?.noise.triggerRelease(time);
    this.clap?.echo.triggerRelease(time);
    this.shake?.noise.triggerRelease(time);
    this.wood?.triggerRelease(time);
    this.fx?.noise.triggerRelease(time);
  }

  dispose() {
    this.membrane?.dispose();
    if (this.snare) {
      this.snare.noise.dispose();
      this.snare.body.dispose();
      this.snare.filter.dispose();
    }
    this.disposeChain(this.hat);
    this.disposeChain(this.cymbal);
    if (this.clap) {
      this.clap.noise.dispose();
      this.clap.echo.dispose();
    }
    this.disposeChain(this.shake);
    this.wood?.dispose();
    this.disposeChain(this.fx);
  }

  private disposeChain(chain: NoiseChain | null) {
    if (!chain) return;
    chain.noise.dispose();
    chain.filter.dispose();
  }

  private filtered(type: BiquadFilterType, frequency: number, q: number): NoiseChain {
    const filter = new Tone.Filter({ type, frequency, Q: q, rolloff: -12 }).connect(this.output);
    const noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.03 },
    }).connect(filter);
    return { filter, noise };
  }

  private hitMembrane(inst: DrumInstrument, hz: number, time: number, velocity: number) {
    const freq = inst.pitched ? hz : inst.tune;
    if (!(freq > 0)) return;
    const drum = (this.membrane ??= new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.05 },
    }).connect(this.output));
    drum.pitchDecay = 0.03;
    drum.octaves = membraneOctaves(freq);
    drum.envelope.attack = 0.001;
    drum.envelope.decay = inst.decay;
    drum.envelope.sustain = 0;
    drum.envelope.release = Math.min(0.05, Math.max(0.01, inst.decay));
    atTime(drum.volume, inst.gain, time);
    drum.triggerAttackRelease(freq, Math.min(0.2, inst.decay), time, velocity);
  }

  private hitSnare(inst: DrumInstrument, time: number, velocity: number) {
    const snare = (this.snare ??= {
      ...this.filtered('bandpass', 1800, 0.8),
      body: new Tone.MembraneSynth({
        pitchDecay: 0.012,
        octaves: 2.4,
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 },
        volume: -8,
      }).connect(this.output),
    });
    armNoise(snare.noise, inst.decay, time, velocity, inst.gain);
    if (!(inst.tune > 0)) return;
    snare.body.pitchDecay = 0.012;
    snare.body.octaves = 2.4;
    snare.body.envelope.attack = 0.001;
    snare.body.envelope.decay = Math.min(0.1, inst.decay);
    snare.body.envelope.sustain = 0;
    snare.body.envelope.release = 0.02;
    atTime(snare.body.volume, inst.gain - 6, time);
    snare.body.triggerAttackRelease(inst.tune, Math.min(0.06, Math.max(0.02, inst.decay)), time, velocity);
  }

  private hitHat(inst: DrumInstrument, time: number, velocity: number) {
    const hat = (this.hat ??= this.filtered('highpass', 7000, 0.7));
    atTime(hat.filter.frequency, inst.tune > 1000 ? inst.tune : 7000, time);
    armNoise(hat.noise, inst.decay, time, velocity, inst.gain);
  }

  private hitCymbal(inst: DrumInstrument, time: number, velocity: number) {
    const cymbal = (this.cymbal ??= this.filtered('bandpass', 6500, 0.9));
    atTime(cymbal.filter.frequency, inst.tune > 0 ? inst.tune : 6500, time);
    armNoise(cymbal.noise, inst.decay, time, velocity, inst.gain);
  }

  private hitClap(inst: DrumInstrument, time: number, velocity: number) {
    const clap = (this.clap ??= {
      noise: new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 },
      }).connect(this.output),
      echo: new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 },
      }).connect(this.output),
    });
    armNoise(clap.noise, inst.decay, time, velocity, inst.gain);
    // A second, quieter tap. Its own synth, and only when the hit is long enough to fit 12ms later.
    if (inst.decay >= 0.012) armNoise(clap.echo, inst.decay, time + 0.012, velocity * 0.55, inst.gain);
  }

  private hitShake(inst: DrumInstrument, time: number, velocity: number) {
    const shake = (this.shake ??= this.filtered('bandpass', 4000, 1.2));
    atTime(shake.filter.frequency, inst.tune > 0 ? inst.tune : 4000, time);
    armNoise(shake.noise, inst.decay, time, velocity, inst.gain);
  }

  private hitWood(inst: DrumInstrument, hz: number, time: number, velocity: number) {
    const freq = inst.pitched ? hz : inst.tune;
    if (!(freq > 0)) return;
    const wood = (this.wood ??= new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    }).connect(this.output));
    wood.envelope.attack = 0.001;
    wood.envelope.decay = inst.decay;
    wood.envelope.sustain = 0;
    wood.envelope.release = Math.min(0.05, Math.max(0.005, inst.decay));
    atTime(wood.volume, inst.gain, time);
    wood.triggerAttackRelease(freq, Math.max(0.01, inst.decay), time, velocity);
  }

  private hitNoise(inst: DrumInstrument, time: number, velocity: number, length: number | null) {
    const fx = (this.fx ??= this.filtered('lowpass', 1000, 0.6));
    const dur = Math.max(inst.decay, length ?? inst.decay);
    const center = inst.tune > 0 ? inst.tune : 1000;
    const low = center < 800;
    // Low tunes rumble under a lowpass (a shot, a rotor, the shore). Higher tunes sit in a band.
    fx.filter.type = low ? 'lowpass' : 'bandpass';
    atTime(fx.filter.frequency, center, time);
    atTime(fx.filter.Q, low ? 0.5 : 0.7, time);
    fx.noise.noise.type = center < 400 ? 'brown' : center < 3500 ? 'pink' : 'white';
    const held = length !== null && length > inst.decay;
    fx.noise.envelope.attack = 0.01;
    fx.noise.envelope.decay = inst.decay;
    fx.noise.envelope.sustain = held ? 0.6 : 0;
    fx.noise.envelope.release = Math.min(0.3, Math.max(0.05, dur));
    atTime(fx.noise.volume, inst.gain, time);
    fx.noise.triggerAttackRelease(Math.max(0.02, dur), time, velocity);
  }
}

/** Catalog instruments other than the built-in tone, pluck, bass, jaw harp, khuur, and kit. */
export class CatalogVoices {
  private sustain: Pool<SustainVoice> | null = null;
  private pluck: Pool<Tone.PluckSynth> | null = null;
  private bow: Pool<BowVoice> | null = null;
  private blow: Pool<BlowVoice> | null = null;
  private mallet: Pool<Tone.FMSynth> | null = null;
  private drum: Pool<DrumVoice> | null = null;

  constructor(private output: Tone.InputNode) {}

  /** length null means use a default for that voice. secondsPerBeat is the tempo. Built-in voices (tone, pluck, bass, jawharp, khuur, kick, snare, hat) are ignored here. */
  play(inst: Instrument, hz: number, time: number, velocity: number, length: number | null, secondsPerBeat: number): void {
    if (velocity <= 0) return;
    switch (inst.voice) {
      case 'sustain':
        this.playSustain(inst, hz, time, velocity, length, secondsPerBeat, true);
        return;
      case 'pluck':
        if ('dampening' in inst) this.playPluck(inst, hz, time, velocity, length, secondsPerBeat);
        return;
      case 'bow':
        this.playBow(inst, hz, time, velocity, length, secondsPerBeat, true);
        return;
      case 'blow':
        this.playBlow(inst, hz, time, velocity, length, secondsPerBeat, true);
        return;
      case 'mallet':
        this.playMallet(inst, hz, time, velocity, length);
        return;
      case 'drum':
        this.playDrum(inst, hz, time, velocity, length);
        return;
      case 'tone':
      case 'bass':
      case 'jawharp':
      case 'khuur':
      case 'kick':
      case 'snare':
      case 'hat':
        return;
    }
  }

  silence(time: number) {
    if (this.sustain) for (const voice of this.sustain.voices) voice.synth.triggerRelease(time);
    if (this.pluck) for (const voice of this.pluck.voices) voice.triggerRelease(time);
    if (this.bow) for (const voice of this.bow.voices) voice.synth.triggerRelease(time);
    if (this.blow) {
      for (const voice of this.blow.voices) {
        voice.synth.triggerRelease(time);
        voice.breath.triggerRelease(time);
      }
    }
    if (this.mallet) for (const voice of this.mallet.voices) voice.triggerRelease(time);
    if (this.drum) for (const voice of this.drum.voices) voice.release(time);
  }

  dispose() {
    if (this.sustain) for (const voice of this.sustain.voices) voice.dispose();
    if (this.pluck) for (const voice of this.pluck.voices) voice.dispose();
    if (this.bow) for (const voice of this.bow.voices) voice.dispose();
    if (this.blow) for (const voice of this.blow.voices) voice.dispose();
    if (this.mallet) for (const voice of this.mallet.voices) voice.dispose();
    if (this.drum) for (const voice of this.drum.voices) voice.dispose();
  }

  private sustainPool(): Pool<SustainVoice> {
    return (this.sustain ??= new Pool(Array.from({ length: 8 }, () => new SustainVoice(this.output))));
  }

  private pluckPool(): Pool<Tone.PluckSynth> {
    return (this.pluck ??= new Pool(
      Array.from({ length: 6 }, () => new Tone.PluckSynth({ attackNoise: 1, dampening: 4000, resonance: 0.7, release: 0.4 }).connect(this.output)),
    ));
  }

  private bowPool(): Pool<BowVoice> {
    return (this.bow ??= new Pool(Array.from({ length: 4 }, () => new BowVoice(this.output))));
  }

  private blowPool(): Pool<BlowVoice> {
    return (this.blow ??= new Pool(Array.from({ length: 4 }, () => new BlowVoice(this.output))));
  }

  private malletPool(): Pool<Tone.FMSynth> {
    return (this.mallet ??= new Pool(
      Array.from(
        { length: 4 },
        () =>
          new Tone.FMSynth({
            harmonicity: 4,
            modulationIndex: 2,
            oscillator: { type: 'sine' },
            modulation: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 },
            modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.08 },
          }).connect(this.output),
      ),
    ));
  }

  private drumPool(): Pool<DrumVoice> {
    return (this.drum ??= new Pool(Array.from({ length: 6 }, () => new DrumVoice(this.output))));
  }

  private playSustain(
    inst: SustainInstrument,
    hz: number,
    time: number,
    velocity: number,
    length: number | null,
    secondsPerBeat: number,
    withFifth: boolean,
  ) {
    if (!(velocity > 0)) return;
    const voice = this.sustainPool().take(time);
    if (!voice) return;
    const vel = Math.min(1, velocity);
    const osc = voice.synth.oscillator;
    osc.type = inst.wave;
    if (inst.wave === 'fatsawtooth') {
      osc.count = 2;
      osc.spread = inst.spread ?? 15;
    }
    voice.synth.envelope.attack = inst.attack;
    voice.synth.envelope.decay = inst.decay;
    voice.synth.envelope.sustain = inst.sustain;
    voice.synth.envelope.release = inst.release;
    voice.cutoff(inst.cutoff, time);
    atTime(voice.synth.volume, level(inst.gain, vel), time);
    const duration = length ?? Math.min(1.6, Math.max(0.25, secondsPerBeat));
    voice.synth.triggerAttackRelease(hz, duration, time, vel);
    if (!withFifth || !inst.fifth) return;
    const below = hz / 1.5;
    if (below < 40) return;
    this.playSustain(inst, below, time, vel * 0.55, length, secondsPerBeat, false);
  }

  private playPluck(inst: PluckInstrument, hz: number, time: number, velocity: number, length: number | null, secondsPerBeat: number) {
    if (!(velocity > 0)) return;
    const voice = this.pluckPool().take(time);
    if (!voice) return;
    voice.dampening = inst.dampening;
    voice.resonance = inst.resonance;
    voice.attackNoise = inst.attackNoise;
    voice.release = inst.release;
    atTime(voice.volume, level(inst.gain, velocity), time);
    voice.triggerAttack(hz, time);
    voice.triggerRelease(time + Math.max(0.05, length ?? Math.min(0.55, secondsPerBeat * 0.5)));
  }

  private playBow(
    inst: BowInstrument,
    hz: number,
    time: number,
    velocity: number,
    length: number | null,
    secondsPerBeat: number,
    withDrone: boolean,
  ) {
    if (!(velocity > 0)) return;
    const voice = this.bowPool().take(time);
    if (!voice) return;
    const vel = Math.min(1, velocity);
    voice.synth.envelope.attack = inst.attack;
    voice.vibrato(inst.vibrato);
    voice.cutoff(inst.cutoff, time);
    atTime(voice.synth.volume, level(inst.gain, vel), time);
    const duration = length ?? Math.min(1.8, Math.max(0.35, secondsPerBeat));
    voice.synth.triggerAttackRelease(hz, duration, time, vel);
    if (!withDrone || !inst.drone) return;
    const below = hz / 1.5;
    if (below < 45) return;
    this.playBow(inst, below, time, vel * 0.5, length, secondsPerBeat, false);
  }

  private playBlow(
    inst: BlowInstrument,
    hz: number,
    time: number,
    velocity: number,
    length: number | null,
    secondsPerBeat: number,
    withDrone: boolean,
  ) {
    if (!(velocity > 0)) return;
    const voice = this.blowPool().take(time);
    if (!voice) return;
    const vel = Math.min(1, velocity);
    voice.synth.oscillator.type = inst.wave;
    voice.synth.envelope.attack = inst.attack;
    voice.synth.envelope.decay = 0.12;
    voice.synth.envelope.sustain = inst.sustain;
    voice.synth.envelope.release = inst.release;
    voice.formant(hz, inst.q, time);
    voice.vibrato(inst.vibrato);
    atTime(voice.synth.volume, level(inst.gain, vel), time);
    const duration = length ?? Math.min(1.4, Math.max(0.3, secondsPerBeat));
    voice.synth.triggerAttackRelease(hz, duration, time, vel);
    const puff = 0.08 + inst.breath * 0.2;
    voice.breath.envelope.attack = 0.004;
    voice.breath.envelope.decay = puff;
    voice.breath.envelope.sustain = 0;
    voice.breath.envelope.release = Math.min(0.04, Math.max(0.01, puff));
    // Quiet air, a little louder as the breath amount rises, and it follows the note's level.
    atTime(voice.breath.volume, level(inst.gain, vel) - 18 + inst.breath * 6, time);
    voice.breath.triggerAttackRelease(puff, time, vel);
    if (!withDrone || !inst.drone) return;
    const below = hz / 1.5;
    if (below < 45) return;
    this.playBlow(inst, below, time, vel * 0.45, length, secondsPerBeat, false);
  }

  private playMallet(inst: MalletInstrument, hz: number, time: number, velocity: number, length: number | null) {
    if (!(velocity > 0)) return;
    const voice = this.malletPool().take(time);
    if (!voice) return;
    const vel = Math.min(1, velocity);
    const release = Math.min(0.2, inst.decay);
    voice.oscillator.type = 'sine';
    voice.modulation.type = 'sine';
    atTime(voice.harmonicity, inst.ratio, time);
    atTime(voice.modulationIndex, inst.index, time);
    voice.envelope.attack = 0.001;
    voice.envelope.decay = inst.decay;
    voice.envelope.sustain = 0;
    voice.envelope.release = release;
    voice.modulationEnvelope.attack = 0.001;
    voice.modulationEnvelope.decay = Math.max(0.005, inst.decay * 0.6);
    voice.modulationEnvelope.sustain = 0;
    voice.modulationEnvelope.release = Math.min(0.1, release);
    atTime(voice.volume, level(inst.gain, vel), time);
    const duration = length ?? Math.min(1.2, Math.max(0.08, inst.decay));
    voice.triggerAttackRelease(hz, duration, time, vel);
  }

  private playDrum(inst: DrumInstrument, hz: number, time: number, velocity: number, length: number | null) {
    if (!(velocity > 0)) return;
    const voice = this.drumPool().take(time);
    if (!voice) return;
    voice.hit(inst, hz, time, Math.min(1, velocity), length);
  }
}
