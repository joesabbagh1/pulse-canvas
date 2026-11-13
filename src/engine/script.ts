// Code on blocks and links: a tiny line-based language that decides what
// happens to each pulse. It is interpreted, never evaluated as JavaScript, so
// a shared piece can't run anything but these commands.
//
//   drop               the pulse stops here
//   mute               (blocks) pass the pulse on without sounding
//   transpose +2       shift the pitch, in scale degrees, from here on
//   transpose to 0     set that shift outright, so a loop doesn't keep climbing
//   velocity 60%       (blocks) how loud this block's note is
//   length 1/8         (blocks) how long this block's note is, in beats
//   delay 1/2          wait this many beats first
//   route cycle        (blocks) which links to send down: all, cycle or random
//
// Any line can start with conditions, each ending in a colon:
//   every 3: ...       on the 3rd, 6th, 9th… pulse through here
//   chance 50%: ...    on a coin toss (or "chance 0.25:")
// Lines run top to bottom; "drop" ends the run. "#" starts a comment.

export type Target = 'block' | 'link';
export type RouteMode = 'all' | 'cycle' | 'random';

type Condition = { kind: 'every'; n: number } | { kind: 'chance'; p: number };
type Action =
  | { op: 'drop' }
  | { op: 'mute' }
  | { op: 'transpose'; steps: number; to: boolean }
  | { op: 'velocity'; level: number }
  | { op: 'length'; beats: number }
  | { op: 'delay'; beats: number }
  | { op: 'route'; mode: RouteMode };

interface Statement {
  when: Condition[];
  action: Action;
}

export interface ScriptError {
  line: number;
  message: string;
}

export interface Program {
  statements: Statement[];
  errors: ScriptError[];
}

export interface Outcome {
  drop: boolean;
  mute: boolean;
  /** Set by "transpose to": the shift to start from, instead of the pulse's own. */
  shiftTo: number | null;
  transpose: number;
  /** 0 to 1, of full loudness. */
  velocity: number;
  /** Note length in beats; null leaves the instrument's own. */
  length: number | null;
  delay: number;
  route: RouteMode;
}

export const MAX_DELAY = 64;
const MAX_TRANSPOSE = 48;
const ROUTES: RouteMode[] = ['all', 'cycle', 'random'];
const COMMANDS = 'drop, mute, transpose, velocity, length, delay or route';

/** "1/2", "0.5" or "2", as a non-negative number of beats. */
function parseBeats(s: string): number {
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  const n = frac ? Number(frac[1]) / Number(frac[2]) : /^\d*\.?\d+$/.test(s) ? Number(s) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

function parseCondition(text: string): Condition {
  const [word, arg, extra] = text.split(/\s+/);
  if (word === 'every' && arg && !extra) {
    const n = Number(arg);
    if (Number.isInteger(n) && n >= 1) return { kind: 'every', n };
    throw new Error(`"every" needs a whole number of pulses, like "every 3:".`);
  }
  if (word === 'chance' && arg && !extra) {
    const p = arg.endsWith('%') ? Number(arg.slice(0, -1)) / 100 : Number(arg);
    if (p >= 0 && p <= 1) return { kind: 'chance', p };
    throw new Error(`"chance" needs a percentage, like "chance 50%:".`);
  }
  throw new Error(`"${text}" isn't a condition; use "every 3:" or "chance 50%:".`);
}

function parseAction(text: string, target: Target): Action {
  const words = text.split(/\s+/);
  const word = words[0];
  // "transpose to 3" is the one command with two words after it.
  const to = word === 'transpose' && words[1] === 'to';
  const [arg, extra] = words.slice(to ? 2 : 1);
  const blockOnly = () => {
    if (target === 'link') throw new Error(`"${word}" only works on blocks.`);
  };
  const noArg = () => {
    if (arg) throw new Error(`"${word}" takes nothing after it.`);
  };
  if (extra) throw new Error(`unexpected "${extra}" after "${words.slice(0, words.indexOf(extra)).join(' ')}".`);
  switch (word) {
    case 'drop':
      noArg();
      return { op: 'drop' };
    case 'mute':
      blockOnly();
      noArg();
      return { op: 'mute' };
    case 'transpose': {
      const steps = /^[+-]?\d+$/.test(arg ?? '') ? Number(arg) : NaN;
      if (Math.abs(steps) <= MAX_TRANSPOSE) return { op: 'transpose', steps, to };
      throw new Error(
        `"transpose" needs whole scale degrees up to ${MAX_TRANSPOSE}, like "transpose +2", "transpose -7" or "transpose to 0".`,
      );
    }
    case 'velocity': {
      blockOnly();
      const level = arg?.endsWith('%') ? Number(arg.slice(0, -1)) / 100 : Number(arg);
      if (arg && level >= 0 && level <= 1) return { op: 'velocity', level };
      throw new Error(`"velocity" needs a loudness up to 100%, like "velocity 60%".`);
    }
    case 'length': {
      blockOnly();
      const beats = parseBeats(arg ?? '');
      if (beats > 0 && beats <= MAX_DELAY) return { op: 'length', beats };
      throw new Error(`"length" needs beats above 0, like "length 1/8" or "length 2".`);
    }
    case 'delay': {
      const beats = parseBeats(arg ?? '');
      if (beats >= 0 && beats <= MAX_DELAY) return { op: 'delay', beats };
      throw new Error(`"delay" needs beats up to ${MAX_DELAY}, like "delay 1/2" or "delay 1".`);
    }
    case 'route':
      blockOnly();
      if (ROUTES.includes(arg as RouteMode)) return { op: 'route', mode: arg as RouteMode };
      throw new Error(`"route" takes all, cycle or random.`);
    default:
      throw new Error(`"${word}" isn't a command; try ${target === 'block' ? COMMANDS : 'drop, transpose or delay'}.`);
  }
}

/** Lines that don't parse are left out of the program and reported in `errors`. */
export function compile(source: string, target: Target): Program {
  const program: Program = { statements: [], errors: [] };
  source.split('\n').forEach((raw, i) => {
    const text = raw.replace(/#.*/, '').trim().toLowerCase();
    if (!text) return;
    const parts = text.split(':').map((p) => p.trim());
    try {
      const action = parts.pop()!;
      if (!action) throw new Error('a condition needs something to do after its colon.');
      program.statements.push({ when: parts.map(parseCondition), action: parseAction(action, target) });
    } catch (err) {
      program.errors.push({ line: i + 1, message: (err as Error).message });
    }
  });
  return program;
}

export const PASS: Readonly<Outcome> = {
  drop: false,
  mute: false,
  shiftTo: null,
  transpose: 0,
  velocity: 1,
  length: null,
  delay: 0,
  route: 'all',
};

/** Runs a program for the `count`-th pulse (counting from 1) through its block or link. */
export function run(program: Program | undefined, count: number, random: () => number): Outcome {
  const out = { ...PASS };
  for (const { when, action } of program?.statements ?? []) {
    if (!when.every((c) => (c.kind === 'every' ? count % c.n === 0 : random() < c.p))) continue;
    switch (action.op) {
      case 'drop':
        out.drop = true;
        return out;
      case 'mute':
        out.mute = true;
        break;
      case 'transpose':
        if (action.to) {
          out.shiftTo = action.steps;
          out.transpose = 0;
        } else {
          out.transpose += action.steps;
        }
        break;
      case 'velocity':
        out.velocity = action.level;
        break;
      case 'length':
        out.length = action.beats;
        break;
      case 'delay':
        out.delay = Math.min(MAX_DELAY, out.delay + action.beats);
        break;
      case 'route':
        out.route = action.mode;
        break;
    }
  }
  return out;
}

/** A small seeded generator, so a run with chances can be replayed exactly. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
