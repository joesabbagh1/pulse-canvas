import { describe, expect, it } from 'vitest';
import { grooveNote, DEFAULT_GROOVE } from './engine/groove';
import { pieceCycle } from './cycle';

describe('pieceCycle', () => {
  it('finds when loops of different lengths line up again', () => {
    expect(pieceCycle([2, 3.75])).toEqual({ kind: 'repeats', beats: 30 });
    expect(pieceCycle([2, 2, 3.75, 4])).toEqual({ kind: 'repeats', beats: 60 });
    expect(pieceCycle([1 / 3, 0.25])).toEqual({ kind: 'repeats', beats: 1 });
  });

  it('says when there is nothing to repeat, when timing is free, and when it is too long to matter', () => {
    expect(pieceCycle([])).toEqual({ kind: 'none' });
    expect(pieceCycle([2, 3.7213])).toEqual({ kind: 'drifts' });
    expect(pieceCycle([97 / 48, 101 / 48, 103 / 48, 107 / 48])).toEqual({ kind: 'too-long' });
  });
});

describe('grooveNote', () => {
  const spb = 0.5;
  const swing = (amount: number, grid = 0.5) => ({ ...DEFAULT_GROOVE, swing: amount, swingGrid: grid });

  it('leaves notes alone with no groove', () => {
    expect(grooveNote(3.5, DEFAULT_GROOVE, spb)).toEqual({ seconds: 0, velocity: 1 });
  });

  it('delays only the off-beat of each pair, up to the triplet', () => {
    expect(grooveNote(4, swing(1), spb).seconds).toBe(0);
    expect(grooveNote(4.5, swing(1), spb).seconds).toBeCloseTo((0.5 / 3) * spb);
    expect(grooveNote(4.5, swing(0.5), spb).seconds).toBeCloseTo((0.25 / 3) * spb);
    expect(grooveNote(4.25, swing(1), spb).seconds).toBe(0);
    // Swinging 16ths moves the second and fourth sixteenth instead.
    expect(grooveNote(4.25, swing(1, 0.25), spb).seconds).toBeCloseTo((0.25 / 3) * spb);
    expect(grooveNote(4.5, swing(1, 0.25), spb).seconds).toBe(0);
  });

  it('humanizes within its bounds', () => {
    const groove = { ...DEFAULT_GROOVE, humanize: 1 };
    expect(grooveNote(0, groove, spb, () => 0)).toEqual({ seconds: -0.015, velocity: 1 });
    const late = grooveNote(0, groove, spb, () => 1);
    expect(late.seconds).toBeCloseTo(0.015);
    expect(late.velocity).toBeCloseTo(0.7);
  });
});
