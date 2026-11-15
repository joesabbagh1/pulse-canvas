import { describe, expect, it } from 'vitest';
import { compileExpr } from './fexpr';

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
