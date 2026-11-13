import { describe, expect, it } from 'vitest';
import { PASS, compile, run, seededRandom } from './script';

const never = () => 1;

describe('compile', () => {
  it('reads commands, conditions and comments', () => {
    const program = compile(
      ['# a comment', 'Transpose +2', 'every 2: delay 1/2  # trailing', 'every 3: chance 50%: drop', '', 'route cycle'].join('\n'),
      'block',
    );
    expect(program.errors).toEqual([]);
    expect(program.statements).toEqual([
      { when: [], action: { op: 'transpose', steps: 2, to: false } },
      { when: [{ kind: 'every', n: 2 }], action: { op: 'delay', beats: 0.5 } },
      {
        when: [
          { kind: 'every', n: 3 },
          { kind: 'chance', p: 0.5 },
        ],
        action: { op: 'drop' },
      },
      { when: [], action: { op: 'route', mode: 'cycle' } },
    ]);
  });

  it('reports each bad line and keeps the good ones', () => {
    const program = compile(['transpse 2', 'drop', 'every two: drop', 'delay -1', 'route sideways', 'every 2:'].join('\n'), 'block');
    expect(program.statements).toHaveLength(1);
    expect(program.errors.map((e) => e.line)).toEqual([1, 3, 4, 5, 6]);
    expect(program.errors[0].message).toContain('"transpse" isn\'t a command');
  });

  it('keeps block-only commands off links', () => {
    expect(compile('route random\nmute', 'link').errors.map((e) => e.message)).toEqual([
      '"route" only works on blocks.',
      '"mute" only works on blocks.',
    ]);
  });
});

describe('run', () => {
  it('passes pulses through untouched with no code', () => {
    expect(run(undefined, 1, never)).toEqual(PASS);
  });

  it('applies "every" on the nth, 2nth… pulse', () => {
    const program = compile('every 3: transpose +7', 'block');
    expect([1, 2, 3, 4, 5, 6].map((n) => run(program, n, never).transpose)).toEqual([0, 0, 7, 0, 0, 7]);
  });

  it('adds up transposes and delays, and stops at drop', () => {
    const program = compile('transpose +2\ntranspose -5\ndelay 1/4\ndelay 1/4\ndrop\ntranspose +100', 'block');
    expect(run(program, 1, never)).toEqual({ ...PASS, drop: true, transpose: -3, delay: 0.5 });
  });

  it('rolls chances with the given random source', () => {
    const program = compile('chance 25%: drop', 'link');
    const random = seededRandom(7);
    const dropped = Array.from({ length: 2000 }, (_, i) => run(program, i + 1, random).drop).filter(Boolean).length;
    expect(dropped / 2000).toBeCloseTo(0.25, 1);
    // The same seed replays the same choices.
    const replay = (seed: number) => {
      const random = seededRandom(seed);
      return Array.from({ length: 20 }, (_, i) => run(program, i + 1, random).drop);
    };
    expect(replay(3)).toEqual(replay(3));
    expect(replay(3)).not.toEqual(replay(4));
  });
});

describe('note shape and absolute transpose', () => {
  it('reads "transpose to", velocity and length', () => {
    const program = compile('transpose to -3\nvelocity 60%\nvelocity 0.25\nlength 1/8', 'block');
    expect(program.errors).toEqual([]);
    expect(program.statements.map((s) => s.action)).toEqual([
      { op: 'transpose', steps: -3, to: true },
      { op: 'velocity', level: 0.6 },
      { op: 'velocity', level: 0.25 },
      { op: 'length', beats: 0.125 },
    ]);
  });

  it('reports bad values, and keeps note shape off links', () => {
    const block = compile('velocity 150%\nvelocity\nlength 0\ntranspose to\ntranspose to 2 3', 'block');
    expect(block.errors.map((e) => e.line)).toEqual([1, 2, 3, 4, 5]);
    expect(block.errors[4].message).toBe('unexpected "3" after "transpose to 2".');
    expect(compile('velocity 50%\nlength 1', 'link').errors.map((e) => e.message)).toEqual([
      '"velocity" only works on blocks.',
      '"length" only works on blocks.',
    ]);
    expect(compile('transpose to 0', 'link').errors).toEqual([]);
  });

  it('lets "transpose to" set the shift outright, with later transposes on top', () => {
    expect(run(compile('transpose +5\ntranspose to 2\ntranspose +1', 'block'), 1, never)).toMatchObject({ shiftTo: 2, transpose: 1 });
    expect(run(compile('transpose +5', 'block'), 1, never)).toMatchObject({ shiftTo: null, transpose: 5 });
  });

  it('defaults to full velocity and the instrument\'s own length, last line winning', () => {
    expect(run(undefined, 1, never)).toMatchObject({ velocity: 1, length: null });
    const program = compile('velocity 40%\nevery 4: velocity 100%\nlength 1/2', 'block');
    expect([1, 2, 3, 4].map((n) => run(program, n, never).velocity)).toEqual([0.4, 0.4, 0.4, 1]);
    expect(run(program, 1, never).length).toBe(0.5);
  });
});
