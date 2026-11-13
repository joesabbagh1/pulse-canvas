import { describe, expect, it } from 'vitest';
import { degreeGrid } from './figures';

describe('degreeGrid', () => {
  it('keeps an empty row between pitches that are not neighbours', () => {
    expect(degreeGrid([0, 2])).toEqual({ lo: 0, hi: 2, rows: 3 });
  });

  it('uses one row when every note is the same pitch', () => {
    expect(degreeGrid([0, 0, 0])).toEqual({ lo: 0, hi: 0, rows: 1 });
    expect(degreeGrid([])).toEqual({ lo: 0, hi: 0, rows: 1 });
  });
});
