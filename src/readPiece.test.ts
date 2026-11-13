import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './examples';
import { DEFAULT_FX, DEFAULT_MIX } from './engine/mixer';
import { ROOT_HZ } from './engine/tuning';
import { toEdges, toNodes, toPiece } from './piece';
import { readPiece } from './readPiece';

const base = { version: 1, bpm: 100, snap: true, scaleId: 'major', blocks: [], links: [] };
const tone = (id: string, extra = {}) => ({ id, x: 0, y: 0, kind: 'tone', degree: 0, every: 0, ...extra });

describe('readPiece', () => {
  it('passes every example through as the canvas would save it', () => {
    for (const { piece } of EXAMPLES) {
      const saved = toPiece(toNodes(piece), toEdges(piece), piece);
      expect(readPiece(JSON.parse(JSON.stringify(piece)))).toEqual(saved);
    }
  });

  it('rejects things that are not pieces', () => {
    for (const raw of [null, 'piece', [], {}, { ...base, version: 2 }, { ...base, blocks: 'x' }]) {
      expect(() => readPiece(raw)).toThrow("isn't a Pulse Canvas piece");
    }
  });

  it('fills in fields that older pieces lack', () => {
    const piece = readPiece({ ...base, regions: [{ id: 'r', x: 0, y: 0, w: 100, h: 100, name: 'R', scaleId: 'major' }] });
    expect(piece).toMatchObject({ rootHz: ROOT_HZ, scales: [] });
    expect(piece.regions[0]).toMatchObject({ rootHz: ROOT_HZ, mix: DEFAULT_MIX, fx: DEFAULT_FX });
  });

  it('cuts links that point nowhere, loop on one block, or repeat', () => {
    const piece = readPiece({
      ...base,
      blocks: [tone('a'), tone('b'), tone('a', { degree: 5 })],
      links: [
        { id: 'ab', from: 'a', to: 'b' },
        { id: 'ab-again', from: 'a', to: 'b' },
        { id: 'aa', from: 'a', to: 'a' },
        { id: 'ax', from: 'a', to: 'missing' },
        { id: 'ab', from: 'b', to: 'a' },
      ],
    });
    expect(piece.blocks.map((b) => [b.id, b.degree])).toEqual([
      ['a', 0],
      ['b', 0],
    ]);
    expect(piece.links.map((l) => l.id)).toEqual(['ab']);
  });

  it('clamps numbers, caps sizes, and drops what it does not know', () => {
    const piece = readPiece({
      ...base,
      bpm: 9999,
      rootHz: -5,
      evil: '<script>',
      blocks: [tone('a', { degree: 1e9, x: 'left', code: 'drop'.repeat(5000), onclick: 'x' }), { id: 'b', kind: 'laser' }],
      scales: [{ id: 's', name: 'S', cents: [0, 'up', NaN, 700], period: 1200 }, { id: 'flat', cents: [0], period: 0 }],
      regions: [
        {
          id: 'r',
          mix: { level: 100, pan: -9, mute: 'yes' },
          fx: { tone: 2, echo: -1 },
          sample: { id: '../../etc/passwd', name: 'x' },
        },
      ],
    });
    expect(piece.bpm).toBe(200);
    expect(piece.rootHz).toBe(20);
    expect('evil' in piece).toBe(false);
    expect(piece.blocks).toHaveLength(1);
    expect(piece.blocks[0]).toEqual({ id: 'a', x: 0, y: 0, kind: 'tone', degree: 200, every: 0, code: 'drop'.repeat(1000) });
    expect(piece.scales).toEqual([{ id: 's', name: 'S', cents: [0, 700], period: 1200 }]);
    expect(piece.regions[0]).toMatchObject({ mix: { level: 6, pan: -1, mute: false }, fx: { tone: 1, echo: 0 } });
    expect(piece.regions[0].sample).toBeUndefined();
    expect(readPiece({ ...base, blocks: Array.from({ length: 5000 }, (_, i) => tone(`b${i}`)) }).blocks).toHaveLength(2000);
  });
});
