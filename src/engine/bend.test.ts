import { describe, expect, it } from 'vitest';
import { beginBend, bendText } from './bend';
import { compileExpr } from './fexpr';

const at = (src: string, x: number) => {
  const got = compileExpr(src);
  if (got.fn === null) throw new Error(`compile failed: ${got.error} for "${src}"`);
  return got.fn(x);
};

describe('bending', () => {
  it('adds one gaussian term to the expression, centred where you press', () => {
    const bend = beginBend('sin(x)', 8, 16)!;
    expect(bend.center).toBe(8);
    expect(bend.width).toBe(1); // a sixteenth of the window
    expect(bendText(bend, -0.03956)).toBe('sin(x)-1.03exp(-((x-8)/1)^2)');
  });

  it('pulls the curve through the pointer at the press and leaves the rest alone', () => {
    const bend = beginBend('sin(x)', 8, 16)!;
    const bent = bendText(bend, -0.03956)!;
    const f = compileExpr(bent).fn!;
    // At the press the curve passes through where the pointer dragged it.
    expect(f(8)).toBeCloseTo(-0.03956, 2);
    // Away from the press the old function stands: half a window off, the
    // gaussian has faded below the amplitude's rounding.
    expect(f(0)).toBeCloseTo(Math.sin(0), 6);
    expect(f(16)).toBeCloseTo(Math.sin(16), 6);
  });

  it('reads a press on a slope as a displacement, not a target', () => {
    const bend = beginBend('x/2', 4, 16)!;
    const bent = bendText(bend, 1)!;
    // under(4) is 2; holding the curve at 1 there means pulling it down 1.
    expect(bent).toBe('x/2-exp(-((x-4)/1)^2)');
    expect(at(bent, 4)).toBeCloseTo(1, 9);
    // Four widths away the gaussian has faded to ~1e-7: the base stands.
    expect(at(bent, 0)).toBeCloseTo(0, 5);
  });

  it('folds a second bend over the first instead of piling terms', () => {
    const first = beginBend('sin(x)', 8, 16)!;
    const once = bendText(first, -1)!;
    // Dragging again over the same place absorbs that bend term.
    const second = beginBend(once, 8, 16)!;
    expect(second.kept).toHaveLength(0);
    expect(second.baseText).toBe('sin(x)');
    const twice = bendText(second, 0.5)!;
    expect(twice).toBe('sin(x)-.49exp(-((x-8)/1)^2)');
    expect(at(twice, 8)).toBeCloseTo(0.5, 2);
    // A nearby-but-not-absorbed bend is kept as its own term.
    const third = beginBend(twice, 9, 16)!;
    expect(third.kept).toHaveLength(1);
    const again = bendText(third, 0.5)!;
    expect(again).toContain('sin(x)-.49exp(-((x-8)/1)^2)');
    expect(again.endsWith('+.27exp(-((x-9)/1)^2)')).toBe(true);
    expect(at(again, 9)).toBeCloseTo(0.5, 2);
  });

  it('starts the new bend from the curve under it, previous bends included', () => {
    const first = beginBend('sin(x)', 6, 16)!;
    const once = bendText(first, 1)!;
    const second = beginBend(once, 10, 16)!;
    // At the new press the curve is sin(x) plus the first bend's tail there.
    const expected = at(once, 10);
    const bent = bendText(second, expected + 0.5)!;
    expect(at(bent, 10)).toBeCloseTo(expected + 0.5, 2);
    // And the first bend still stands at its own centre.
    expect(at(bent, 6)).toBeCloseTo(1, 2);
  });

  it('keeps earlier bends on either side, and bends read back the same', () => {
    const first = beginBend('x', 4, 16)!;
    const once = bendText(first, 2)!;
    expect(once).toBe('x-2exp(-((x-4)/1)^2)');
    const second = beginBend(once, 12, 16)!;
    const twice = bendText(second, 1)!;
    expect(twice).toBe('x-2exp(-((x-4)/1)^2)-11exp(-((x-12)/1)^2)');
    expect(at(twice, 4)).toBeCloseTo(2, 9);
    expect(at(twice, 12)).toBeCloseTo(1, 9);
    // Far from either press, the base function stands.
    expect(at(twice, 0)).toBeCloseTo(0, 6);
  });

  it('absorbs a bend written with a multiplier', () => {
    const bend = beginBend('2exp(-((x-3)/1)^2)+sin(x)', 3, 16)!;
    expect(bend.kept).toHaveLength(0);
    expect(bend.baseText).toBe('sin(x)');
    // under(3) is sin(3); holding the curve at 5 there lifts it by 4.86.
    expect(bendText(bend, 5)).toBe('sin(x)+4.86exp(-((x-3)/1)^2)');
  });

  it('absorbs bends written with pow(x-3, 2) and a negative centre', () => {
    expect(beginBend('exp(-pow(x-3, 2))', 3, 16)!.kept).toHaveLength(0);
    const bend = beginBend('-.5exp(-((x+3)/1)^2)', -3, 16)!;
    expect(bend.kept).toHaveLength(0);
    // A curve of bends alone has nothing before them; pressing one leaves
    // only the base (zero) under the drag.
    expect(bend.baseText).toBe('');
    expect(bend.under(-3)).toBe(0);
  });

  it('understands x alone as a bend at zero', () => {
    expect(beginBend('exp(-(x/1)^2)', 0, 16)!.kept).toHaveLength(0);
  });

  it('keeps a term whose bend shape is a coincidence, not a bend', () => {
    const bend = beginBend('sin(exp(-((x-1)/1)^2))', 5, 16)!;
    expect(bend.kept).toHaveLength(0);
    expect(bend.baseText).toBe('sin(exp(-((x-1)/1)^2))');
    expect(bendText(bend, 0.4)).toContain('sin(exp(-((x-1)/1)^2))+');
  });

  it('keeps curve() terms as they are and bends beside them', () => {
    const bend = beginBend('curve(x,0,16,0,1,0)', 8, 16)!;
    expect(bend.kept).toHaveLength(0);
    expect(bend.baseText).toBe('curve(x,0,16,0,1,0)');
    const bent = bendText(bend, 0.3)!;
    expect(at(bent, 0)).toBeCloseTo(0, 9);
    expect(at(bent, 8)).toBeCloseTo(0.3, 9);
  });

  it('gives bends on a narrow window a narrower width', () => {
    expect(beginBend('sin(x)', 4, 8)!.width).toBe(0.5);
  });

  it('bends a curve with a negative centre using (x+3)', () => {
    const bend = beginBend('sin(x)', -3, 16)!;
    const bent = bendText(bend, 0.5)!;
    expect(bent).toBe('sin(x)+.64exp(-((x+3)/1)^2)');
    expect(at(bent, -3)).toBeCloseTo(0.5, 2);
  });

  it('says no to bending an expression that does not read', () => {
    expect(beginBend('oops(x)', 8, 16)).toBeNull();
    expect(beginBend('', 8, 16)).toBeNull();
  });

  it('fits a base just under the cap, and refuses one past it', () => {
    const fill = (n: number) => Array.from({ length: n }, () => 'sin(2x)/2').join('+');
    // 17 terms: 169 characters — a bend still fits afterwards.
    const tight = beginBend(fill(17), 8, 16)!;
    expect(tight.baseText.length).toBe(169);
    expect(bendText(tight, 0.3)).not.toBeNull();
    // 21 terms: 209 characters — even a bare bend wouldn't fit.
    expect(beginBend(fill(21), 8, 16)).toBeNull();
  });

  it('drops earlier bends smallest-first when text runs out', () => {
    const first = beginBend('x', 2, 16)!;
    const once = bendText(first, 4)!;
    const second = beginBend(once, 10, 16)!;
    const twice = bendText(second, 13)!;
    expect(twice).toBe('x+2exp(-((x-2)/1)^2)+3exp(-((x-10)/1)^2)');
    // A base too big to hold both bends lets the smaller one go.
    const base = Array.from({ length: 15 }, () => 'sin(2x)/2').join('+');
    const tight = beginBend(`${base}+2exp(-((x-2)/1)^2)+3exp(-((x-10)/1)^2)`, 14, 16)!;
    expect(tight.kept.map((k) => k.center)).toEqual([10]);
    const bent = bendText(tight, 1)!;
    expect(bent).toContain('+3exp(-((x-10)/1)^2)');
    expect(bent).not.toContain('+2exp(-((x-2)/1)^2)');
    expect(bent.length).toBeLessThanOrEqual(200);
  });

  it('always reads back what it writes, whatever the press', () => {
    for (const center of [0, 0.13, -7.5, 15.99]) {
      const bend = beginBend('sin(x)+x/8', center, 16)!;
      const bent = bendText(bend, 0.42)!;
      expect(bent).not.toBeNull();
      expect(compileExpr(bent).error).toBeNull();
      // The bend passes through the pointer at the press, on any base.
      expect(at(bent, center)).toBeCloseTo(0.42, 2);
    }
  });
});
