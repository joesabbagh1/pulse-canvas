import { PX_PER_BEAT, fitLength, type XY } from './engine/geometry';
import { MAX_GRAPH_NOTES, degreeAt, xAt, type CurveFn, type GraphSpec } from './engine/graph';
import type { BlockKind } from './engine/scheduler';

// Builders for the examples. A repeating phrase is still a loop — the pulse
// has to come back — but it walks a rectangle instead of a ring, with each
// hop as long as the note. A note that turns a corner is shorter as the crow
// flies, so that link bows out until it is the right length. The drums are a
// line plus a snare that leaves the kick and comes home on the same beat.

export interface Note {
  degree: number;
  /** How long until the next note, which is also how long this one sounds. */
  beats: number;
  /** Pickup and off-beat notes played softer. */
  soft?: boolean;
  /** Extra script lines for this note's block, e.g. "every 2: velocity 70%". */
  extra?: string;
}

/** 0.25 → "1/4", 1.5 → "3/2": beats as the script language writes them. */
export function beats2(b: number) {
  const Q = [
    [0.25, '1/4'], [0.5, '1/2'], [0.75, '3/4'], [1, '1'], [1.25, '5/4'],
    [1.5, '3/2'], [1.75, '7/4'], [2, '2'], [2.5, '5/2'], [3, '3'],
  ] as const;
  return Q.find(([v]) => Math.abs(v - b) < 1e-9)?.[1] ?? String(b);
}

export type PhraseKind = 'tone' | 'pluck' | 'bass';

const roundPt = (p: XY): XY => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

/**
 * Notes around a rectangle. The top is about eight beats wide when the phrase
 * is long enough to fold; shorter phrases stay nearly square. Each step is
 * that note's length, so the loop's duration is the sum of the notes.
 */
export function phraseLoop(id: string, x: number, y: number, notes: Note[], kind: BlockKind = 'tone') {
  const spots = placeOnRect(x, y, notes.map((n) => n.beats));
  const blocks = notes.map((n, i) => {
    const code = [`length ${beats2(n.beats)}`, n.soft ? 'velocity 65%' : '', n.extra ?? ''].filter(Boolean).join('\n');
    return {
      id: `${id}-${i + 1}`,
      x: spots[i].x,
      y: spots[i].y,
      kind,
      degree: n.degree,
      every: 0,
      code,
    };
  });
  const links = blocks.map((b, i) => {
    const next = blocks[(i + 1) % blocks.length];
    return rhythmLink(b.id, next.id, spots[i], spots[(i + 1) % spots.length], notes[i].beats);
  });
  return { blocks, links, first: `${id}-1` };
}

function placeOnRect(x0: number, y0: number, beats: number[]): XY[] {
  const total = beats.reduce((sum, b) => sum + b, 0);
  // Leave at least a quarter beat of height so the phrase folds back.
  let width = Math.min(8, Math.max(0.5, total / 2 - 0.5));
  width = Math.round(width * 4) / 4;
  width = Math.min(width, total / 2 - 0.25);
  const height = total / 2 - width;
  const sides = [width, height, width, height].map((beats) => beats * PX_PER_BEAT);
  const dirs = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];
  let side = 0;
  let used = 0;
  const pos = { x: x0, y: y0 };
  const out: XY[] = [];
  for (const beat of beats) {
    out.push(roundPt(pos));
    let left = beat * PX_PER_BEAT;
    let guard = 0;
    while (left > 1e-4 && guard++ < 8) {
      const room = sides[side] - used;
      const take = Math.min(Math.max(room, 0), left);
      if (take > 1e-6) {
        pos.x += dirs[side].x * take;
        pos.y += dirs[side].y * take;
        used += take;
        left -= take;
      }
      if (room - take < 1e-4) {
        side = (side + 1) % 4;
        used = 0;
      }
    }
  }
  return out;
}

/** A link of `beats`, bowed out when the blocks sit closer than that. */
function rhythmLink(fromId: string, toId: string, a: XY, b: XY, beats: number) {
  const target = beats * PX_PER_BEAT;
  const straight = Math.hypot(b.x - a.x, b.y - a.y);
  const bends = target > straight + 0.5 ? (fitLength(a, b, [], target) ?? []).map(roundPt) : [];
  return { id: `${fromId}>${toId}`, from: fromId, to: toId, ...(bends.length ? { bends } : {}) };
}

/**
 * A 2-beat bar as a line of kick and two hats, plus a snare that branches off
 * the kick and rejoins it two beats later — the same moment the hats return,
 * so the two paths stay one groove.
 */
export function backbeat(x: number, y: number, hatCode = '') {
  const beat = PX_PER_BEAT;
  const blocks = [
    { id: 'kick', x, y, kind: 'kick' as const, degree: 0, every: 0 },
    { id: 'hat-1', x: x + beat / 2, y, kind: 'hat' as const, degree: 0, every: 0, ...(hatCode ? { code: hatCode } : {}) },
    { id: 'hat-2', x: x + beat, y, kind: 'hat' as const, degree: 0, every: 0 },
    { id: 'snare', x, y: y + beat, kind: 'snare' as const, degree: 0, every: 0 },
  ];
  return {
    blocks,
    links: [
      { id: 'kick>hat-1', from: 'kick', to: 'hat-1' },
      { id: 'hat-1>hat-2', from: 'hat-1', to: 'hat-2' },
      { id: 'hat-2>kick', from: 'hat-2', to: 'kick' },
      { id: 'kick>snare', from: 'kick', to: 'snare' },
      { id: 'snare>kick', from: 'snare', to: 'kick' },
    ],
  };
}

/** Waltz drums: kick, hat, snare, a beat apart, folded into an L and bowed out to the beat. */
export function waltz(x: number, y: number) {
  const d = PX_PER_BEAT * 0.75;
  const kick = { x, y };
  const hat = { x: x + d, y };
  const snare = { x, y: y + d };
  const blocks = [
    { id: 'kick', ...kick, kind: 'kick' as const, degree: 0, every: 0 },
    { id: 'hat-1', ...hat, kind: 'hat' as const, degree: 0, every: 0 },
    { id: 'snare', ...snare, kind: 'snare' as const, degree: 0, every: 0 },
  ];
  return {
    blocks,
    links: [
      rhythmLink('kick', 'hat-1', kick, hat, 1),
      rhythmLink('hat-1', 'snare', hat, snare, 1),
      rhythmLink('snare', 'kick', snare, kick, 1),
    ],
  };
}

// A two-note alternating bass, on the bass voice: two blocks `beats` apart, looped.
export function bassPulse(id: string, x: number, y: number, degrees: [number, number], beats = 2) {
  const gap = PX_PER_BEAT * beats;
  const blocks = [
    { id: `${id}-a`, x: x - gap / 2, y, kind: 'bass' as const, degree: degrees[0], every: 0, code: `length ${beats2(beats)}` },
    { id: `${id}-b`, x: x + gap / 2, y, kind: 'bass' as const, degree: degrees[1], every: 0, code: `length ${beats2(beats)}` },
  ];
  return {
    blocks,
    links: [
      { id: `${blocks[0].id}>${blocks[1].id}`, from: blocks[0].id, to: blocks[1].id },
      { id: `${blocks[1].id}>${blocks[0].id}`, from: blocks[1].id, to: blocks[0].id },
    ],
    first: `${id}-a`,
  };
}

export const songStart = { id: 'start', x: -560, y: 0, kind: 'start' as const, degree: 0, every: 0 };

/**
 * One pass of the graph page, as phrases for `phraseLoop`: for each curve
 * that reads, notes in step order where a note's `beats` lasts until the next
 * one (a rest stretches the hop, not the sound) and `extra` carries the
 * note's own length and loudness. A curve that only ever sounds once gets the
 * note twice, since a loop needs somewhere to come back to.
 */
export function graphPhrases(spec: GraphSpec, curves: readonly CurveFn[]): { kind: BlockKind; notes: Note[] }[] {
  const rows: { kind: BlockKind; notes: Note[] }[] = [];
  const steps = Math.round(spec.loopBeats / spec.stepBeats);
  const sound = spec.lengthBeats ?? spec.stepBeats;
  for (const { curve, fn } of curves) {
    const hits: { beat: number; degree: number }[] = [];
    for (let k = 0; k < steps && hits.length < MAX_GRAPH_NOTES; k++) {
      const beat = k * spec.stepBeats;
      const degree = degreeAt(spec, curve, fn(xAt(spec, beat)));
      if (degree !== null) hits.push({ beat, degree });
    }
    if (!hits.length) continue;
    // The wrap-around: the last note lasts until the first one comes round.
    const span = (i: number) => (i + 1 < hits.length ? hits[i + 1].beat : spec.loopBeats + hits[0].beat) - hits[i].beat;
    const single = hits.length === 1;
    const source = single ? [hits[0], hits[0]] : hits;
    const notes = source.map((hit, i) => ({
      degree: hit.degree,
      beats: single ? spec.loopBeats / 2 : span(i),
      extra: [
        `length ${beats2(sound)}`,
        curve.level < 1 ? `velocity ${Math.round(curve.level * 100)}%` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }));
    rows.push({ kind: curve.kind as BlockKind, notes });
  }
  return rows;
}
