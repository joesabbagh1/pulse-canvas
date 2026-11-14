import { describe, expect, it } from 'vitest';
import { duplicateClip, moveClip, shapeClip, splitClip, trimClip, waveformPeaks, wholeClip } from './bed';

const slice = wholeClip(8, 'a');

describe('background cuts', () => {
  it('moves a slice on the beat grid, and not before the start', () => {
    expect(moveClip(slice, 3.2, true).beat).toBe(3.25);
    expect(moveClip(slice, 3.2, false).beat).toBeCloseTo(3.2);
    expect(moveClip(slice, -2, true).beat).toBe(0);
  });

  it('trims the start without sliding the audio under a beat, and the end against the file', () => {
    const spb = 0.5;
    const trimmed = trimClip(slice, 'start', 2, spb, 8, true);
    expect(trimmed.beat).toBe(2);
    expect(trimmed.offset).toBe(1);
    expect(trimmed.seconds).toBe(7);
    const extended = trimClip(trimmed, 'start', -4, spb, 8, false);
    expect(extended.offset).toBe(0);
    expect(extended.seconds).toBe(8);
    expect(trimClip(slice, 'end', -4, spb, 8, true).seconds).toBe(6);
    expect(trimClip(slice, 'end', 10, spb, 8, false).seconds).toBe(8);
  });

  it('splits a slice in two and copies one to where it ends', () => {
    const parts = splitClip({ ...slice, fadeIn: 0.4, fadeOut: 0.4 }, 3, 0.5, 'b');
    expect(parts?.[0]).toMatchObject({ id: 'a', seconds: 3, offset: 0, fadeOut: 0, fadeIn: 0.4 });
    expect(parts?.[1]).toMatchObject({ id: 'b', beat: 6, offset: 3, seconds: 5, fadeIn: 0, fadeOut: 0.4 });
    expect(splitClip(slice, 0.01, 0.5, 'b')).toBeNull();
    expect(duplicateClip(slice, 0.5, 'b')).toMatchObject({ id: 'b', beat: 16, seconds: 8 });
  });

  it('keeps fades inside the slice and gain inside 0 to 1', () => {
    expect(shapeClip(slice, { gain: 4, fadeIn: 100, fadeOut: 100 })).toMatchObject({ gain: 1, fadeIn: 8, fadeOut: 0 });
    expect(shapeClip(slice, { mute: true }).mute).toBe(true);
  });

  it('draws a bucket for each stretch of the file', () => {
    const peaks = waveformPeaks(new Float32Array([0, 1, -1, 0.5]), 2);
    expect(peaks[0]).toBe(0);
    expect(peaks[1]).toBe(1);
    expect(peaks[2]).toBe(-1);
    expect(peaks[3]).toBe(0.5);
  });
});
