import * as Tone from 'tone';
import { BeatClock } from './clock';
import { grooveNote } from './groove';
import { HoldBook } from './holds';
import { Mixer, type BusSettings } from './mixer';
import { WavRecorder } from './recorder';
import { loadSampleBytes } from './samples';
import { Scheduler, type GraphBlock, type GraphLink, type NoteShape } from './scheduler';
import { busWavesKey, type BusWaves } from './wave';

// Sound is scheduled on the audio clock, a little ahead of time, never from
// animation frames. Each tick commits every hit due in the next LOOKAHEAD
// seconds; pulses further out stay flexible so dragging can still move them.
const LOOKAHEAD = 0.2;
const TICK = 0.025;

export interface Flash {
  block: string;
  time: number;
  shown: boolean;
  /** The note's velocity, so soft notes flash faintly. */
  strength: number;
}

export class Engine {
  readonly clock = new BeatClock(112);
  readonly scheduler = new Scheduler((block, beat, shift, shape) => this.hit(block, beat, shift, shape));
  flashes: Flash[] = [];

  // Built lazily, since Tone nodes want a started context.
  private mixer: Mixer | null = null;
  private buses = new Map<string, BusSettings>();
  private samples = new Map<string, Tone.ToneAudioBuffer>();
  private loading = new Map<string, Promise<void>>();
  private recorder: WavRecorder | null = null;
  private interval: number | null = null;
  private starting = false;
  private waveProgram = new Map<string, BusWaves>();
  private waveKey = '';
  private holds = new HoldBook();

  get playing() {
    return this.scheduler.playing;
  }

  get recording() {
    return this.recorder !== null;
  }

  /** How much has been recorded so far. */
  get recordedSeconds() {
    return this.recorder?.seconds ?? 0;
  }

  /** Records everything heard until stopRecording; playing and stopping carry on as usual. */
  async startRecording() {
    if (this.recorder) return;
    const mixer = await this.ensureAudio();
    this.recorder = await WavRecorder.start(mixer.output);
  }

  /** The recording so far, as a WAV file. */
  async stopRecording(): Promise<Blob | null> {
    const recorder = this.recorder;
    this.recorder = null;
    return recorder ? recorder.stop() : null;
  }

  async play() {
    if (this.playing || this.starting) return;
    this.starting = true;
    try {
      const mixer = await this.ensureAudio();
      mixer.silence(this.audioNow());
      this.holds.dropAll();
      this.clock.reset(this.audioNow() + 0.1);
      this.scheduler.start(0);
      this.interval = Tone.getContext().setInterval(() => this.tick(), TICK);
      this.tick();
    } finally {
      this.starting = false;
    }
  }

  stop() {
    if (this.interval !== null) Tone.getContext().clearInterval(this.interval);
    this.interval = null;
    this.scheduler.stop();
    this.flashes = [];
    const now = this.audioNow();
    this.mixer?.silence(now);
    this.holds.dropAll();
    // Leave the filter where the motion starts, so the next play matches the dot on the left.
    this.mixer?.park(this.buses, now);
  }

  /** Play one block's sound right now, outside the pulse flow. */
  async audition(block: GraphBlock) {
    const mixer = await this.ensureAudio();
    mixer.play(block, this.audioNow() + 0.01, this.clock.secondsPerBeat);
  }

  /**
   * Start a live note and return its handle. The handle exists before the
   * audio context is ready, so `release` can win the race and the note will
   * not be left sounding.
   */
  attack(block: GraphBlock, velocity = 1): number {
    const id = this.holds.open();
    void this.ensureAudio()
      .then((mixer) => {
        const time = this.audioNow() + 0.01;
        const gate = mixer.attack(block, time, this.clock.secondsPerBeat, velocity);
        this.holds.start(id, this.audioNow(), gate);
      })
      .catch((err) => {
        console.warn('Live note failed to start', err);
        this.holds.release(id, this.audioNow());
      });
    return id;
  }

  /** End the live note started by `attack`. */
  release(id: number) {
    this.holds.release(id, this.audioNow());
  }

  setGraph(blocks: GraphBlock[], links: GraphLink[]) {
    this.scheduler.setGraph(blocks, links, this.currentBeat());
  }

  /** Each region's mix, effects and sample, by region id. */
  setBuses(buses: Map<string, BusSettings>) {
    this.buses = buses;
    if (!this.mixer) return;
    this.mixer.sync(buses, this.clock.secondsPerBeat);
    this.applyWaves();
    void this.loadSamples();
  }

  /** Drawn cycles and cutoff motions, keyed by region id. '' is outside every region. */
  setWaves(program: Map<string, BusWaves>) {
    const key = busWavesKey(program);
    if (key === this.waveKey) return;
    this.waveKey = key;
    this.waveProgram = program;
    this.applyWaves();
  }

  /** Decodes a stored sample so tones can play it. Rejects if it's gone or isn't audio. */
  loadSample(id: string): Promise<void> {
    if (this.samples.has(id)) return Promise.resolve();
    let loading = this.loading.get(id);
    if (!loading) {
      loading = (async () => {
        const bytes = await loadSampleBytes(id);
        if (!bytes) throw new Error('the file is no longer stored in this browser.');
        const audio = await Tone.getContext().decodeAudioData(bytes.slice(0));
        this.samples.set(id, new Tone.ToneAudioBuffer(audio));
      })().finally(() => this.loading.delete(id));
      this.loading.set(id, loading);
    }
    return loading;
  }

  setSnap(snap: boolean) {
    this.scheduler.setSnap(snap, this.currentBeat());
  }

  setBpm(bpm: number) {
    this.clock.setBpm(bpm, this.playing ? this.audioNow() : 0);
    // Echo times are in beats, and a tempo change retimes the filter motions too.
    if (!this.mixer) return;
    this.mixer.sync(this.buses, this.clock.secondsPerBeat);
    this.applyWaves();
  }

  fire(blockId: string) {
    this.scheduler.fire(blockId, this.currentBeat());
  }

  // The beat clock is only anchored while playing (and the audio context only
  // runs after a click), so edits made while stopped happen at beat 0.
  currentBeat() {
    return this.playing ? this.clock.beatAt(this.audioNow()) : 0;
  }

  /** The audio time reaching the speakers right now, for drawing in sync. */
  heardNow() {
    const raw = Tone.getContext().rawContext as unknown as AudioContext;
    return this.audioNow() - (raw.outputLatency || raw.baseLatency || 0);
  }

  private audioNow() {
    return Tone.getContext().currentTime;
  }

  private async ensureAudio() {
    await Tone.start();
    if (!this.mixer) {
      this.mixer = new Mixer(this.samples);
      this.mixer.sync(this.buses, this.clock.secondsPerBeat);
    }
    await this.loadSamples();
    this.applyWaves();
    return this.mixer;
  }

  /** Puts the current drawings on every bus, and the filter on the right curve. */
  private applyWaves() {
    if (!this.mixer) return;
    this.mixer.install(this.waveProgram);
    const now = this.audioNow();
    if (this.playing) this.mixer.advance(this.clock, this.buses, now, now + LOOKAHEAD);
    else this.mixer.park(this.buses, now);
  }

  // A sample that can't load leaves its region on the synth rather than silent.
  private async loadSamples() {
    const ids = new Set([...this.buses.values()].flatMap((b) => (b.sample ? [b.sample] : [])));
    await Promise.all([...ids].map((id) => this.loadSample(id).catch((err) => console.warn(`Sample ${id} not loaded:`, err))));
  }

  private tick() {
    const now = this.audioNow();
    this.scheduler.advance(this.clock.beatAt(now + LOOKAHEAD));
    this.scheduler.prune(this.clock.beatAt(now) - 1);
    this.flashes = this.flashes.filter((f) => f.time > now - 1);
    this.mixer?.advance(this.clock, this.buses, now, now + LOOKAHEAD);
  }

  /** `shift` is the pulse's transposition, in scale degrees. */
  private hit(block: GraphBlock, beat: number, shift: number, shape: NoteShape) {
    // The region's groove shifts the sound only; the pulse already arrived on the beat.
    const groove = block.bus ? this.buses.get(block.bus)?.groove : undefined;
    const nudge = groove ? grooveNote(beat, groove, this.clock.secondsPerBeat) : { seconds: 0, velocity: 1 };
    const time = Math.max(this.clock.timeAt(beat) + nudge.seconds, this.audioNow() + 0.005);
    const felt = { ...shape, velocity: shape.velocity * nudge.velocity };
    this.mixer?.play({ ...block, degree: block.degree + shift }, time, this.clock.secondsPerBeat, felt);
    this.flashes.push({ block: block.id, time, shown: false, strength: felt.velocity });
  }
}
