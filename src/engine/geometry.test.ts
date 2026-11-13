import { describe, expect, it } from 'vitest';
import { linkPath, nearestSegment, pointAt, slicePath } from './geometry';

// An L: right 100, then down 50.
const path = linkPath({ x: 0, y: 0 }, { x: 100, y: 50 }, [{ x: 100, y: 0 }], 0);

describe('link paths', () => {
  it('measure the whole polyline', () => {
    expect(path.len).toBe(150);
    expect(path.at).toEqual([0, 100, 150]);
  });

  it('find points and directions along each segment', () => {
    expect(pointAt(path, 40)).toEqual({ x: 40, y: 0, ux: 1, uy: 0 });
    expect(pointAt(path, 120)).toEqual({ x: 100, y: 20, ux: 0, uy: 1 });
  });

  it('slice through corners', () => {
    expect(slicePath(path, 80, 130)).toEqual([
      { x: 80, y: 0, ux: 1, uy: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30, ux: 0, uy: 1 },
    ]);
  });

  it('pick the segment nearest a point', () => {
    expect(nearestSegment(path, { x: 50, y: 10 })).toBe(0);
    expect(nearestSegment(path, { x: 110, y: 35 })).toBe(1);
  });

  it('offset straight links sideways but leave bent ones alone', () => {
    const straight = linkPath({ x: 0, y: 0 }, { x: 100, y: 0 }, [], 7);
    expect(straight.points).toEqual([
      { x: 0, y: 7 },
      { x: 100, y: 7 },
    ]);
    expect(straight.len).toBe(100);
    expect(linkPath({ x: 0, y: 0 }, { x: 100, y: 50 }, [{ x: 100, y: 0 }], 7).points[0]).toEqual({ x: 0, y: 0 });
  });
});
