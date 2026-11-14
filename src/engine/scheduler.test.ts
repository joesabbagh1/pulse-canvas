import { describe, expect, it } from 'vitest';
import { PX_PER_BEAT } from './geometry';
import { MAX_PULSES, Scheduler, type GraphBlock, type GraphLink, type NoteShape } from './scheduler';
import { ROOT_HZ, SCALES } from './tuning';

const B = PX_PER_BEAT;

function block(id: string, x: number, y: number, kind: GraphBlock['kind'] = 'tone', every = 0, code = ''): GraphBlock {
  return { id, x, y, kind, degree: 0, every, scale: SCALES[0], rootHz: ROOT_HZ, code };
}

function link(source: string, target: string, bends: GraphLink['bends'] = [], code = ''): GraphLink {
  return { id: `${source}-${target}`, source, target, bends, code };
}

function setup(blocks: GraphBlock[], links: GraphLink[], snap = true) {
  const hits: [string, number][] = [];
  const shifts: [string, number][] = [];
  const shapes: [string, NoteShape][] = [];
  const s = new Scheduler((b, beat, shift, shape) => {
    hits.push([b.id, beat]);
    shifts.push([b.id, shift]);
    shapes.push([b.id, shape]);
  });
  s.setSnap(snap, 0);
  s.setGraph(blocks, links, 0);
  return { s, hits, shifts, shapes };
}

describe('Scheduler', () => {
  it('a loop repeats with a period equal to its total link length', () => {
    // start -> a, then a <-> b one beat apart: a loop of two beats.
    const { s, hits } = setup(
      [block('s', -B, 0, 'start'), block('a', 0, 0), block('b', B, 0)],
      [link('s', 'a'), link('a', 'b'), link('b', 'a')],
    );
    s.start(0);
    s.advance(6);
    expect(hits).toEqual([
      ['s', 0],
      ['a', 1],
      ['b', 2],
      ['a', 3],
      ['b', 4],
      ['a', 5],
      ['b', 6],
    ]);
  });

  it('snap rounds link durations to quarter beats', () => {
    const { s } = setup([block('a', 0, 0), block('b', 1.15 * B, 0)], [link('a', 'b')]);
    expect(s.link('a-b')!.beats).toBe(1.25);
    s.setSnap(false, 0);
    expect(s.link('a-b')!.beats).toBeCloseTo(1.15);
  });

  it('dragging a block mid-flight stretches the remaining travel time', () => {
    const blocks = [block('s', 0, 0, 'start'), block('a', 2 * B, 0)];
    const links = [link('s', 'a')];
    const { s, hits } = setup(blocks, links);
    s.start(0);
    s.advance(0.5);
    // Halfway along a 2-beat link at beat 1, the link becomes 4 beats long:
    // the remaining half now takes 2 beats instead of 1.
    s.setGraph([blocks[0], block('a', 4 * B, 0)], links, 1);
    s.advance(10);
    expect(hits).toEqual([
      ['s', 0],
      ['a', 3],
    ]);
  });

  it('retimed arrivals stay on the grid when snapping', () => {
    const blocks = [block('s', 0, 0, 'start'), block('a', 2 * B, 0)];
    const links = [link('s', 'a')];
    const { s, hits } = setup(blocks, links);
    s.start(0);
    s.advance(0.1);
    // 15% along at beat 0.3, the link becomes 3 beats: 0.3 + 0.85 * 3 = 2.85,
    // which snaps to 2.75.
    s.setGraph([blocks[0], block('a', 3 * B, 0)], links, 0.3);
    s.advance(10);
    expect(hits).toEqual([
      ['s', 0],
      ['a', 2.75],
    ]);
  });

  it('a bent link lasts as long as its path, not the straight distance', () => {
    // One beat apart, bent into a U that is three beats long.
    const { s, hits } = setup(
      [block('s', 0, 0, 'start'), block('a', B, 0)],
      [link('s', 'a', [{ x: 0, y: B }, { x: B, y: B }])],
    );
    expect(s.link('s-a')!.beats).toBe(3);
    s.start(0);
    s.advance(10);
    expect(hits).toEqual([
      ['s', 0],
      ['a', 3],
    ]);
  });

  it('dragging a bend mid-flight retimes the pulse like moving a block', () => {
    const blocks = [block('s', 0, 0, 'start'), block('a', 2 * B, 0)];
    const { s, hits } = setup(blocks, [link('s', 'a', [{ x: B, y: 0 }])]);
    s.start(0);
    s.advance(0.5);
    // Halfway at beat 1, the bend is pulled out so the link is 2√2 ≈ 2.83 beats
    // long, snapped to 2¾: the remaining half takes 1⅜, arriving at 2.375 → 2.5.
    s.setGraph(blocks, [link('s', 'a', [{ x: B, y: B }])], 1);
    s.advance(10);
    expect(hits).toEqual([
      ['s', 0],
      ['a', 2.5],
    ]);
  });

  it('opposite links sit side by side only while both are straight', () => {
    const blocks = [block('a', 0, 0), block('b', B, 0)];
    const { s } = setup(blocks, [link('a', 'b'), link('b', 'a')]);
    expect(s.link('a-b')!.points[0].y).not.toBe(0);
    s.setGraph(blocks, [link('a', 'b'), link('b', 'a', [{ x: B / 2, y: B }])], 0);
    expect(s.link('a-b')!.points[0].y).toBe(0);
    expect(s.link('b-a')!.points[0].y).toBe(0);
  });

  it('pulses arriving together at a block merge into one hit', () => {
    // s fans out to a and b, which both reach c after the same total distance.
    const { s, hits } = setup(
      [block('s', 0, 0, 'start'), block('a', B, -B), block('b', B, B), block('c', 2 * B, 0)],
      [link('s', 'a'), link('s', 'b'), link('a', 'c'), link('b', 'c')],
    );
    s.start(0);
    s.advance(10);
    expect(hits.filter(([id]) => id === 'c')).toHaveLength(1);
  });

  it('caps the number of pulses in flight', () => {
    // Every block feeds two others in a cycle with unequal lengths, so pulses
    // multiply instead of merging.
    const { s } = setup(
      [block('s', 0, 0, 'start'), block('a', B, 0), block('b', B * 1.9, B * 0.7), block('c', B * 2.3, -B * 1.1)],
      [link('s', 'a'), link('a', 'b'), link('a', 'c'), link('b', 'a'), link('b', 'c'), link('c', 'a'), link('c', 'b')],
      false,
    );
    s.start(0);
    for (let beat = 1; beat < 200; beat++) {
      s.advance(beat);
      s.prune(beat - 1);
      expect(s.inFlight()).toBeLessThanOrEqual(MAX_PULSES);
    }
    expect(s.overflowBeat).toBeGreaterThan(0);
  });

  it('removing a link drops the pulses travelling on it', () => {
    const blocks = [block('s', 0, 0, 'start'), block('a', B, 0)];
    const { s, hits } = setup(blocks, [link('s', 'a')]);
    s.start(0);
    s.advance(0.5);
    expect(s.pulses).toHaveLength(1);
    s.setGraph(blocks, [], 0.5);
    s.advance(5);
    expect(s.pulses).toHaveLength(0);
    expect(hits).toEqual([['s', 0]]);
  });

  it('repeating start blocks fire every N beats and pick up changes while playing', () => {
    const { s, hits } = setup([block('s', 0, 0, 'start', 2)], []);
    s.start(0);
    s.advance(4.5);
    expect(hits.map(([, beat]) => beat)).toEqual([0, 2, 4]);
    s.setGraph([block('s', 0, 0, 'start', 3)], [], 4.5);
    s.advance(10);
    expect(hits.map(([, beat]) => beat)).toEqual([0, 2, 4, 6, 9]);
  });

  describe('code', () => {
    // start -> a -> b, one beat per link.
    const chain = (aCode = '', abCode = '') => setup(
      [block('s', -B, 0, 'start'), block('a', 0, 0, 'tone', 0, aCode), block('b', B, 0)],
      [link('s', 'a'), link('a', 'b', [], abCode)],
    );

    it('"every N: drop" swallows every Nth pulse, silencing the block and what follows', () => {
      const { s, hits } = setup(
        [block('s', -B, 0, 'start'), block('a', 0, 0), block('b', B, 0, 'tone', 0, 'every 2: drop')],
        [link('s', 'a'), link('a', 'b'), link('b', 'a')],
      );
      s.start(0);
      s.advance(10);
      expect(hits).toEqual([
        ['s', 0],
        ['a', 1],
        ['b', 2],
        ['a', 3],
      ]);
    });

    it('a transpose rides along with the pulse, adding up on its way', () => {
      const { s, shifts } = chain('transpose +1', 'transpose +2');
      s.start(0);
      s.advance(10);
      expect(shifts).toEqual([
        ['s', 0],
        ['a', 1],
        ['b', 3],
      ]);
    });

    it('a block delay holds back its sound and its pulses', () => {
      const { s, hits } = chain('delay 1/2');
      s.start(0);
      s.advance(10);
      expect(hits).toEqual([
        ['s', 0],
        ['a', 1.5],
        ['b', 2.5],
      ]);
    });

    it('a link delay holds the pulse at its start, and a link can drop', () => {
      const delayed = chain('', 'delay 1');
      delayed.s.start(0);
      delayed.s.advance(0.5);
      delayed.s.advance(1.5);
      // Waiting at the start of a -> b: in flight, but not moving yet.
      expect(delayed.s.pulses.find((p) => p.link === 'a-b')).toMatchObject({ depart: 2, arrive: 3 });
      delayed.s.advance(10);
      expect(delayed.hits.at(-1)).toEqual(['b', 3]);

      const dropped = chain('', 'drop');
      dropped.s.start(0);
      dropped.s.advance(10);
      expect(dropped.hits.map(([id]) => id)).toEqual(['s', 'a']);
    });

    it('mute passes the pulse on without sounding', () => {
      const { s, hits } = chain('mute');
      s.start(0);
      s.advance(10);
      expect(hits.map(([id]) => id)).toEqual(['s', 'b']);
    });

    it('"route cycle" sends each pulse down one link, taking turns', () => {
      // s fires every 2 beats; a fans out to b and c.
      const { s, hits } = setup(
        [block('s', -B, 0, 'start', 2), block('a', 0, 0, 'tone', 0, 'route cycle'), block('b', B, 0), block('c', 0, B)],
        [link('s', 'a'), link('a', 'b'), link('a', 'c')],
      );
      s.start(0);
      s.advance(6.5);
      expect(hits.filter(([id]) => id === 'b' || id === 'c')).toEqual([
        ['b', 2],
        ['c', 4],
        ['b', 6],
      ]);
    });

    it('"route random" picks one link per pulse, and a seed replays the choices', () => {
      const play = (seed: number) => {
        const { s, hits } = setup(
          [block('s', -B, 0, 'start', 1), block('a', 0, 0, 'tone', 0, 'route random'), block('b', B, 0), block('c', 0, B)],
          [link('s', 'a'), link('a', 'b'), link('a', 'c')],
        );
        s.start(0, seed);
        s.advance(40.5);
        return hits.filter(([id]) => id === 'b' || id === 'c').map(([id]) => id);
      };
      // Pulses fired at beats 0…38 get through a to b or c by beat 40.
      const run = play(11);
      expect(run).toHaveLength(39);
      expect(run).toContain('b');
      expect(run).toContain('c');
      expect(play(11)).toEqual(run);
    });
  });

  describe('note shape and absolute transpose', () => {
    // a <-> b, one beat each way: a loop that passes a at beats 1, 3, 5…
    const loop = (aCode: string) =>
      setup(
        [block('s', -B, 0, 'start'), block('a', 0, 0, 'tone', 0, aCode), block('b', B, 0)],
        [link('s', 'a'), link('a', 'b'), link('b', 'a')],
      );

    it('a plain transpose in a loop climbs on every pass', () => {
      const { s, shifts } = loop('transpose +2');
      s.start(0);
      s.advance(6);
      expect(shifts.filter(([id]) => id === 'a').map(([, n]) => n)).toEqual([2, 4, 6]);
    });

    it('"transpose to" lets a loop alternate instead of climbing', () => {
      const { s, shifts } = loop('transpose to 0\nevery 2: transpose to +2');
      s.start(0);
      s.advance(8);
      expect(shifts.filter(([id]) => id === 'a').map(([, n]) => n)).toEqual([0, 2, 0, 2]);
      // b, after a, hears the same shift: it rides on the pulse.
      expect(shifts.filter(([id]) => id === 'b').map(([, n]) => n)).toEqual([0, 2, 0, 2]);
    });

    it('velocity and length shape only the note of the block they are on', () => {
      const { s, shapes } = loop('every 2: velocity 50%\nlength 1/8');
      s.start(0);
      s.advance(6);
      expect(shapes.filter(([id]) => id === 'a').map(([, shape]) => shape)).toEqual([
        { velocity: 1, length: 0.125 },
        { velocity: 0.5, length: 0.125 },
        { velocity: 1, length: 0.125 },
      ]);
      expect(shapes.find(([id]) => id === 'b')![1]).toEqual({ velocity: 1, length: null });
    });
  });

  describe('pattern blocks', () => {
    // start -> p -> b on one line. p is a box 2 beats long centred on 0, so its
    // left edge is a beat from the start block and its right edge a beat from b.
    const box = (pattern: string, code = '', beats = 2): GraphBlock => ({ ...block('p', 0, 0, 'tone', 0, code), pattern, beats });
    function patch(p: GraphBlock, every = 0) {
      const notes: [string, number, number][] = [];
      const spots: (number | undefined)[] = [];
      const lengths: (number | null)[] = [];
      const velocities: number[] = [];
      const s = new Scheduler((b, beat, _shift, shape, at) => {
        if (b.kind === 'start') return;
        notes.push([b.id === 'p' ? b.kind : b.id, b.degree, beat]);
        spots.push(at?.x);
        lengths.push(shape.length);
        velocities.push(shape.velocity);
      });
      s.setGraph([block('s', -2 * B, 0, 'start', every), p, block('b', 2 * B, 0)], [link('s', 'p'), link('p', 'b')], 0);
      return { s, notes, spots, lengths, velocities, p };
    }

    it('plays the pattern across its length, then sends the pulse on from its far edge', () => {
      const { s, notes, spots, lengths } = patch(box('bd ~ 2 hh'));
      s.start(0);
      for (let beat = 0; beat <= 5; beat += 0.25) s.advance(beat);
      expect(notes).toEqual([
        ['tone', 0, 1],
        ['tone', 2, 2],
        ['tone', 0, 2.5],
        ['b', 0, 4],
      ]);
      // Each note sits where its beat falls across the box; the last hit is the plain block.
      expect(spots).toEqual([-B, 0, B / 2, undefined]);
      // The block's voice holds each step. bd and hh do not switch it to drums.
      expect(lengths).toEqual([0.5, 0.5, 0.5, null]);
      expect(s.link('s-p')).toMatchObject({ beats: 1, gapStart: 30, gapEnd: 7 });
      expect(s.link('p-b')).toMatchObject({ beats: 1, gapStart: 7, gapEnd: 30 });
    });

    it('keeps the rest of a bar when one note fails', () => {
      const heard: number[] = [];
      let attempts = 0;
      const s = new Scheduler((block, beat) => {
        if (block.kind === 'start') return;
        attempts += 1;
        if (attempts === 1) throw new Error('filter rejected the downbeat');
        heard.push(beat);
      });
      const p = box('0 1 2 3');
      s.setGraph([block('s', -2 * B, 0, 'start', 4), p], [link('s', 'p')], 0);
      s.start(0);
      for (let beat = 0; beat <= 4; beat += 0.25) s.advance(beat);
      expect(heard).toEqual([1.5, 2, 2.5]);
    });

    it('sends notes only as far as it has been advanced, each one once', () => {
      const { s, notes } = patch(box('0 1 2 3 4 5 6 7'));
      s.start(0);
      for (let beat = 0; beat <= 4; beat += 0.1) s.advance(beat);
      expect(notes.filter(([id]) => id === 'tone').map(([, degree, beat]) => [degree, beat])).toEqual([
        [0, 1],
        [1, 1.25],
        [2, 1.5],
        [3, 1.75],
        [4, 2],
        [5, 2.25],
        [6, 2.5],
        [7, 2.75],
      ]);
    });

    it('counts a pulse crossing the box as in flight, and keeps the pass until it is pruned', () => {
      const { s } = patch(box('bd sd'));
      s.start(0);
      s.advance(1.5);
      expect(s.inFlight()).toBe(1);
      expect(s.runs).toMatchObject([{ block: 'p', start: 1, end: 3, cycle: 0 }]);
      s.advance(3.5);
      s.prune(3.5);
      expect(s.runs).toEqual([]);
    });

    it('plays the next cycle of the pattern on each pulse', () => {
      const { s, notes } = patch(box('<0 2 4>'), 2);
      s.start(0);
      s.advance(8.5);
      expect(notes.filter(([id]) => id === 'tone').map(([, degree, beat]) => [degree, beat])).toEqual([
        [0, 1],
        [2, 3],
        [4, 5],
        [0, 7],
      ]);
    });

    it('lets passes overlap when pulses arrive faster than the box is long', () => {
      const { s, notes } = patch(box('0 1', '', 2), 1);
      s.start(0);
      for (let beat = 0; beat <= 3.5; beat += 0.25) s.advance(beat);
      expect(notes.filter(([id]) => id === 'tone').map(([, degree, beat]) => [degree, beat])).toEqual([
        [0, 1],
        [1, 2],
        [0, 2],
        [1, 3],
        [0, 3],
      ]);
    });

    it('takes the block pitch and the pulse transposition, and its code shapes every note', () => {
      const { s, notes, velocities, lengths } = patch({ ...box('0 2 piano:1', 'velocity 50%\nlength 1/8'), degree: 3 });
      s.start(0);
      s.advance(3);
      expect(notes.slice(0, 3).map(([kind, degree]) => [kind, degree])).toEqual([
        ['tone', 3],
        ['tone', 5],
        ['tone', 4],
      ]);
      expect(velocities.slice(0, 3)).toEqual([0.5, 0.5, 0.5]);
      expect(lengths.slice(0, 3)).toEqual([0.125, 0.125, 0.125]);
    });

    it('"fast", "slow" and "rev" change how a pass plays', () => {
      const degrees = (code: string, every = 0, until = 3.5) => {
        const { s, notes } = patch(box('0 1 2 3', code), every);
        s.start(0);
        s.advance(until);
        return notes.filter(([id]) => id === 'tone').map(([, degree]) => degree);
      };
      expect(degrees('fast 2')).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
      expect(degrees('rev')).toEqual([3, 2, 1, 0]);
      expect(degrees('slow 2', 2, 4.5)).toEqual([0, 1, 2, 3]);
      expect(degrees('every 2: rev', 2, 5)).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
    });

    it('a kit plays each named drum, and an accent is passed on', () => {
      const { s, notes } = patch(box('kit bd hh cp'));
      const accents: boolean[] = [];
      const marked = new Scheduler((_b, _beat, _shift, shape) => {
        if (_b.id !== 'p') return;
        accents.push(shape.accent === true);
      });
      s.start(0);
      s.advance(5);
      expect(notes.filter(([id]) => id !== 'b').map(([kind]) => kind)).toEqual(['kick', 'hat', 'clap']);

      marked.setGraph(
        [block('s', -2 * B, 0, 'start'), { ...box('0 ^2'), id: 'p' }, block('b', 2 * B, 0)],
        [link('s', 'p'), link('p', 'b')],
        0,
      );
      marked.start(0);
      marked.advance(5);
      expect(accents).toEqual([false, true]);
    });

    it('plays the block\'s instrument, whatever the pattern names', () => {
      const { s, notes } = patch({ ...box('bd sd hh'), kind: 'piano', degree: 5 });
      s.start(0);
      s.advance(3);
      expect(notes.filter(([kind]) => kind === 'piano').map(([, degree]) => degree)).toEqual([5, 5, 5]);
    });

    it('"mute" crosses the box in silence, and "drop" never enters it', () => {
      const muted = patch(box('bd sd', 'mute'));
      muted.s.start(0);
      muted.s.advance(5);
      expect(muted.notes).toEqual([['b', 0, 4]]);

      const dropped = patch(box('bd sd', 'drop'));
      dropped.s.start(0);
      dropped.s.advance(5);
      expect(dropped.notes).toEqual([]);
    });

    it('keeps playing the last pattern that parsed while a new one has a mistake', () => {
      const { s, notes, p } = patch(box('0 1'), 2);
      s.start(0);
      s.advance(2.5);
      s.setGraph([block('s', -2 * B, 0, 'start', 2), { ...p, pattern: '0 [1' }, block('b', 2 * B, 0)], [link('s', 'p'), link('p', 'b')], 2.5);
      s.advance(4.5);
      expect(notes.filter(([id]) => id === 'tone').map(([, degree, beat]) => [degree, beat])).toEqual([
        [0, 1],
        [1, 2],
        [0, 3],
        [1, 4],
      ]);
    });

    it('a pattern edited mid-pass plays its new notes from there on', () => {
      const { s, notes, p } = patch(box('0 1 2 3'));
      s.start(0);
      s.advance(1.9);
      s.setGraph([block('s', -2 * B, 0, 'start'), { ...p, pattern: '7 7 7 7' }, block('b', 2 * B, 0)], [link('s', 'p'), link('p', 'b')], 1.9);
      s.advance(3);
      expect(notes.filter(([id]) => id === 'tone').map(([, degree]) => degree)).toEqual([0, 1, 7, 7]);
    });

    it('a loop through a pattern lasts its links plus the pattern', () => {
      const hits: number[] = [];
      const s = new Scheduler((b, beat) => {
        if (b.id === 'b') hits.push(beat);
      });
      const blocks = [block('s', -2 * B, 0, 'start'), box('bd'), block('b', 2 * B, 0)];
      s.setGraph(blocks, [link('s', 'p'), link('p', 'b'), link('b', 'p')], 0);
      s.start(0);
      s.advance(20);
      // In at 1, out at 3, b at 4, back across 3 beats to the left edge at 7, and so on.
      expect(hits).toEqual([4, 10, 16]);
    });
  });
});
