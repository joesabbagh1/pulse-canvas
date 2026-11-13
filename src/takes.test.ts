import { describe, expect, it } from 'vitest';
import { PX_PER_BEAT } from './engine/geometry';
import { scaleById, type Scale } from './engine/tuning';
import {
  MAX_TAKE_NOTES,
  TAKE_ORIGIN_X,
  TAKE_ORIGIN_Y,
  TAKE_STAGGER_Y,
  clipTake,
  defaultTakeName,
  keyDegree,
  layoutTake,
  snapBeat,
  type TakeNote,
} from './takes';

const note = (beat: number, beats: number, extra: Partial<TakeNote> = {}): TakeNote => ({
  beat,
  beats,
  degree: 0,
  velocity: 1,
  ...extra,
});

const chromatic: Scale = {
  id: 'chromatic-12',
  name: '12-TET',
  cents: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
  period: 1200,
};

describe('snap and the take cap', () => {
  it('rounds starts and lengths to a quarter beat, or a sixteenth when snap is off', () => {
    expect(snapBeat(0.2, true)).toBe(0.25);
    expect(snapBeat(0.1, true)).toBe(0);
    expect(snapBeat(1.13, false)).toBe(1.125);

    expect(clipTake([note(0.2, 0.7, { degree: 3 })], true)).toEqual([{ beat: 0.25, beats: 0.75, degree: 3, velocity: 1 }]);
    expect(clipTake([note(0.2, 0.7, { degree: 3 })], false)).toEqual([{ beat: 0.1875, beats: 0.6875, degree: 3, velocity: 1 }]);
    // A tap shorter than the grid still leaves a note.
    expect(clipTake([note(0, 0.01)], true)[0].beats).toBe(0.25);
    expect(clipTake([note(0, 0.01)], false)[0].beats).toBe(1 / 16);
  });

  it('keeps the first 64 notes and drops anything that starts at 32 beats', () => {
    const many = Array.from({ length: 80 }, (_, i) => note(i * 0.25, 0.25, { degree: i }));
    const clipped = clipTake(many, true);
    expect(clipped).toHaveLength(MAX_TAKE_NOTES);
    expect(clipped[0].degree).toBe(0);
    expect(clipped[63].degree).toBe(63);

    expect(clipTake([note(32, 1, { degree: 4 })], true)).toEqual([]);
    expect(clipTake([note(31.9, 1, { degree: 4 })], true)).toEqual([]);
    // 30 stays on the grid; the hold is cut so it ends at 32, and velocity stays in 0..1.
    expect(clipTake([note(30.1, 5, { degree: 2, velocity: 2 })], true)).toEqual([{ beat: 30, beats: 2, degree: 2, velocity: 1 }]);
  });
});

describe('keyboard degrees', () => {
  const major = scaleById('major');
  const penta = scaleById('major-penta');

  it('is the semitone on a 12-note equal scale, and one period up on any other', () => {
    expect(keyDegree(0, chromatic)).toBe(0);
    expect(keyDegree(1, chromatic)).toBe(1);
    expect(keyDegree(12, chromatic)).toBe(12);
    expect(keyDegree(24, chromatic)).toBe(24);

    // Major has 7 notes, pentatonic 5. An octave is that many degrees, not 12.
    expect(keyDegree(0, major)).toBe(0);
    expect(keyDegree(2, major)).toBe(1);
    expect(keyDegree(12, major)).toBe(7);
    expect(keyDegree(24, major)).toBe(14);
    expect(keyDegree(12, penta)).toBe(5);
    expect(keyDegree(24, penta)).toBe(10);
    // A black key the scale cannot spell still resolves to a degree, so it sounds.
    expect(keyDegree(1, penta)).toBe(0);
  });
});

describe('placing a take', () => {
  const notes = [note(0, 1, { degree: 0 }), note(1.5, 0.5, { degree: 2 })];

  it('names a take from the instrument and how many it already has', () => {
    expect(defaultTakeName('Tone', [], 'tone')).toBe('Tone 1');
    expect(defaultTakeName('Tone', [{ instrument: 'tone' }, { instrument: 'bass' }], 'tone')).toBe('Tone 2');
  });

  it('sets each note at origin + beat × pixels, in time order, and staggers a taken origin', () => {
    const laid = layoutTake([notes[1], notes[0]], []);
    expect(laid.notes.map((n) => n.beat)).toEqual([0, 1.5]);
    expect(laid.positions).toEqual([
      { x: TAKE_ORIGIN_X, y: TAKE_ORIGIN_Y },
      { x: TAKE_ORIGIN_X + 1.5 * PX_PER_BEAT, y: TAKE_ORIGIN_Y },
    ]);
    expect(PX_PER_BEAT).toBe(240);

    const staggered = layoutTake(notes, [{ x: TAKE_ORIGIN_X, y: TAKE_ORIGIN_Y }]);
    expect(staggered.positions[0]).toEqual({ x: TAKE_ORIGIN_X, y: TAKE_ORIGIN_Y + TAKE_STAGGER_Y });
    expect(staggered.positions[1].y).toBe(TAKE_ORIGIN_Y + TAKE_STAGGER_Y);

    expect(layoutTake(notes, [{ x: 400, y: 400 }]).positions[0]).toEqual({ x: TAKE_ORIGIN_X, y: TAKE_ORIGIN_Y });
  });
});
