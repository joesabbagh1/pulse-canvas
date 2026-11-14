import { GRID, PARALLEL_OFFSET, PX_PER_BEAT, inPort, linkBeats, linkPath, outPort, portGap, spanOf, type LinkPath, type XY } from './geometry';
import { instrumentById, type InstrumentId } from './instruments';
import { compilePattern, type Pattern, type PatternNote } from './pattern';
import { PASS, compile, run, seededRandom, type Outcome, type Program, type RouteMode, type Target } from './script';
import { scaleById, type Tuning } from './tuning';

// The pulse model: a link is a path pulses travel along, and a block makes its
// sound when a pulse reaches it, then sends a pulse down each outgoing link.
// Code on a block or link can change that for each pulse: drop it, delay it,
// transpose it, or pick which links it goes down (see script.ts).
// A pattern block is a box with a length: a pulse reaching it plays one pass of
// its pattern across that length, and only then goes on down its links.
// This class is pure timing logic in beats. It never touches audio; whoever
// owns it turns each hit into sound via the onHit callback.

export type BlockKind = 'start' | InstrumentId;

/** Plays a scale degree and can step up when a link grows a new block. */
export function isMelodic(kind: BlockKind) {
  return kind !== 'start' && (instrumentById(kind)?.steps ?? false);
}

/** Has a pitch to edit. Drums that can be tuned, like the kick, are pitched without stepping. */
export function hasPitch(kind: BlockKind) {
  return kind !== 'start' && (instrumentById(kind)?.pitched ?? false);
}

/** Its tuning is the one it plays in: its region's, or the canvas's. */
export interface GraphBlock extends Tuning {
  id: string;
  x: number;
  y: number;
  kind: BlockKind;
  degree: number;
  /** Start blocks only: re-emit every N beats; 0 means once. */
  every: number;
  code?: string;
  /** Mini-notation (see pattern.ts). Having one, even empty, makes this a pattern block. */
  pattern?: string;
  /** Pattern blocks only: how long one pass of the pattern lasts. */
  beats?: number;
  /** Name of the per-region bus it plays through; unset is the canvas bus. */
  bus?: string;
  /** Pattern blocks: 0 to 1, how loud the pattern is. Unset is full. */
  level?: number;
  /** Pattern blocks: 0 (dark) to 1 (open), its own low-pass. Unset is open. */
  tone?: number;
}

/** Voices that hold a note for as long as they're told to. Plucks, mallets and drums ring out on their own. */
const HELD_VOICES = new Set(['sustain', 'bow', 'blow', 'tone', 'bass', 'khuur', 'acid']);

/** The block as one note of its pattern plays it, and how long that note lasts. */
export function patternHit(block: GraphBlock, note: PatternNote, span: number): { block: GraphBlock; length: number | null } {
  const kind = note.kind ?? block.kind;
  const scale = note.scaleId ? scaleById(note.scaleId) : block.scale;
  const degree = block.degree + note.degree + (note.octave ?? 0) * Math.max(1, scale.cents.length);
  // A held voice sounds for its step; anything struck or plucked keeps its own length.
  const held = kind !== 'start' && HELD_VOICES.has(instrumentById(kind)?.voice ?? '');
  return { block: { ...block, kind, degree, scale }, length: held ? note.span * span : null };
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  bends?: XY[];
  code?: string;
}

export interface LinkState extends LinkPath {
  id: string;
  source: string;
  target: string;
  beats: number;
  /** How much of each end is hidden under its block, in pixels. */
  gapStart: number;
  gapEnd: number;
}

/** One pass of a pattern block, from the pulse going in to it coming out. */
export interface Run {
  block: string;
  start: number;
  end: number;
  /** Which pass of the pattern this is: the block's pulse count, from 0. */
  cycle: number;
  shift: number;
  velocity: number;
  /** Note length from the block's code; null leaves each note its step. */
  length: number | null;
  fast: number;
  rev: boolean;
  /** Notes before this beat have been sent to onHit. */
  cursor: number;
  hits: number;
}

export interface Pulse {
  id: number;
  link: string;
  depart: number;
  arrive: number;
  /** Scale degrees added to the notes it plays, from transposes on its way. */
  shift: number;
  /** Its arrival has been processed (sound scheduled, successors spawned). */
  handled: boolean;
}

/** What a block's code decided about a pulse it is holding back with a delay. */
/** How a block's note sounds, from its code. */
export interface NoteShape {
  /** 0 to 1, of full loudness. */
  velocity: number;
  /** In beats; null leaves the instrument's own. */
  length: number | null;
  /** A marked note. The acid bass opens its filter; other voices just play. */
  accent?: boolean;
}

export const PLAIN: Readonly<NoteShape> = { velocity: 1, length: null };

interface Release extends NoteShape {
  mute: boolean;
  route: RouteMode;
  fast: number;
  rev: boolean;
  /** Which pulse through the block this is, from 1. */
  count: number;
}

interface Emission {
  block: string;
  beat: number;
  repeating: boolean;
  shift: number;
  /** Set for a delayed pulse: the block already ran its code and only has to sound and send. */
  release?: Release;
  /** Set for a pulse coming out of a pattern block: it only has to go down these links. */
  send?: RouteMode;
}

interface Compiled {
  code: string;
  program: Program;
}

export const MAX_PULSES = 128;
/** Patterns playing at once, and the notes one pass may send. */
export const MAX_RUNS = 32;
export const MAX_RUN_HITS = 512;
// Pulses reaching the same block this close together merge into one hit, which
// keeps branching graphs from multiplying pulses without bound.
const COALESCE_BEATS = 0.02;
const EPS = 1e-6;

function nextMultiple(beat: number, step: number) {
  return Math.ceil((beat + EPS) / step) * step;
}

export class Scheduler {
  pulses: Pulse[] = [];
  /** Pattern passes under way, kept until pruned so they can be drawn. */
  runs: Run[] = [];
  playing = false;
  snap = true;
  /** Beat at which the pulse cap last dropped a pulse. */
  overflowBeat = -Infinity;

  private blocks = new Map<string, GraphBlock>();
  private links = new Map<string, LinkState>();
  private graphLinks: GraphLink[] = [];
  private outgoing = new Map<string, string[]>();
  private emissions: Emission[] = [];
  private lastHit = new Map<string, number>();
  private nextPulseId = 1;
  private blockCode = new Map<string, Compiled>();
  private linkCode = new Map<string, Compiled>();
  /** Each pattern block's pattern: the last one that parsed, so a typo mid-edit doesn't silence it. */
  private patterns = new Map<string, Pattern>();
  /** Pulses through each block and link so far, for "every N:". */
  private blockCounts = new Map<string, number>();
  private linkCounts = new Map<string, number>();
  /** Where each "route cycle" block sends next. */
  private turns = new Map<string, number>();
  private random = seededRandom(0);

  /** `at` is where on the canvas the note is, for a note inside a pattern block. */
  constructor(private onHit: (block: GraphBlock, beat: number, shift: number, shape: NoteShape, at?: XY) => void) {}

  block(id: string) {
    return this.blocks.get(id);
  }

  link(id: string) {
    return this.links.get(id);
  }

  /** Pulses on links, plus those crossing a pattern block. */
  inFlight() {
    let n = 0;
    for (const p of this.pulses) if (!p.handled) n++;
    for (const e of this.emissions) if (e.send) n++;
    return n;
  }

  setGraph(blocks: GraphBlock[], links: GraphLink[], nowBeat: number) {
    const prev = this.blocks;
    this.blocks = new Map(blocks.map((b) => [b.id, b]));
    this.graphLinks = links;
    this.blockCode = this.compileAll(blocks, 'block', this.blockCode);
    this.linkCode = this.compileAll(links, 'link', this.linkCode);
    this.patterns = this.compilePatterns(blocks, this.patterns);
    this.rebuildLinks(nowBeat);
    if (this.playing) this.syncStarts(prev, nowBeat);
  }

  setSnap(snap: boolean, nowBeat: number) {
    if (snap === this.snap) return;
    this.snap = snap;
    this.rebuildLinks(nowBeat);
  }

  /** `seed` fixes the outcome of every "chance"; by default each run differs. */
  start(beat = 0, seed = Math.floor(Math.random() * 2 ** 32)) {
    this.stop();
    this.playing = true;
    this.random = seededRandom(seed);
    for (const b of this.blocks.values()) {
      if (b.kind === 'start') this.emissions.push({ block: b.id, beat, repeating: b.every > 0, shift: 0 });
    }
  }

  stop() {
    this.playing = false;
    this.pulses = [];
    this.runs = [];
    this.emissions = [];
    this.lastHit.clear();
    this.blockCounts.clear();
    this.linkCounts.clear();
    this.turns.clear();
    this.overflowBeat = -Infinity;
  }

  /** Inject a pulse at a block, on the next grid step when snapping. */
  fire(blockId: string, nowBeat: number) {
    if (!this.playing || !this.blocks.has(blockId)) return;
    const beat = this.snap ? nextMultiple(nowBeat, GRID) : nowBeat;
    this.emissions.push({ block: blockId, beat, repeating: false, shift: 0 });
  }

  /** Process every arrival and emission up to `horizon`, in time order. */
  advance(horizon: number) {
    if (!this.playing) return;
    for (let guard = 0; guard < 4096; guard++) {
      let pulse: Pulse | undefined;
      for (const p of this.pulses) {
        if (!p.handled && p.arrive <= horizon && (!pulse || p.arrive < pulse.arrive)) pulse = p;
      }
      let emission: Emission | undefined;
      for (const e of this.emissions) {
        if (e.beat <= horizon && (!emission || e.beat < emission.beat)) emission = e;
      }

      if (emission && (!pulse || emission.beat <= pulse.arrive)) {
        this.emissions.splice(this.emissions.indexOf(emission), 1);
        const block = this.blocks.get(emission.block);
        if (emission.repeating && block?.kind === 'start' && block.every > 0) {
          this.emissions.push({ ...emission, beat: emission.beat + block.every });
        }
        if (emission.send) this.send(emission.block, emission.beat, emission.shift, emission.send);
        else if (emission.release) this.release(emission.block, emission.beat, emission.shift, emission.release);
        else this.arrive(emission.block, emission.beat, emission.shift);
      } else if (pulse) {
        pulse.handled = true;
        this.arrive(this.links.get(pulse.link)!.target, pulse.arrive, pulse.shift);
      } else {
        break;
      }
    }
    this.playRuns(horizon);
  }

  /** Forget pulses and pattern passes that finished before `beat`. */
  prune(beat: number) {
    this.pulses = this.pulses.filter((p) => !p.handled || p.arrive >= beat);
    this.runs = this.runs.filter((r) => r.end >= beat);
  }

  private arrive(blockId: string, beat: number, shift: number) {
    const block = this.blocks.get(blockId);
    if (!block) return;
    const last = this.lastHit.get(blockId);
    if (last !== undefined && Math.abs(beat - last) < COALESCE_BEATS) return;
    this.lastHit.set(blockId, beat);

    const out = this.runCode(this.blockCode, this.blockCounts, blockId);
    if (out.drop) return;
    const count = this.blockCounts.get(blockId) ?? 1;
    const release = { mute: out.mute, route: out.route, velocity: out.velocity, length: out.length, fast: out.fast, rev: out.rev, count };
    shift = (out.shiftTo ?? shift) + out.transpose;
    if (out.delay > 0) {
      this.emissions.push({ block: blockId, beat: beat + out.delay, repeating: false, shift, release });
    } else {
      this.release(blockId, beat, shift, release);
    }
  }

  /**
   * The block sounds, and sends the pulse on down the links its code picked. A
   * pattern block starts a pass of its pattern, and sends the pulse on when
   * that pass ends.
   */
  private release(blockId: string, beat: number, shift: number, release: Release) {
    const block = this.blocks.get(blockId);
    if (!block) return;
    const { mute, route, velocity, length } = release;
    const span = spanOf(block);
    if (!span) {
      if (!mute) this.onHit(block, beat, shift, { velocity, length });
      this.send(blockId, beat, shift, route);
      return;
    }
    if (!mute) {
      if (this.runs.filter((r) => r.cursor < r.end).length >= MAX_RUNS) this.overflowBeat = beat;
      else {
        const { fast, rev, count } = release;
        this.runs.push({ block: blockId, start: beat, end: beat + span, cycle: count - 1, shift, velocity, length, fast, rev, cursor: beat, hits: 0 });
      }
    }
    this.emissions.push({ block: blockId, beat: beat + span, repeating: false, shift, send: route });
  }

  /** Sends every note of every pass under way that starts before `horizon`. */
  private playRuns(horizon: number) {
    for (const run of this.runs) {
      if (run.cursor >= run.end) continue;
      const block = this.blocks.get(run.block);
      const pattern = this.patterns.get(run.block);
      const until = Math.min(horizon, run.end);
      if (!block || !pattern || run.hits >= MAX_RUN_HITS) {
        run.cursor = run.end;
        continue;
      }
      if (until <= run.cursor) continue;
      // The pass keeps the length it started with, even if the box is resized under it.
      const span = run.end - run.start;
      const left = inPort(block, spanOf(block)).x;
      const width = spanOf(block) * PX_PER_BEAT;
      for (const note of pattern.notes(run.cycle, (run.cursor - run.start) / span, (until - run.start) / span, run)) {
        if (run.hits++ >= MAX_RUN_HITS) break;
        const hit = patternHit(block, note, span);
        const shape = { velocity: run.velocity, length: run.length ?? hit.length, ...(note.accent ? { accent: true } : {}) };
        try {
          this.onHit(hit.block, run.start + note.at * span, run.shift, shape, { x: left + note.at * width, y: block.y });
        } catch {
          // One note must not cancel the rest of the pass.
        }
      }
      run.cursor = until;
    }
  }

  /** A pulse leaves the block down the links `route` picks. */
  private send(blockId: string, beat: number, shift: number, route: RouteMode) {
    if (!this.blocks.has(blockId)) return;
    for (const linkId of this.route(blockId, route)) {
      if (this.inFlight() >= MAX_PULSES) {
        this.overflowBeat = beat;
        break;
      }
      const link = this.links.get(linkId)!;
      // A link's delay holds the pulse at its start before it sets off.
      const out = this.runCode(this.linkCode, this.linkCounts, linkId);
      if (out.drop) continue;
      const depart = beat + out.delay;
      this.pulses.push({
        id: this.nextPulseId++,
        link: linkId,
        depart,
        arrive: depart + link.beats,
        shift: (out.shiftTo ?? shift) + out.transpose,
        handled: false,
      });
    }
  }

  private route(blockId: string, mode: RouteMode): string[] {
    const out = this.outgoing.get(blockId) ?? [];
    if (mode === 'all' || out.length <= 1) return out;
    if (mode === 'random') return [out[Math.floor(this.random() * out.length)]];
    const turn = this.turns.get(blockId) ?? 0;
    this.turns.set(blockId, turn + 1);
    return [out[turn % out.length]];
  }

  private runCode(code: Map<string, Compiled>, counts: Map<string, number>, id: string): Outcome {
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    const compiled = code.get(id);
    return compiled ? run(compiled.program, count, this.random) : PASS;
  }

  // Only code that changed since the last graph is compiled again.
  private compileAll(items: { id: string; code?: string }[], target: Target, prev: Map<string, Compiled>) {
    const next = new Map<string, Compiled>();
    for (const { id, code } of items) {
      if (!code?.trim()) continue;
      const old = prev.get(id);
      next.set(id, old?.code === code ? old : { code, program: compile(code, target) });
    }
    return next;
  }

  private compilePatterns(blocks: GraphBlock[], prev: Map<string, Pattern>) {
    const next = new Map<string, Pattern>();
    for (const { id, pattern: source } of blocks) {
      if (source === undefined) continue;
      const pattern = compilePattern(source);
      const old = prev.get(id);
      next.set(id, pattern.error && old && !old.error ? old : pattern);
    }
    return next;
  }

  private rebuildLinks(nowBeat: number) {
    const straight = new Set(this.graphLinks.filter((l) => !l.bends?.length).map((l) => `${l.source}->${l.target}`));
    const next = new Map<string, LinkState>();
    this.outgoing = new Map();
    for (const l of this.graphLinks) {
      const a = this.blocks.get(l.source);
      const b = this.blocks.get(l.target);
      if (!a || !b) continue;
      const [from, to] = [spanOf(a), spanOf(b)];
      const path = linkPath(outPort(a, from), inPort(b, to), l.bends ?? [], straight.has(`${l.target}->${l.source}`) ? PARALLEL_OFFSET : 0);
      const beats = linkBeats(path.len, this.snap);
      next.set(l.id, { ...path, id: l.id, source: l.source, target: l.target, beats, gapStart: portGap(from), gapEnd: portGap(to) });
      const out = this.outgoing.get(l.source);
      if (out) out.push(l.id);
      else this.outgoing.set(l.source, [l.id]);
    }

    const prev = this.links;
    this.links = next;
    this.pulses = this.pulses.filter((p) => {
      const link = next.get(p.link);
      if (!link) return false;
      if (!p.handled && link.beats !== prev.get(p.link)?.beats) this.retime(p, link.beats, nowBeat);
      return true;
    });
  }

  // A link changed length under a pulse in flight. The pulse keeps its
  // fractional progress and finishes the rest at the new length, which is what
  // makes dragging a block or a bend audibly bend the rhythm.
  private retime(p: Pulse, beats: number, nowBeat: number) {
    if (nowBeat <= p.depart) {
      p.arrive = p.depart + beats;
      return;
    }
    const progress = (nowBeat - p.depart) / (p.arrive - p.depart);
    let arrive = nowBeat + (1 - progress) * beats;
    if (this.snap) {
      arrive = Math.round(arrive / GRID) * GRID;
      if (arrive < nowBeat) arrive += GRID;
    }
    p.arrive = arrive;
    p.depart = arrive - beats;
  }

  // Start blocks added, removed or re-timed while playing.
  private syncStarts(prev: Map<string, GraphBlock>, nowBeat: number) {
    this.emissions = this.emissions.filter((e) => {
      const block = this.blocks.get(e.block);
      return block && (!e.repeating || block.kind === 'start');
    });
    for (const b of this.blocks.values()) {
      if (b.kind !== 'start') continue;
      const old = prev.get(b.id);
      const wasStart = old?.kind === 'start';
      if (wasStart && old.every === b.every) continue;
      this.emissions = this.emissions.filter((e) => !(e.block === b.id && e.repeating));
      if (b.every > 0) {
        this.emissions.push({ block: b.id, beat: nextMultiple(nowBeat, b.every), repeating: true, shift: 0 });
      } else if (!wasStart) {
        this.emissions.push({ block: b.id, beat: nextMultiple(nowBeat, 1), repeating: false, shift: 0 });
      }
    }
  }
}
