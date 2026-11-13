import { describe, expect, it } from 'vitest';
import { parseKbm, parseScala } from './scala';
import { ROOT_HZ, SCALES, describePitch, keyOf, scaleById } from './tuning';

const lines = (...ls: string[]) => ls.join('\n');

describe('parseScala', () => {
  it('reads cents, skipping comments and text after each pitch', () => {
    const scale = parseScala(
      lines('! 12tet.scl', '!', '12 tone equal temperament', ' 12', '!', ...Array.from({ length: 11 }, (_, i) => ` ${(i + 1) * 100}.0 step`), ' 2/1'),
      '12tet',
    );
    expect(scale.name).toBe('12 tone equal temperament');
    expect(scale.cents).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100]);
    expect(scale.period).toBe(1200);
  });

  it('reads ratios, including whole numbers, and non-octave periods', () => {
    const scale = parseScala(lines('Just triad over a tritave', '3', '5/4', '3/2', '3'), 'x');
    expect(scale.cents[0]).toBe(0);
    expect(scale.cents[1]).toBeCloseTo(386.314, 3);
    expect(scale.cents[2]).toBeCloseTo(701.955, 3);
    expect(scale.period).toBeCloseTo(1901.955, 3);
  });

  it('falls back to the file name when the description is empty, and handles CRLF', () => {
    const scale = parseScala('!\r\n\r\n 2\r\n 700.\r\n 2\r\n', 'fifths');
    expect(scale.name).toBe('fifths');
    expect(scale.cents).toEqual([0, 700]);
  });

  it('gives the same id for the same scale, and a different one otherwise', () => {
    const a = parseScala(lines('A', '2', '700.0', '2/1'), 'a');
    expect(parseScala(lines('! again', 'A', '2', '700.0', '2/1'), 'a').id).toBe(a.id);
    expect(parseScala(lines('A', '2', '701.0', '2/1'), 'a').id).not.toBe(a.id);
  });

  it('says what is wrong with a broken file', () => {
    expect(() => parseScala('just some text', 'x')).toThrow('no pitch count');
    expect(() => parseScala(lines('Short', '3', '100.0', '2/1'), 'x')).toThrow('promises 3 pitches but lists 2');
    expect(() => parseScala(lines('Bad', '2', 'fifth', '2/1'), 'x')).toThrow('pitch 1, "fifth"');
    expect(() => parseScala(lines('Down', '1', '-100.0'), 'x')).toThrow('period');
  });
});

describe('parseKbm', () => {
  const tet12 = { id: 't', name: '12-TET', cents: Array.from({ length: 12 }, (_, i) => i * 100), period: 1200 };
  const header = (size: number, ref: number, hz: number, octave: number) =>
    ['! test.kbm', String(size), '0', '127', '60', String(ref), String(hz), String(octave)];

  it('pins degree 0 so the reference key sounds at the reference frequency', () => {
    expect(parseKbm(lines(...header(0, 69, 440, 12)), tet12)).toBeCloseTo(ROOT_HZ, 3);
    const root432 = parseKbm(lines(...header(0, 69, 432, 12)), tet12);
    expect(root432).toBeCloseTo(256.87, 2);
    expect(keyOf(root432)).toBeUndefined();
    expect(describePitch(0, tet12, root432)).toMatchObject({ name: 'C', octave: 4, offset: -32 });
  });

  it('follows the mapping to find the degree of the reference key', () => {
    // White keys onto a seven-note scale; A above middle C is degree 5.
    const kbm = lines(...header(12, 69, 440, 7), '0', 'x', '1', 'x', '2', '3', 'x', '4', 'x', '5', 'x', '6');
    expect(parseKbm(kbm, scaleById('major'))).toBeCloseTo(ROOT_HZ, 3);
  });

  it('says what is wrong with a broken file', () => {
    expect(() => parseKbm(lines('0', '0', '127'), SCALES[0])).toThrow('seven header lines');
    expect(() => parseKbm(lines(...header(12, 61, 440, 7), '0', 'x', '1', 'x', '2', '3', 'x', '4', 'x', '5', 'x', '6'), SCALES[0])).toThrow(
      "reference key, 61, isn't mapped",
    );
    expect(() => parseKbm(lines(...header(3, 69, 440, 7), '0', '1'), SCALES[0])).toThrow('promises 3 mapping entries');
  });
});

