import { describe, expect, it } from 'vitest';
import { toPcm16, wavFile } from './recorder';

describe('WAV recording', () => {
  it('interleaves channels into 16-bit samples, clipping overs', () => {
    const left = new Float32Array([0, 0.5, -1, 2]);
    const right = new Float32Array([1, -0.5, 0, -3]);
    expect([...toPcm16([left, right])]).toEqual([0, 32767, 16383, -16384, -32768, 0, 32767, -32768]);
  });

  it('writes a standard PCM WAV header', async () => {
    const chunks = [new Int16Array([1, 2, 3, 4]), new Int16Array([5, 6])];
    const bytes = new DataView(await wavFile(chunks, 2, 48000).arrayBuffer());
    const ascii = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => bytes.getUint8(at + i)));
    expect([ascii(0), ascii(8), ascii(12), ascii(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(bytes.getUint32(4, true)).toBe(36 + 12);
    expect(bytes.getUint16(20, true)).toBe(1);
    expect(bytes.getUint16(22, true)).toBe(2);
    expect(bytes.getUint32(24, true)).toBe(48000);
    expect(bytes.getUint32(28, true)).toBe(48000 * 4);
    expect(bytes.getUint16(32, true)).toBe(4);
    expect(bytes.getUint16(34, true)).toBe(16);
    expect(bytes.getUint32(40, true)).toBe(12);
    expect(bytes.getInt16(44 + 10, true)).toBe(6);
  });
});
