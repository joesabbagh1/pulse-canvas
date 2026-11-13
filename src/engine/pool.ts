// A few copies of a one-shot voice. Tone throws if one copy starts twice at the
// same instant. A held note stays reserved until it is released, so a later
// note cannot cut it off.

export class VoiceReserve {
  private last: number[];
  private held = new Set<number>();
  private next = 0;

  constructor(private readonly count: number) {
    this.last = Array.from({ length: count }, () => Number.NEGATIVE_INFINITY);
  }

  /** Index of a voice free at `time`, or null when every copy is busy. */
  take(time: number): number | null {
    for (let i = 0; i < this.count; i++) {
      const index = (this.next + i) % this.count;
      if (this.held.has(index)) continue;
      if (time > this.last[index] + 0.001) {
        this.last[index] = time;
        this.next = index + 1;
        return index;
      }
    }
    return null;
  }

  /** Like `take`, and the voice stays out until `free`. */
  hold(time: number): number | null {
    const index = this.take(time);
    if (index === null) return null;
    this.held.add(index);
    return index;
  }

  free(index: number, time: number) {
    this.held.delete(index);
    this.last[index] = time;
  }

  releaseAll(time: number) {
    this.held.clear();
    this.last.fill(time);
  }

  isHeld(index: number) {
    return this.held.has(index);
  }
}

export class Pool<T> {
  private reserve: VoiceReserve;

  constructor(readonly voices: T[]) {
    this.reserve = new VoiceReserve(voices.length);
  }

  take(time: number): T | null {
    const index = this.reserve.take(time);
    return index === null ? null : this.voices[index];
  }

  hold(time: number): { voice: T; index: number } | null {
    const index = this.reserve.hold(time);
    return index === null ? null : { voice: this.voices[index], index };
  }

  free(index: number, time: number) {
    this.reserve.free(index, time);
  }

  releaseAll(time: number) {
    this.reserve.releaseAll(time);
  }
}
