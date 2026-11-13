import { describe, expect, it } from 'vitest';
import { linkBeats, linkPath } from './engine/geometry';
import { EXAMPLES } from './examples';
import { backbeat, phraseLoop, waltz, type Note } from './melody';

function hopBeats(blocks: { id: string; x: number; y: number }[], link: { from: string; to: string; bends?: { x: number; y: number }[] }) {
  const at = new Map(blocks.map((b) => [b.id, b]));
  const a = at.get(link.from);
  const b = at.get(link.to);
  if (!a || !b) return NaN;
  return linkBeats(linkPath(a, b, link.bends ?? [], 0).len, true);
}

function expectPhrase(notes: Note[], kind: 'tone' | 'pluck' | 'bass' = 'tone') {
  const phrase = phraseLoop('p', 40, -20, notes, kind);
  const hops = phrase.links.map((link) => hopBeats(phrase.blocks, link));
  expect(hops).toEqual(notes.map((n) => n.beats));
  expect(phrase.blocks.every((b) => b.kind === kind)).toBe(true);
}

describe('phrase loops', () => {
  it('fold a phrase so each hop is that note, including the return', () => {
    expectPhrase([
      { degree: 0, beats: 0.75 },
      { degree: 2, beats: 0.75 },
      { degree: 4, beats: 0.75 },
      { degree: 3, beats: 0.75 },
      { degree: 1, beats: 0.75 },
    ]);
    expectPhrase([
      { degree: 0, beats: 0.25 },
      { degree: 4, beats: 1.5 },
      { degree: 3, beats: 0.25 },
      { degree: 2, beats: 0.5 },
      { degree: 7, beats: 2 },
      { degree: 1, beats: 0.75 },
      { degree: 5, beats: 2.5 },
    ], 'pluck');
    expectPhrase(
      Array.from({ length: 8 }, (_, i) => ({ degree: -7 + i, beats: 2 })),
      'bass',
    );
  });

  it('keeps the snare branch the same length as the hat line, and the waltz in three', () => {
    const kit = backbeat(0, 0);
    const hops = Object.fromEntries(kit.links.map((link) => [link.id, hopBeats(kit.blocks, link)]));
    expect(hops['kick>hat-1'] + hops['hat-1>hat-2'] + hops['hat-2>kick']).toBe(2);
    expect(hops['kick>snare'] + hops['snare>kick']).toBe(2);
    const three = waltz(10, 10);
    expect(three.links.map((link) => hopBeats(three.blocks, link)).reduce((s, b) => s + b, 0)).toBe(3);
  });

  it('gives every example finite positions and a loop you can walk', () => {
    for (const example of EXAMPLES) {
      const ids = new Set(example.piece.blocks.map((b) => b.id));
      expect(ids.size).toBe(example.piece.blocks.length);
      for (const block of example.piece.blocks) {
        expect(Number.isFinite(block.x) && Number.isFinite(block.y)).toBe(true);
      }
      for (const link of example.piece.links) {
        expect(ids.has(link.from) && ids.has(link.to) && link.from !== link.to).toBe(true);
        const beats = hopBeats(example.piece.blocks, link);
        expect(beats).toBeGreaterThan(0);
        expect(Number.isFinite(beats)).toBe(true);
      }
    }
  });
});
