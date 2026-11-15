import { describe, expect, it } from 'vitest';
import { additiveTerms, compileExpr } from './fexpr';

const at = (src: string, x = 0) => {
  const got = compileExpr(src);
  if (got.fn === null) throw new Error(`compile failed: ${got.error}`);
  return got.fn(x);
};

const error = (src: string) => {
  const got = compileExpr(src);
  expect(got.fn).toBeNull();
  return got.error;
};

describe('compileExpr', () => {
  it('reads numbers and arithmetic with the usual precedence', () => {
    expect(at('1 + 2')).toBe(3);
    expect(at('2 + 3 * 4')).toBe(14);
    expect(at('(2 + 3) * 4')).toBe(20);
    expect(at('7 - 2 - 1')).toBe(4);
    expect(at('10 / 4')).toBe(2.5);
    expect(at('7 % 4')).toBe(3);
    expect(at('.5 + 1')).toBe(1.5);
    expect(at('2e3')).toBe(2000);
    expect(at('2e-3')).toBe(0.002);
  });

  it('treats ^ as right-associative power', () => {
    expect(at('2 ^ 10')).toBe(1024);
    expect(at('2 ^ 3 ^ 2')).toBe(512);
    expect(at('-2 ^ 2', 0)).toBe(-4);
    expect(at('2 ^ -2')).toBe(0.25);
  });

  it('multiplies without a sign', () => {
    expect(at('2x', 3)).toBe(6);
    expect(at('2pi')).toBeCloseTo(2 * Math.PI, 12);
    expect(at('3sin(pi / 2)')).toBeCloseTo(3, 12);
    expect(at('x(x + 1)', 2)).toBe(6);
    expect(at('2x x', 3)).toBe(18);
  });

  it('knows the constants', () => {
    expect(at('pi')).toBeCloseTo(Math.PI, 12);
    expect(at('e')).toBeCloseTo(Math.E, 12);
    expect(at('tau')).toBeCloseTo(2 * Math.PI, 12);
  });

  it('evaluates the functions', () => {
    expect(at('floor(-1.5)')).toBe(-2);
    expect(at('ceil(1.2)')).toBe(2);
    expect(at('round(2.5)')).toBe(3);
    expect(at('abs(-3)')).toBe(3);
    expect(at('sqrt(16)')).toBe(4);
    expect(at('ln(e)')).toBeCloseTo(1, 12);
    expect(at('log(100)')).toBeCloseTo(2, 12);
    expect(at('log2(8)')).toBeCloseTo(3, 12);
    expect(at('sign(-2)')).toBe(-1);
    expect(at('min(3, 5)')).toBe(3);
    expect(at('max(3, 5)')).toBe(5);
    expect(at('pow(2, 8)')).toBe(256);
    // mod wraps negatives, unlike %.
    expect(at('mod(-3, 5)')).toBe(2);
    expect(at('asin(sin(0.5))')).toBeCloseTo(0.5, 12);
    expect(at('atan2(1, 1)')).toBeCloseTo(Math.PI / 4, 12);
  });

  it('follows x across nesting', () => {
    expect(at('sin(x)', Math.PI / 2)).toBeCloseTo(1, 12);
    expect(at('-sin(x)', Math.PI / 2)).toBeCloseTo(-1, 12);
    expect(at('sin(x) + sin(3x) / 3', 0)).toBe(0);
    expect(at('x^2 - 4', 3)).toBe(5);
  });

  it('lets non-finite results through, as rests', () => {
    expect(Number.isNaN(at('0 / 0'))).toBe(true);
    expect(Number.isNaN(at('ln(-1)'))).toBe(true);
    expect(Number.isNaN(at('sqrt(x - 4)', 0))).toBe(true);
  });

  it('spreads curve() knots smoothly over its window, flat past the ends', () => {
    const f = compileExpr('curve(x, 0, 3, 0, 3, 0)').fn!;
    expect(f(0)).toBe(0);
    expect(f(1.5)).toBe(3); // the middle knot, held exactly
    expect(f(0.75)).toBeCloseTo(1.5, 6); // halfway between knots, cosine mid
    expect(f(3)).toBe(0);
    // Quarter of the way between knots: (1 − cos(π/4))/2 of the rise.
    expect(f(0.375)).toBeCloseTo(3 * (1 - Math.cos(Math.PI * 0.25)) / 2, 6);
    // Past either end it holds the last knot.
    expect(f(-2)).toBe(0);
    expect(f(9)).toBe(0);
    // Knots compose with the rest of the language.
    expect(at('curve(x, 0, 2, 1, 1) + x', 1)).toBeCloseTo(2, 6);
  });

  it('checks the count curve() is given', () => {
    expect(error('curve(x, 0)')).toContain('curve takes 5 to 17');
    expect(error('curve(x, 0, 1, 2)')).toContain('curve takes 5 to 17');
    expect(error(`curve(x, 0, 1, ${Array.from({ length: 15 }, () => '1').join(',')})`)).toContain('curve takes 5 to 17');
    expect(compileExpr(`curve(x, 0, 1, ${Array.from({ length: 14 }, () => '1').join(',')})`).error).toBeNull();
  });

  it('refuses what it cannot read', () => {
    expect(error('')).toBeTruthy();
    expect(error('   ')).toBeTruthy();
    expect(error('foo(x)')).toContain("isn't known");
    expect(error('X')).toContain("isn't known");
    expect(error('sin')).toContain('write sin(x)');
    expect(error('sin(x')).toContain('close it');
    expect(error('(x + 1')).toContain('close it');
    expect(error('2 +')).toContain('ends early');
    expect(error('sin(x, 2)')).toContain('takes 1');
    expect(error('min(x)')).toContain('takes 2');
    expect(error('2 @ 3')).toContain("isn't something I can read");
    expect(error('x 2 3 +')).toBeTruthy();
    expect(error('x'.repeat(201))).toContain('capped');
  });

  it('stops runaway nesting before the stack does', () => {
    expect(error('('.repeat(40) + 'x' + ')'.repeat(40))).toContain('nested');
  });
});

describe('additiveTerms', () => {
  const texts = (src: string) => additiveTerms(src).map((t) => `${t.sign}${t.text}`);

  it('cuts the top-level terms where + and - bind loosest', () => {
    expect(texts('sin(x) + cos(x) - tan(x)')).toEqual(['+sin(x)', '+cos(x)', '-tan(x)']);
    expect(additiveTerms('x').map((t) => `${t.sign}${t.text}`)).toEqual(['+x']);
    expect(texts('')).toEqual(['+']);
    expect(texts('   x  ')).toEqual(['+x']);
  });

  it('keeps a minus that binds tight inside its term', () => {
    // The power's minus, a call's minus, and a unary lead all stay put.
    expect(texts('x^-2 + sin(-x) - 3')).toEqual(['+x^-2', '+sin(-x)', '-3']);
    expect(texts('-sin(x) - x')).toEqual(['+-sin(x)', '-x']);
    expect(texts('x-2')).toEqual(['+x', '-2']);
    expect(texts('x - -2')).toEqual(['+x', '--2']);
  });

  it('ignores signs inside brackets and after commas', () => {
    expect(texts('min(x-1, y+2) + curve(x,0,1,1,1)')).toEqual(['+min(x-1, y+2)', '+curve(x,0,1,1,1)']);
    expect(texts('(x+1)(x-1)')).toEqual(['+(x+1)(x-1)']);
    expect(texts('exp(x)-x')).toEqual(['+exp(x)', '-x']);
    // Nested brackets reset, and a term can pick up after them.
    expect(texts('sin((x+1)) - cos(x)')).toEqual(['+sin((x+1))', '-cos(x)']);
  });

  it('joins back to the same function', () => {
    for (const src of ['sin(x) + cos(x) - tan(x)', 'x-2', '(x+1)(x-1)', 'min(x-1, 2) - 3x', '-sin(x) - x']) {
      const terms = additiveTerms(src);
      const joined = terms.map((t, i) => (i === 0 ? t.text : `${t.sign}${t.text}`)).join('');
      expect(at(joined, 1.3)).toBeCloseTo(at(src, 1.3), 12);
    }
  });
});
