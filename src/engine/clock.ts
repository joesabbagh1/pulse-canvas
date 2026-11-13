// Maps audio-clock seconds to musical beats. Everything in the scheduler is
// measured in beats, so a tempo change is just a re-anchor here: no pulse has
// to be retimed.
export class BeatClock {
  private anchorTime = 0;
  private anchorBeat = 0;

  constructor(public bpm: number) {}

  get secondsPerBeat() {
    return 60 / this.bpm;
  }

  /** Make `time` beat 0. */
  reset(time: number) {
    this.anchorTime = time;
    this.anchorBeat = 0;
  }

  setBpm(bpm: number, now: number) {
    this.anchorBeat = this.beatAt(now);
    this.anchorTime = now;
    this.bpm = bpm;
  }

  beatAt(time: number) {
    return this.anchorBeat + (time - this.anchorTime) / this.secondsPerBeat;
  }

  timeAt(beat: number) {
    return this.anchorTime + (beat - this.anchorBeat) * this.secondsPerBeat;
  }
}
