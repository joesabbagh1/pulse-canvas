import type { Bed, BedClip } from '../bed';
import type { BeatClock } from './clock';

// Plays the background slices on the audio clock, at the file's own speed.
// A slice scheduled once stays; a later pass does not start it again. Stop
// forgets them, so a tempo change or an edit can schedule the rest afresh.

const MIN_LATE = 0.012;

function amp(clip: BedClip, t: number): number {
  let a = 1;
  if (clip.fadeIn > 0) a *= Math.min(1, Math.max(0, t) / clip.fadeIn);
  if (clip.fadeOut > 0) a *= Math.min(1, Math.max(0, clip.seconds - t) / clip.fadeOut);
  return clip.gain * Math.max(0, Math.min(1, a));
}

export class BedPlayer {
  private buffer: AudioBuffer | null = null;
  private live: AudioBufferSourceNode[] = [];
  private armed = new Set<string>();

  constructor(private dest: AudioNode) {}

  setBuffer(buffer: AudioBuffer | null) {
    this.buffer = buffer;
  }

  stop(time: number) {
    for (const source of this.live) {
      try {
        source.stop(time);
      } catch {
        // Already stopped.
      }
    }
    this.live = [];
    this.armed.clear();
  }

  /**
   * Starts any slice that begins before `until` and is still going at `now`.
   * `now` and `until` are audio times.
   */
  advance(bed: Bed | null, clock: BeatClock, now: number, until: number) {
    const buffer = this.buffer;
    if (!bed || !buffer) return;
    const ctx = this.dest.context;
    for (const clip of bed.clips) {
      if (clip.mute || !(clip.gain > 0) || !(clip.seconds > MIN_LATE)) continue;
      const origin = clock.timeAt(clip.beat);
      const end = origin + clip.seconds;
      if (end <= now + 0.005 || origin >= until) continue;
      const when = Math.max(origin, now + 0.015);
      const late = when - origin;
      if (late >= clip.seconds - MIN_LATE) continue;
      const key = `${clip.id}@${origin.toFixed(4)}`;
      if (this.armed.has(key)) continue;
      this.armed.add(key);
      const offset = Math.min(buffer.duration, Math.max(0, clip.offset + late));
      const duration = Math.min(clip.seconds - late, Math.max(0, buffer.duration - offset));
      if (!(duration > MIN_LATE)) continue;
      const gain = ctx.createGain();
      gain.connect(this.dest);
      gain.gain.setValueAtTime(amp(clip, late), when);
      const fadeInEnd = origin + clip.fadeIn;
      if (fadeInEnd > when + 0.005) gain.gain.linearRampToValueAtTime(clip.gain, fadeInEnd);
      const fadeOutAt = end - clip.fadeOut;
      if (clip.fadeOut > 0.005 && fadeOutAt < end - 0.005) {
        const from = Math.max(when + 0.005, fadeOutAt);
        gain.gain.setValueAtTime(amp(clip, from - origin), from);
        gain.gain.linearRampToValueAtTime(0, end);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.onended = () => {
        gain.disconnect();
        this.live = this.live.filter((item) => item !== source);
      };
      try {
        source.start(when, offset, duration);
        this.live.push(source);
      } catch {
        this.armed.delete(key);
        gain.disconnect();
      }
    }
  }
}
