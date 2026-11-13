import { describe, expect, it } from 'vitest';
import { fitLength, linkPath, parseLength } from './engine/geometry';
import { findLoops } from './loops';
import { parseRoute, routeHref } from './ui/route';

describe('fitLength', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 240, y: 0 };
  const len = (bends: { x: number; y: number }[]) => linkPath(a, b, bends, 0).len;

  it('bows a straight link out to an exact length', () => {
    const bends = fitLength(a, b, [], 360)!;
    expect(bends).toHaveLength(1);
    expect(len(bends)).toBeCloseTo(360, 6);
  });

  it('keeps the shape of existing bends, scaling them out or in', () => {
    const shape = [{ x: 60, y: 40 }, { x: 180, y: -40 }];
    const longer = fitLength(a, b, shape, 600)!;
    const shorter = fitLength(a, b, shape, 260)!;
    expect(len(longer)).toBeCloseTo(600, 6);
    expect(len(shorter)).toBeCloseTo(260, 6);
    // Same points along the line, same sides: only the sideways distance changed.
    expect(longer.map((p) => p.x)).toEqual([60, 180]);
    expect(Math.sign(longer[0].y)).toBe(1);
    expect(Math.sign(longer[1].y)).toBe(-1);
  });

  it('straightens at the straight length, and refuses anything shorter', () => {
    expect(fitLength(a, b, [{ x: 120, y: 50 }], 240)).toEqual([]);
    expect(fitLength(a, b, [], 200)).toBeNull();
  });
});

describe('parseLength', () => {
  it('reads the ways people write beats', () => {
    expect(['1¾', '1 3/4', '7/4', '1.75', '¾', '2'].map(parseLength)).toEqual([1.75, 1.75, 1.75, 1.75, 0.75, 2]);
    expect(['', 'soon', '1/0', '-1'].map(parseLength).every(Number.isNaN)).toBe(true);
  });
});

describe('findLoops', () => {
  const at = (ids: string[]) => new Map(ids.map((id, i) => [id, { x: i * 100, y: 0 }]));
  const link = (source: string, target: string, beats = 1) => ({ source, target, beats });

  it('finds each loop once, with its total length and middle', () => {
    const loops = findLoops(at(['a', 'b', 'c', 'd']), [link('a', 'b'), link('b', 'c', 0.5), link('c', 'a', 2), link('c', 'd')]);
    expect(loops).toEqual([{ blocks: ['a', 'b', 'c'], beats: 3.5, at: { x: 100, y: 0 } }]);
  });

  it('tells a loop from its reverse, and ignores chains that never close', () => {
    const loops = findLoops(at(['a', 'b']), [link('a', 'b'), link('b', 'a', 2)]);
    expect(loops.map((l) => l.beats)).toEqual([3]);
    expect(findLoops(at(['a', 'b', 'c']), [link('a', 'b'), link('b', 'c')])).toEqual([]);
  });

  it('stops at a cap in a dense web instead of grinding', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const links = ids.flatMap((s) => ids.filter((t) => t !== s).map((t) => link(s, t)));
    const started = performance.now();
    expect(findLoops(at(ids), links).length).toBeLessThanOrEqual(24);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('routes', () => {
  it('reads pages from the fragment, and anything else is the canvas', () => {
    expect(['#/examples', '#/guide', '#/instruments', '#/', '', '#/nowhere', '#piece=1.abc'].map(parseRoute)).toEqual([
      'examples',
      'guide',
      'instruments',
      'canvas',
      'canvas',
      'canvas',
      'canvas',
    ]);
    expect(routeHref('guide')).toBe('#/guide');
  });
});
