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
    expect(readPiece({ ...base, blocks: [tone('j', { kind: 'jawharp' }), tone('k', { kind: 'khuur' })] }).blocks.map((b) => b.kind)).toEqual([
      'jawharp',
      'khuur',
    ]);
    expect(piece.blocks[0]).toEqual({ id: 'a', x: 0, y: 0, kind: 'tone', degree: 200, every: 0, code: 'drop'.repeat(1000) });
    expect(piece.scales).toEqual([{ id: 's', name: 'S', cents: [0, 700], period: 1200 }]);
    expect(piece.regions[0]).toMatchObject({ mix: { level: 6, pan: -1, mute: false }, fx: { tone: 1, echo: 0 } });
    expect(piece.regions[0].sample).toBeUndefined();
    expect(readPiece({ ...base, blocks: Array.from({ length: 5000 }, (_, i) => tone(`b${i}`)) }).blocks).toHaveLength(2000);
  });

  it('keeps a pattern and its length, and will not put one on a start block', () => {
    const piece = readPiece({
      ...base,
      blocks: [tone('a', { pattern: 'bd  sd', beats: 3 }), tone('s', { kind: 'start', pattern: 'bd', beats: 4 }), tone('b', { pattern: 'hh*9', beats: 100 })],
    });
    expect(piece.blocks.map((b) => [b.id, b.pattern, b.beats])).toEqual([
      ['a', 'bd sd', 3],
      ['s', undefined, undefined],
      ['b', 'hh*9', 32],
    ]);
  });

  it('keeps one-letter performance keys and a clamped groove, and drops the rest', () => {
    const piece = readPiece({
      ...base,
      blocks: [tone('a', { kind: 'start', key: 'k' }), tone('b', { key: ' ' }), tone('c', { key: 'Enter' })],
      regions: [{ id: 'r', key: '7', groove: { swing: 3, swingGrid: 0.25, humanize: -1 } }, { id: 's', groove: { swingGrid: 0.3 } }],
    });
    expect(piece.blocks.map((b) => b.key)).toEqual(['k', undefined, undefined]);
    expect(piece.regions[0]).toMatchObject({ key: '7', groove: { swing: 1, swingGrid: 0.25, humanize: 0 } });
    expect(piece.regions[1].groove).toEqual({ swing: 0, swingGrid: 0.5, humanize: 0 });
  });

  it('keeps drawn waves and drops ones that are not drawings', () => {
    const piece = readPiece({
      ...base,
      waves: [
        { id: 'saw', role: 'cycle', points: [{ x: 0, y: -10 }, { x: 240, y: 10 }] },
        { id: 'bad', role: 'laser', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        { id: 'short', role: 'motion', points: [{ x: 0, y: 0 }] },
        { id: 'saw', role: 'motion', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      ],
    });
    expect(piece.waves).toEqual([{ id: 'saw', role: 'cycle', points: [{ x: 0, y: -10 }, { x: 240, y: 10 }] }]);
    const aimed = readPiece({
      ...base,
      waves: [
        { id: 'bow', role: 'cycle', instrument: 'bass', points: [{ x: 0, y: 0 }, { x: 80, y: 10 }] },
        { id: 'nope', role: 'cycle', instrument: 'laser', points: [{ x: 0, y: 0 }, { x: 80, y: 10 }] },
      ],
    });
    const drawn = aimed.waves ?? [];
    expect(drawn[0]).toMatchObject({ id: 'bow', instrument: 'bass' });
    expect(drawn[1]).not.toHaveProperty('instrument');
    expect(readPiece(base).waves).toEqual([]);
  });

  it('keeps a recorded take and drops one that is not', () => {
    const notes = Array.from({ length: 70 }, (_, i) => ({ beat: i * 0.01, degree: 0, beats: 0.25, velocity: 1 }));
    const piece = readPiece({
      ...base,
      takes: [
        {
          id: 't1',
          name: 'Tone 1',
          instrument: 'tone',
          notes: [
            { beat: 0, degree: 4, beats: 1, velocity: 0.5 },
            { beat: 'late', degree: 1, beats: 1, velocity: 1 },
            { beat: 1, degree: 999, beats: 0.25, velocity: 4 },
          ],
        },
        { id: 'nope', name: 'Laser', instrument: 'laser', notes: [{ beat: 0, degree: 0, beats: 1, velocity: 1 }] },
        { name: 'missing id', instrument: 'bass', notes: [{ beat: 0, degree: 0, beats: 1, velocity: 1 }] },
        { id: 't1', name: 'Duplicate', instrument: 'pluck', notes: [{ beat: 0, degree: 0, beats: 1, velocity: 1 }] },
        { id: 'snare', instrument: 'snare', notes },
      ],
    });
    expect(piece.takes?.[0]).toEqual({
      id: 't1',
      name: 'Tone 1',
      instrument: 'tone',
      notes: [
        { beat: 0, degree: 4, beats: 1, velocity: 0.5 },
        { beat: 1, degree: 200, beats: 0.25, velocity: 1 },
      ],
    });
    expect(piece.takes?.map((take) => take.id)).toEqual(['t1', 'snare']);
    expect(piece.takes?.[1].notes).toHaveLength(64);
    expect(piece.takes?.[1].name).toBe('Snare');
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, instrument: 'hat', notes: [] }));
    expect(readPiece({ ...base, takes: many }).takes).toHaveLength(32);
    expect(readPiece(base).takes).toEqual([]);
  });
});

