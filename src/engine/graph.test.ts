import { describe, expect, it } from 'vitest';
import { clampGraph, compileCurves, degreeAt, graphNotes, xAt, DEFAULT_GRAPH, MAX_CURVES, type GraphSpec } from './graph';
import { compileExpr } from './fexpr';
import { DEFAULT_SCALE_ID, describePitch, scaleById } from './tuning';

const scale = scaleById(DEFAULT_SCALE_ID);

const spec = (patch: Partial<GraphSpec>): GraphSpec => ({ ...DEFAULT_GRAPH, ...patch });

describe('compileCurves', () => {
  it('compiles the curves that read and skips the ones that do not', () => {
    const curves = compileCurves(
      spec({
        curves: [
          { id: 'a', expr: 'sin(x)', kind: 'tone', level: 1, shift: 0 },
          { id: 'b', expr: 'sin(', kind: 'tone', level: 1, shift: 0 },
          { id: 'c', expr: 'cos(x)', kind: 'bass', level: 0.5, shift: 2 },
        ],
      }),
    );
    // Curve indices stay the spec's, so flashes can find their curve.
    expect(curves.map((c) => c.curve.id)).toEqual(['a', 'c']);
    expect(curves.map((c) => c.index)).toEqual([0, 2]);
  });
});

describe('xAt', () => {
  it('sweeps the window once per loop and wraps', () => {
    const s = spec({ x0: 2, x1: 10, loopBeats: 8 });
    expect(xAt(s, 0)).toBe(2);
    expect(xAt(s, 4)).toBe(6);
    expect(xAt(s, 8)).toBe(2);
    expect(xAt(s, 12)).toBe(6);
    // Beats before the start of the transport sweep from the top too.
    expect(xAt(s, -4)).toBe(6);
  });
});

describe('degreeAt', () => {
  it('lays the window height onto the scale, top highest', () => {
    const s = spec({ y0: -1, y1: 1, baseDegree: 0, spanDegrees: 8 });
    expect(degreeAt(s, DEFAULT_GRAPH.curves[0], 1)).toBe(8);
    expect(degreeAt(s, DEFAULT_GRAPH.curves[0], -1)).toBe(0);
    expect(degreeAt(s, DEFAULT_GRAPH.curves[0], 0)).toBe(4);
    // Round to the nearest step of the scale, whatever the tuning.
    expect(degreeAt(s, DEFAULT_GRAPH.curves[0], 0.13)).toBe(5);
  });

  it('shifts a curve and rests a non-number y', () => {
    const s = spec({ y0: -1, y1: 1, baseDegree: 0, spanDegrees: 8 });
    const curve = { ...DEFAULT_GRAPH.curves[0], shift: 7 };
    expect(degreeAt(s, curve, 0)).toBe(11);
    expect(degreeAt(s, curve, NaN)).toBeNull();
    expect(degreeAt(s, curve, Infinity)).toBeNull();
  });
});

describe('graphNotes', () => {
  it('sounds one note per step, on the grid, at the y the playhead finds', () => {
    const s = spec({ curves: [{ id: 'a', expr: 'sin(x)', kind: 'tone', level: 0.8, shift: 0 }] });
    const curves = compileCurves(s);
    // The window and the loop are both 16 wide, so beat b reads x = b.
    const notes = graphNotes(s, curves, 0, 1);
    expect(notes.map((n) => n.beat)).toEqual([0, 0.25, 0.5, 0.75]);
    // x=0: sin(0)=0, the middle of the window, which is degree 4 with the
    // default span — the A above the root.
    expect(notes[0].degree).toBe(4);
    expect(describePitch(notes[0].degree, scale).name).toBe('A');
    expect(notes[0].velocity).toBe(0.8);
    expect(notes[0].beats).toBe(0.25);
  });

  it('climbs with sin and comes back down', () => {
    const s = spec({ curves: [{ id: 'a', expr: 'sin(x)', kind: 'tone', level: 1, shift: 0 }] });
    const curves = compileCurves(s);
    // x runs 0.5 → 2, past the sin peak at pi/2: up, over, back down.
    const degrees = graphNotes(s, curves, 0.5, 2.25).map((n) => n.degree);
    expect(degrees).toEqual([7, 9, 10, 10, 11, 11, 10]);
  });

  it('treats the window as half-open, so windows tile without doubling', () => {
    const s = spec({ curves: [{ id: 'a', expr: '1', kind: 'tone', level: 1, shift: 0 }] });
    const curves = compileCurves(s);
    expect(graphNotes(s, curves, 0.25, 0.5).map((n) => n.beat)).toEqual([0.25]);
    expect(graphNotes(s, curves, 0.5, 0.75).map((n) => n.beat)).toEqual([0.5]);
  });

  it('wraps x at the loop, back to the left of the window', () => {
    const s = spec({ curves: [{ id: 'a', expr: 'sin(x)', kind: 'tone', level: 1, shift: 0 }] });
    const curves = compileCurves(s);
    const wrapped = graphNotes(s, curves, 16, 16.25);
    expect(wrapped[0].beat).toBe(16);
    expect(wrapped[0].degree).toBe(4);
  });

  it('rests where the curve has no value', () => {
    const s = spec({ curves: [{ id: 'a', expr: 'sqrt(x - 4)', kind: 'tone', level: 1, shift: 0 }] });
    const curves = compileCurves(s);
    // x < 4 is under the radical: silent. x = 4 onward sounds.
    expect(graphNotes(s, curves, 0, 4)).toEqual([]);
    expect(graphNotes(s, curves, 4, 4.25)).toHaveLength(1);
  });

  it('carries each curve on its own index, with its own length', () => {
    const s = spec({
      lengthBeats: 2,
      curves: [
        { id: 'a', expr: '0', kind: 'tone', level: 1, shift: 0 },
        { id: 'b', expr: '1', kind: 'bass', level: 0.5, shift: 0 },
      ],
    });
    const notes = graphNotes(s, compileCurves(s), 0, 0.25);
    expect(notes.map((n) => n.curve)).toEqual([0, 1]);
    expect(notes.every((n) => n.beats === 2)).toBe(true);
  });

  it('reads every compile error as silence rather than throwing', () => {
    const s = spec({ curves: [{ id: 'a', expr: 'oops(x)', kind: 'tone', level: 1, shift: 0 }] });
    expect(graphNotes(s, compileCurves(s), 0, 4)).toEqual([]);
  });
});

describe('clampGraph', () => {
  it('rebuilds a missing or broken graph from the defaults', () => {
    expect(clampGraph(null)).toEqual(clampGraph({}));
    expect(clampGraph({ curves: 'nope' }).curves).toEqual(DEFAULT_GRAPH.curves);
  });

  it('keeps good curves and retargets unknown instruments', () => {
    const got = clampGraph({
      curves: [
        { id: 'a', expr: 'sin(x)', kind: 'flute', level: 1.5, shift: 3 },
        { id: 'b', expr: 'no', kind: 'not-an-instrument', level: -1, shift: 99 },
        { id: 'c', expr: 'tan(x)', kind: 'bass', level: 0.5, shift: -1 },
      ],
    });
    expect(got.curves[0]).toEqual({ id: 'a', expr: 'sin(x)', kind: 'flute', level: 1, shift: 3 });
    expect(got.curves[1].kind).toBe('tone');
    expect(got.curves[1].level).toBe(0);
    expect(got.curves[1].shift).toBe(24);
    expect(got.curves[2].kind).toBe('bass');
  });

  it('caps the number of curves', () => {
    const many = Array.from({ length: MAX_CURVES + 3 }, (_, i) => ({ id: `c${i}`, expr: 'x', kind: 'tone', level: 1, shift: 0 }));
    expect(clampGraph({ curves: many }).curves).toHaveLength(MAX_CURVES);
  });

  it('clamps the timing and range numbers', () => {
    const got = clampGraph({ loopBeats: 1e9, stepBeats: 0.001, lengthBeats: 99, baseDegree: 500, spanDegrees: 0 });
    expect(got.loopBeats).toBe(128);
    expect(got.stepBeats).toBe(1 / 16);
    expect(got.lengthBeats).toBe(16);
    expect(got.baseDegree).toBe(48);
    expect(got.spanDegrees).toBe(1);
  });

  it('opens a window that closed to nothing', () => {
    expect(clampGraph({ x0: 5, x1: 5 }).x1).toBeGreaterThan(clampGraph({ x0: 5, x1: 5 }).x0);
    expect(clampGraph({ y0: 3, y1: 3 }).y1).toBeGreaterThan(clampGraph({ y0: 3, y1: 3 }).y0);
  });

  it('only turns run on when it is true', () => {
    expect(clampGraph({ run: true }).run).toBe(true);
    expect(clampGraph({ run: 1 }).run).toBe(false);
  });
});

describe('compileExpr integration', () => {
  it('survives a long chained expression', () => {
    const got = compileExpr('sin(x) + sin(3x)/3 + sin(5x)/5 + sin(7x)/7');
    expect(got.error).toBeNull();
    expect(got.fn!(Math.PI)).toBeCloseTo(0, 6);
  });
});
