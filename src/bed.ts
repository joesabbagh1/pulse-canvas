import type { SampleRef } from './engine/samples';
import { GRID } from './engine/geometry';

// A background file, cut into slices that sit on the beat. Each slice plays
// the file at its own speed: one second of audio is one second, so its length
// in beats follows the tempo. Moving a slice changes when it starts. Trimming
// changes which part of the file you hear.

export const MIN_CLIP_SECONDS = 0.05;
export const MAX_BED_CLIPS = 64;
/** Thirty minutes. A saved piece that claims more is cut back. */
export const MAX_BED_SECONDS = 30 * 60;

export interface BedClip {
  id: string;
  /** Beat in the piece where this slice starts. */
  beat: number;
  /** Seconds into the file. */
  offset: number;
  /** Seconds of the file this slice plays. */
  seconds: number;
  /** 0 to 1, on top of the track's own level. */
  gain: number;
  /** Fade in, in seconds, from the start of the slice. */
  fadeIn: number;
  /** Fade out, in seconds, into the end of the slice. */
  fadeOut: number;
  mute: boolean;
}

export interface Bed {
  sample: SampleRef;
  /** The whole file, in seconds. */
  duration: number;
  /** 0 to 1. Every slice goes through this. */
  level: number;
  clips: BedClip[];
}

/** One slice that plays the whole file from beat 0. */
export function wholeClip(duration: number, id = 'bed-1'): BedClip {
  return { id, beat: 0, offset: 0, seconds: Math.max(MIN_CLIP_SECONDS, duration), gain: 1, fadeIn: 0, fadeOut: 0, mute: false };
}

export function clipBeats(clip: BedClip, secondsPerBeat: number): number {
  return secondsPerBeat > 0 ? clip.seconds / secondsPerBeat : 0;
}

function snapTo(beat: number, snap: boolean): number {
  const next = snap ? Math.round(beat / GRID) * GRID : beat;
  return Math.max(0, next);
}

function fitFades(clip: BedClip): BedClip {
  const fadeIn = Math.min(Math.max(0, clip.fadeIn), clip.seconds);
  const fadeOut = Math.min(Math.max(0, clip.fadeOut), Math.max(0, clip.seconds - fadeIn));
  return { ...clip, fadeIn, fadeOut };
}

export function moveClip(clip: BedClip, beat: number, snap: boolean): BedClip {
  return { ...clip, beat: snapTo(beat, snap) };
}

/**
 * `deltaBeats` is how far the edge moved: right is positive. The start edge
 * keeps the audio under a beat where it was, so dragging it right also starts
 * later in the file. The end edge only changes how much of the file plays.
 */
export function trimClip(clip: BedClip, edge: 'start' | 'end', deltaBeats: number, secondsPerBeat: number, fileDuration: number, snap: boolean): BedClip {
  const delta = snapTo(Math.abs(deltaBeats), snap) * Math.sign(deltaBeats) * secondsPerBeat;
  if (edge === 'start') {
    const next = Math.min(clip.seconds - MIN_CLIP_SECONDS, Math.max(-clip.offset, delta));
    return fitFades({
      ...clip,
      beat: clip.beat + next / secondsPerBeat,
      offset: clip.offset + next,
      seconds: clip.seconds - next,
    });
  }
  const room = Math.max(0, fileDuration - clip.offset);
  const seconds = Math.min(room, Math.max(MIN_CLIP_SECONDS, clip.seconds + delta));
  return fitFades({ ...clip, seconds });
}

/** Cuts a slice in two at `atSeconds` into it. The right-hand slice gets `id`. */
export function splitClip(clip: BedClip, atSeconds: number, secondsPerBeat: number, id: string): [BedClip, BedClip] | null {
  if (!(atSeconds >= MIN_CLIP_SECONDS && atSeconds <= clip.seconds - MIN_CLIP_SECONDS)) return null;
  const rest = clip.seconds - atSeconds;
  const left = fitFades({ ...clip, seconds: atSeconds, fadeOut: 0 });
  const right = fitFades({
    ...clip,
    id,
    beat: clip.beat + atSeconds / secondsPerBeat,
    offset: clip.offset + atSeconds,
    seconds: rest,
    fadeIn: 0,
  });
  return [left, right];
}

/** A copy that starts where this slice ends. */
export function duplicateClip(clip: BedClip, secondsPerBeat: number, id: string): BedClip {
  return { ...clip, id, beat: clip.beat + clip.seconds / secondsPerBeat };
}

export function shapeClip(clip: BedClip, patch: Partial<Pick<BedClip, 'gain' | 'fadeIn' | 'fadeOut' | 'mute'>>): BedClip {
  return fitFades({
    ...clip,
    gain: patch.gain === undefined ? clip.gain : Math.min(1, Math.max(0, patch.gain)),
    fadeIn: patch.fadeIn === undefined ? clip.fadeIn : Math.max(0, patch.fadeIn),
    fadeOut: patch.fadeOut === undefined ? clip.fadeOut : Math.max(0, patch.fadeOut),
    mute: patch.mute === undefined ? clip.mute : patch.mute,
  });
}

/** Min and max of each bucket, interleaved, for drawing the file. */
export function waveformPeaks(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(Math.max(0, buckets) * 2);
  if (!samples.length || buckets <= 0) return out;
  const size = samples.length / buckets;
  for (let i = 0; i < buckets; i++) {
    let min = 1;
    let max = -1;
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((i + 1) * size)));
    for (let j = start; j < end; j++) {
      const v = samples[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[i * 2] = min;
    out[i * 2 + 1] = max;
  }
  return out;
}
