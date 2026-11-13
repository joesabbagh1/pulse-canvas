import { parse, patternifyAST, type Hap, type MiniNode, type StrudelPattern } from '@strudel/mini';
import { instrumentById, type InstrumentId } from './instruments';
import { SCALES, scaleById } from './tuning';

// A pattern block's text is Strudel mini-notation (https://strudel.cc/learn/mini-notation/),
// parsed and queried by Strudel's own engine. Only the notation is used: it is
// parsed, never run as JavaScript, so a shared piece still can't execute code.
//
//   0 2 4          scale degrees above the block's own pitch
//   bd sd hh       hits of the block's instrument; the word only marks the step
//   x:4            a hit four degrees up. The block's instrument plays every hit.
//   ~              a rest
//   [a b]          squeeze into one step      a*2    twice as fast
//   <a b>          one per pulse              a(3,8) spread 3 over 8 steps
//   [a,b]          together                   a@3    three steps long
//   a?             half the time
//
// One cycle of the pattern lasts the block's length, and each pulse through
// the block plays the next cycle, so <a b> alternates pulse by pulse.

/** The drum names Tidal and Strudel use, as instruments here. */
const ALIASES: Record<string, InstrumentId> = {
  bd: 'kick',
  sd: 'snare',
  sn: 'snare',
  hh: 'hat',
  oh: 'hat-open',
  cp: 'clap',
  rim: 'sidestick',
  cr: 'crash',
  rd: 'ride',
  cb: 'cowbell',
  sh: 'shaker',
  tb: 'tambourine',
};

export const MAX_PATTERN_CHARS = 2000;
/** The most notes one pass of a pattern may hold, so a pasted piece can't flood the engine. */
export const MAX_PATTERN_NOTES = 256;
const MAX_DEGREE = 200;
const WIDEN = 1e-3;
const BIG = 1e9;

export interface PatternNote {
  /** Where it starts, as a fraction of the block's length. */
  at: number;
  /** How long it lasts, as a fraction of the block's length. */
  span: number;
  /** Null unless the pattern starts with `sound`: then this instrument plays the note. */
  kind: InstrumentId | null;
  /** Scale degrees above the block's pitch. A word with no number is 0. */
  degree: number;
  /** Where it is written, so the sounding word can light up. Offsets into the pattern text. */
  from?: number;
  to?: number;
  /** Set by `scale` at the start of the pattern. */
  scaleId?: string;
  /** Set by `octave` at the start of the pattern. */
  octave?: number;
}

/** A change to how one pass plays, from the block's code. */
export interface PatternShape {
  fast: number;
  rev: boolean;
}

const AS_WRITTEN: PatternShape = { fast: 1, rev: false };

export interface Pattern {
  source: string;
  /** What's wrong with it, in words. A pattern with an error plays nothing. */
  error: string | null;
  /** The notes of pass `cycle` that start in [from, to), in time order. */
  notes(cycle: number, from?: number, to?: number, shape?: PatternShape): PatternNote[];
}

const isNode = (v: unknown): v is MiniNode => typeof v === 'object' && v !== null && typeof (v as MiniNode).type_ === 'string';
const isRest = (word: string) => word === '~' || word === '-';

/** The instrument a word names: a drum name, or an instrument's own id. */
export function soundNamed(word: string): InstrumentId | null {
  const name = word.toLowerCase();
  const id = ALIASES[name] ?? name;
  return instrumentById(id) ? (id as InstrumentId) : null;
}

/** Every word and number written in the pattern, wherever it sits. */
function atoms(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) atoms(child, out);
  } else if (typeof node === 'object' && node !== null) {
    if (isNode(node) && node.type_ === 'atom' && typeof node.source_ === 'string') out.push(node.source_);
    for (const [key, child] of Object.entries(node)) if (key !== 'location_') atoms(child, out);
  }
  return out;
}

/** The largest number written anywhere under `node`, and at least 1. */
function largest(node: unknown): number {
  if (typeof node === 'number') return Number.isFinite(node) ? Math.max(1, Math.abs(node)) : BIG;
  if (typeof node === 'string') {
    const n = Number(node);
    return node.trim() !== '' && !Number.isNaN(n) ? Math.min(BIG, Math.max(1, Math.abs(n))) : 1;
  }
  let max = 1;
  if (Array.isArray(node)) {
    for (const child of node) max = Math.max(max, largest(child));
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node)) if (key !== 'location_') max = Math.max(max, largest(child));
  }
  return max;
}

/** The smallest number above zero written anywhere under `node`, and at most 1. */
function smallest(node: unknown): number {
  if (typeof node === 'number') return node > 0 ? Math.min(1, node) : 1;
  if (typeof node === 'string') {
    const n = Number(node);
    return node.trim() !== '' && n > 0 ? Math.min(1, n) : 1;
  }
  let min = 1;
  if (Array.isArray(node)) {
    for (const child of node) min = Math.min(min, smallest(child));
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node)) if (key !== 'location_') min = Math.min(min, smallest(child));
  }
  return min;
}

/**
 * How many cycles of a pattern fit, whole or in part, into one cycle of its
 * parent when it runs `speed` times as fast. A whole number of them line up
 * with the parent; anything else straddles one more.
 */
function cyclesSeen(speed: number): number {
  if (!(speed > 0) || !Number.isFinite(speed)) return 1;
  if (speed >= 1) return Number.isInteger(speed) ? speed : Math.ceil(speed) + 1;
  return Number.isInteger(1 / speed) ? 1 : 2;
}

/** The same, for `*amount` or `/amount`, where the amount may itself be a pattern of numbers. */
function stretch(amount: unknown, slow: boolean): number {
  if (isNode(amount) && amount.type_ === 'atom') {
    const n = Number(amount.source_);
    return cyclesSeen(slow ? 1 / n : n);
  }
  return weigh(amount) * (Math.ceil(slow ? 1 / smallest(amount) : largest(amount)) + 1);
}

/** The most one step of a sequence holds; `<a b>` and `{a b}` play a step at a time. */
function heaviestStep(node: unknown): number {
  if (!isNode(node) || node.type_ !== 'pattern' || !Array.isArray(node.source_)) return weigh(node);
  const alignment = node.arguments_?.alignment;
  if (alignment !== undefined && alignment !== 'fastcat') return weigh(node) * 2;
  const heaviest = Math.max(1, ...node.source_.map(weigh));
  const weights = node.source_.map((el) => (isNode(el) && typeof el.options_?.weight === 'number' ? el.options_.weight : 1));
  // Steps a whole number long line up with the cycle. Shorter or uneven ones
  // let one cycle catch several of them.
  if (weights.every((w) => Number.isInteger(w) && w >= 1)) return heaviest;
  return heaviest * (Math.ceil(1 / Math.min(1, ...weights.filter((w) => w > 0))) + 1);
}

/**
 * An upper bound on the notes in one cycle, read off the parsed pattern
 * without playing it. `hh*1000000` is refused here; asking Strudel for its
 * notes would be the very work it is refused for.
 */
function weigh(node: unknown): number {
  if (!isNode(node)) return 1;
  switch (node.type_) {
    case 'element': {
      let n = weigh(node.source_);
      for (const op of node.options_?.ops ?? []) {
        const a = op.arguments_ ?? {};
        if (op.type_ === 'stretch') n *= stretch(a.amount, a.type !== 'fast');
        else if (op.type_ === 'replicate') n *= Math.ceil(largest(a.amount));
        else if (op.type_ === 'bjorklund') n *= Math.ceil(largest(a.step)) * weigh(a.pulse) * weigh(a.step) * weigh(a.rotation);
        else if (op.type_ === 'tail') n *= weigh(a.element);
        else if (op.type_ === 'range') n *= (largest(node.source_) + largest(a.element) + 1) * weigh(a.element);
      }
      return Math.min(BIG, n);
    }
    case 'pattern': {
      const kids = Array.isArray(node.source_) ? node.source_ : [];
      const alignment = node.arguments_?.alignment;
      let n: number;
      if (alignment === 'rand') n = Math.max(1, ...kids.map(weigh));
      else if (alignment === 'polymeter_slowcat') n = kids.reduce((sum, kid) => sum + heaviestStep(kid), 0);
      else if (alignment === 'polymeter') {
        const per = node.arguments_?.stepsPerCycle;
        const first = kids[0];
        const steps = per ? (Math.ceil(largest(per)) + 1) * weigh(per) : isNode(first) && Array.isArray(first.source_) ? first.source_.length + 1 : 2;
        n = kids.reduce((sum, kid) => sum + heaviestStep(kid) * steps, 0);
      } else n = kids.reduce((sum, kid) => sum + weigh(kid), 0);
      return Math.min(BIG, n);
    }
    case 'stretch':
      return Math.min(BIG, weigh(node.source_) * stretch(node.arguments_?.amount, true));
    default:
      return 1;
  }
}

function noteOf(value: unknown): Pick<PatternNote, 'kind' | 'degree'> | null {
  const [head, tail] = Array.isArray(value) ? value : [value];
  const clamp = (n: number) => Math.round(Math.min(MAX_DEGREE, Math.max(-MAX_DEGREE, n)));
  if (typeof head === 'number') return Number.isFinite(head) ? { kind: null, degree: clamp(head) } : null;
  if (typeof head !== 'string' || !soundNamed(head)) return null;
  return { kind: null, degree: typeof tail === 'number' && Number.isFinite(tail) ? clamp(tail) : 0 };
}

/** The most notes one pass of `source` could hold; Infinity if it doesn't parse. */
export function noteBound(source: string): number {
  try {
    return weigh(parse(`"${source}"`));
  } catch {
    return Infinity;
  }
}

const SCALE_ALIASES: Record<string, string> = {
  major: 'major',
  minor: 'minor-penta',
  penta: 'major-penta',
  pentatonic: 'major-penta',
  rast: 'rast',
  bayati: 'bayati',
};

/** A scale named the way a pattern may write it: an id, an alias, or its full name. */
export function scaleNamed(word: string): string | null {
  const needle = word.trim().toLowerCase();
  if (SCALE_ALIASES[needle]) return SCALE_ALIASES[needle];
  const found = SCALES.find((scale) => scale.id === needle || scale.name.toLowerCase() === needle);
  return found ? scaleById(found.id).id : null;
}

export interface PatternHead {
  scaleId?: string;
  octave: number;
  sound?: InstrumentId;
  /** The mini-notation, once scale, octave and sound have been taken off the front. */
  mini: string;
  /** How many characters of `source` the header used. */
  cut: number;
  error: string | null;
}

/** `scale minor octave -1 sound piano` may lead the pattern. The rest is mini-notation. */
export function readPatternHead(source: string): PatternHead {
  let rest = source;
  let cut = 0;
  let scaleId: string | undefined;
  let octave = 0;
  let sound: InstrumentId | undefined;
  let error: string | null = null;
  for (;;) {
    const scale = /^scale\s+(\S+)\s*/i.exec(rest);
    if (scale) {
      const id = scaleNamed(scale[1]);
      if (!id) error = `"${scale[1]}" isn't a scale. Try major, minor, penta, rast or bayati.`;
      else scaleId = id;
      cut += scale[0].length;
      rest = source.slice(cut);
      continue;
    }
    const oct = /^octave\s+(-?\d+)\s*/i.exec(rest);
    if (oct) {
      const n = Number(oct[1]);
      if (n < -8 || n > 8) error = '"octave" needs a whole number from -8 to 8.';
      else octave += n;
      cut += oct[0].length;
      rest = source.slice(cut);
      continue;
    }
    const named = /^sound\s+(\S+)\s*/i.exec(rest);
    if (named) {
      const id = soundNamed(named[1]);
      if (!id) error = `"${named[1]}" isn't an instrument. Use its id, like tone, piano or bd.`;
      else sound = id;
      cut += named[0].length;
      rest = source.slice(cut);
      continue;
    }
    break;
  }
  if (!error && cut > 0 && !rest.trim()) error = 'It needs notes after scale, octave or sound.';
  return { scaleId, octave, sound, mini: rest, cut, error };
}

interface Written {
  from: number;
  to: number;
}

function writtenAt(hap: Hap, cut: number): Written | null {
  const locs = (hap as Hap & { context?: { locations?: { start: number; end: number }[] } }).context?.locations;
  if (!locs?.length) return null;
  let best = locs[0];
  for (const loc of locs) if (loc.end > loc.start && loc.end - loc.start < best.end - best.start) best = loc;
  if (!(best.end > best.start)) return null;
  // Locations count into the quoted mini string, so the opening quote is one character.
  return { from: best.start - 1 + cut, to: best.end - 1 + cut };
}

const SILENT: Pattern['notes'] = () => [];

function failed(source: string, error: string): Pattern {
  return { source, error, notes: SILENT };
}

function build(source: string): Pattern {
  if (!source.trim()) return { source, error: null, notes: SILENT };
  if (source.length > MAX_PATTERN_CHARS) return failed(source, `It's longer than ${MAX_PATTERN_CHARS} characters.`);
  if (source.includes('"')) return failed(source, 'Leave the quotes out: write the pattern on its own.');
  const head = readPatternHead(source);
  if (head.error) return failed(source, head.error);
  const mini = head.mini;

  // Strudel's parser reads the pattern as a quoted string.
  const code = `"${mini}"`;
  let ast: MiniNode;
  let base: StrudelPattern;
  try {
    ast = parse(code);
  } catch (err) {
    const { found, location } = err as { found?: string | null; location?: { start: { offset: number } } };
    const at = location?.start.offset ?? 0;
    if (found === undefined) return failed(source, "It can't be read.");
    if (found === null || at > source.length) return failed(source, 'It stops short: is a bracket still open?');
    return failed(source, `"${found}" at character ${at} doesn't fit there.`);
  }

  for (const word of atoms(ast)) {
    if (isRest(word) || !Number.isNaN(Number(word)) || soundNamed(word)) continue;
    return failed(source, `"${word}" isn't a sound. Use a drum name like bd, sd or hh, an instrument's id, or a number for a scale degree.`);
  }
  if (weigh(ast) > MAX_PATTERN_NOTES) return failed(source, `It's too dense: more than ${MAX_PATTERN_NOTES} notes in one pass.`);

  try {
    base = patternifyAST(ast, code);
  } catch {
    return failed(source, "It can't be read.");
  }

  const shaped = new Map<string, StrudelPattern>();
  const patternFor = ({ fast, rev }: PatternShape) => {
    const key = `${fast}:${rev}`;
    let pattern = shaped.get(key);
    if (!pattern) {
      pattern = fast === 1 ? base : base.fast(fast);
      if (rev) pattern = pattern.rev();
      shaped.set(key, pattern);
    }
    return pattern;
  };

  return {
    source,
    error: null,
    notes(cycle, from = 0, to = 1, shape = AS_WRITTEN) {
      if (!(to > from)) return [];
      const out: PatternNote[] = [];
      try {
        // Strudel rounds the times it is asked for to nearby fractions, so a
        // note right on a window's edge could fall outside both windows that
        // meet there. Ask wide, then cut exactly: each note lands in one window.
        for (const hap of patternFor(shape).queryArc(cycle + from - WIDEN, cycle + to + WIDEN)) {
          if (!hap.whole || !hap.hasOnset()) continue;
          const at = hap.whole.begin.valueOf() - cycle;
          if (at < from || at >= to) continue;
          const note = noteOf(hap.value);
          const where = writtenAt(hap, head.cut);
          if (note) {
            out.push({
              at,
              span: hap.whole.end.valueOf() - cycle - at,
              ...note,
              ...(head.sound ? { kind: head.sound } : {}),
              ...(head.scaleId ? { scaleId: head.scaleId } : {}),
              ...(head.octave ? { octave: head.octave } : {}),
              ...(where ? where : {}),
            });
          }
          if (out.length >= MAX_PATTERN_NOTES * 4) break;
        }
      } catch (err) {
        console.warn('Pattern failed to play', err);
        return [];
      }
      return out.sort((a, b) => a.at - b.at);
    },
  };
}

const cache = new Map<string, Pattern>();

/** Parsed once per text, however many blocks and redraws ask for it. */
export function compilePattern(source: string): Pattern {
  let pattern = cache.get(source);
  if (!pattern) {
    if (cache.size >= 400) cache.clear();
    pattern = build(source);
    cache.set(source, pattern);
  }
  return pattern;
}

/** What the Add bar drops: a short phrase on whatever instrument the block is. */
export const NEW_PATTERN = '0*2 [~ 2] 4';

/** A first pattern for an instrument: degrees if it can step, otherwise hits on its own pitch. */
export function starterPattern(kind: string): string {
  return instrumentById(kind)?.steps ? NEW_PATTERN : '0*2 ~ 0';
}

/** The patterns a new block starts from, and what the reference shows. */
export const PATTERN_REFERENCE: [string, string][] = [
  ['0 2 4', "scale degrees above this block's pitch. Its instrument plays every one."],
  ['bd sd hh', "hits of this block's instrument. A word only marks the step: bd sd hh oh cp, or an instrument's id."],
  ['bd:4', "that hit, four degrees above the block's pitch"],
  ['~', 'a rest'],
  ['[bd sd]', 'squeeze several into one step'],
  ['hh*2', 'twice in its step'],
  ['bd(3,8)', '3 hits spread over 8 steps'],
  ['<0 2 4>', 'one per pulse, in turn'],
  ['[bd,hh]', 'together'],
  ['0@3', 'three steps long'],
  ['hh?', 'half the time'],
  ['scale minor octave -1 sound piano 0 2 4', 'a scale, an octave shift, and an instrument, written in front of the notes'],
];
