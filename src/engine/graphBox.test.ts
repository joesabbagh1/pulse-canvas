import { describe, expect, it } from 'vitest';
import { PX_PER_BEAT } from './geometry';
import { Scheduler, type GraphBlock, type GraphLink } from './scheduler';
import { DEFAULT_BLOCK_GRAPH } from './graph';
import { ROOT_HZ, SCALES, describePitch } from './tuning';

const B = PX_PER_BEAT;

// A graph box: 4 beats wide, one sweep of the window per pass, a note on every
// step. The start fires at 0, the box is one beat away, so the sweep runs on
// beats 1–5 and the pulse goes on down the outgoing link after that.
function graphBlock(patch: Partial<GraphBlock> = {}): GraphBlock {
  return {
    id: 'g',
    x: 0,
    y: 0,
    kind: 'tone',
    degree: 0,
    every: 0,
    scale: SCALES[0],
    rootHz: ROOT_HZ,
    beats: 4,
    graph: { ...DEFAULT_BLOCK_GRAPH, stepBeats: 1 },
    ...patch,
  };
}

function setup(blocks: GraphBlock[], links: GraphLink[]) {
  const hits: { id: string; kind: string; degree: number; beat: number; velocity: number; length: number | null }[] = [];
  const s = new Scheduler((block, beat, _shift, shape) => {
    hits.push({ id: block.id, kind: block.kind, degree: block.degree, beat, velocity: shape.velocity, length: shape.length });
  });
  s.setSnap(true, 0);
  s.setGraph(blocks, links, 0);
  return { s, hits };
}

describe('graph boxes in the scheduler', () => {
  it('sweeps the window across the pass, a note on every step, then lets the pulse go on', () => {
    const { s, hits } = setup(
      [
        { id: 's', x: -3 * B, y: 0, kind: 'start', degree: 0, every: 0, scale: SCALES[0], rootHz: ROOT_HZ },
        graphBlock({ graph: { ...DEFAULT_BLOCK_GRAPH, stepBeats: 1, x0: 0, x1: 4, y0: -1, y1: 1, baseDegree: 0, spanDegrees: 8, curves: [{ id: 'c', expr: 'x', kind: 'flute', level: 1, shift: 0 }] } }),
        { id: 'out', x: 3 * B, y: 0, kind: 'pluck', degree: 0, every: 0, scale: SCALES[0], rootHz: ROOT_HZ },
      ],
      [
        { id: 's-g', source: 's', target: 'g' },
        { id: 'g-out', source: 'g', target: 'out' },
      ],
    );
    s.start(0);
    s.advance(12);
    // The sweep: steps at beats 1–4 on the flute; the pulse leaves at beat 5
    // and reaches the pluck one beat later.
    const sweep = hits.filter((h) => h.id === 'g');
    expect(sweep.map((h) => h.beat)).toEqual([1, 2, 3, 4]);
    expect(sweep.every((h) => h.kind === 'flute')).toBe(true);
    // y = x climbs through the window and keeps climbing past the top, the way
    // the page's sweep does too: 0 is the middle (degree 4), 1 the top (8).
    expect(sweep.map((h) => h.degree)).toEqual([4, 8, 12, 16]);
    expect(describePitch(4, SCALES[0]).name).toBe('A');
    expect(describePitch(8, SCALES[0]).name).toBe('G');
    expect(hits.find((h) => h.id === 'out')?.beat).toBe(6);
  });

  it('maps the window onto degrees and gives each curve its own instrument', () => {
    const { s, hits } = setup(
      [
        { id: 's', x: -3 * B, y: 0, kind: 'start', degree: 0, every: 0, scale: SCALES[0], rootHz: ROOT_HZ },
        graphBlock({
          graph: {
            ...DEFAULT_BLOCK_GRAPH, stepBeats: 2, y0: -1, y1: 1, baseDegree: 0, spanDegrees: 8,
            curves: [
              { id: 'hi', expr: '1', kind: 'flute', level: 1, shift: 0 },
              { id: 'lo', expr: '-1', kind: 'bass', level: 0.5, shift: 0 },
            ],
          },
        }),
      ],
      [{ id: 's-g', source: 's', target: 'g' }],
    );
    s.start(0);
    s.advance(6);
    const notes = hits.filter((h) => h.id === 'g');
    expect(notes).toHaveLength(4);
    expect(notes.filter((n) => n.kind === 'flute').map((n) => n.degree)).toEqual([8, 8]);
    expect(notes.filter((n) => n.kind === 'bass').map((n) => n.degree)).toEqual([0, 0]);
    // The curve's level rides the block's own velocity.
    expect(notes.find((n) => n.kind === 'bass')?.velocity).toBeCloseTo(0.5, 6);
  });

  it('rests where the curve has no value, without breaking the sweep', () => {
    const { s, hits } = setup(
      [
        { id: 's', x: -3 * B, y: 0, kind: 'start', degree: 0, every: 0, scale: SCALES[0], rootHz: ROOT_HZ },
        // The window is x 0..8 over 8 beats, so beat b reads x = b; the square
        // root is silent until x reaches 4.
        graphBlock({
          beats: 8,
          graph: { ...DEFAULT_BLOCK_GRAPH, stepBeats: 1, x0: 0, x1: 8, curves: [{ id: 'c', expr: 'sqrt(x - 4)', kind: 'tone', level: 1, shift: 0 }] },
        }),
      ],
      [{ id: 's-g', source: 's', target: 'g' }],
    );
    s.start(0);
    s.advance(12);
    expect(hits.filter((h) => h.id === 'g').map((h) => h.beat)).toEqual([5, 6, 7, 8]);
  });

  it('pages the sweep window by window, without repeating a step', () => {
    const { s, hits } = setup(
      [
        { id: 's', x: -3 * B, y: 0, kind: 'start', degree: 0, every: 0, scale: SCALES[0], rootHz: ROOT_HZ },
        graphBlock({ graph: { ...DEFAULT_BLOCK_GRAPH, stepBeats: 0.25, curves: [{ id: 'c', expr: 'sin(x)', kind: 'tone', level: 1, shift: 0 }] } }),
      ],
      [{ id: 's-g', source: 's', target: 'g' }],
    );
    s.start(0);
    s.advance(2);
    s.advance(3);
    s.advance(6);
    const beats = hits.filter((h) => h.id === 'g').map((h) => h.beat);
    expect(beats).toEqual([...new Set(beats)]);
    expect(beats).toHaveLength(16);
  });

  it('keeps a curve that does not read silent, and still lets the pulse through', () => {
    const { s, hits } = setup(
      [
        { id: 's', x: -3 * B, y: 0, kind: 'start', degree: 0, every: 0, scale: SCALES[0], rootHz: ROOT_HZ },
        graphBlock({ graph: { ...DEFAULT_BLOCK_GRAPH, stepBeats: 1, curves: [{ id: 'c', expr: 'oops(x)', kind: 'tone', level: 1, shift: 0 }] } }),
        { id: 'out', x: 3 * B, y: 0, kind: 'pluck', degree: 0, every: 0, scale: SCALES[0], rootHz: ROOT_HZ },
      ],
      [
        { id: 's-g', source: 's', target: 'g' },
        { id: 'g-out', source: 'g', target: 'out' },
      ],
    );
    s.start(0);
    s.advance(10);
    expect(hits.filter((h) => h.id === 'g')).toEqual([]);
    expect(hits.find((h) => h.id === 'out')?.beat).toBe(6);
  });

  it('respects the block: its degree transposes, its code shapes the notes', () => {
    const { s, hits } = setup(
      [
        { id: 's', x: -3 * B, y: 0, kind: 'start', degree: 0, every: 0, scale: SCALES[0], rootHz: ROOT_HZ },
        graphBlock({
          degree: 2,
          code: 'velocity 50%',
          graph: { ...DEFAULT_BLOCK_GRAPH, stepBeats: 2, y0: -1, y1: 1, baseDegree: 0, spanDegrees: 8, curves: [{ id: 'c', expr: '1', kind: 'flute', level: 0.8, shift: 0 }] },
        }),
      ],
      [{ id: 's-g', source: 's', target: 'g' }],
    );
    s.start(0);
    s.advance(6);
    const notes = hits.filter((h) => h.id === 'g');
    expect(notes.map((h) => h.degree)).toEqual([10, 10]);
    expect(notes[0].velocity).toBeCloseTo(0.4, 6);
    // The flute holds each note for its step.
    expect(notes[0].length).toBe(2);
  });

  it('leaves struck voices their own length', () => {
    const { s, hits } = setup(
      [
        { id: 's', x: -3 * B, y: 0, kind: 'start', degree: 0, every: 0, scale: SCALES[0], rootHz: ROOT_HZ },
        graphBlock({ graph: { ...DEFAULT_BLOCK_GRAPH, stepBeats: 2, curves: [{ id: 'c', expr: '1', kind: 'pluck', level: 1, shift: 0 }] } }),
      ],
      [{ id: 's-g', source: 's', target: 'g' }],
    );
    s.start(0);
    s.advance(6);
    expect(hits.filter((h) => h.id === 'g').map((h) => h.length)).toEqual([null, null]);
  });
});
