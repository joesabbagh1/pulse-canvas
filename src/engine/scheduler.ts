import { GRID, PARALLEL_OFFSET, linkBeats, linkPath, type LinkPath, type XY } from './geometry';
import { PASS, compile, run, seededRandom, type Outcome, type Program, type RouteMode, type Target } from './script';
import type { Tuning } from './tuning';

// The pulse model: a link is a path pulses travel along, and a block makes its
// sound when a pulse reaches it, then sends a pulse down each outgoing link.
// Code on a block or link can change that for each pulse: drop it, delay it,
// transpose it, or pick which links it goes down (see script.ts).
// This class is pure timing logic in beats. It never touches audio; whoever
// owns it turns each hit into sound via the onHit callback.

export type BlockKind = 'start' | 'tone' | 'pluck' | 'bass' | 'kick' | 'snare' | 'hat';

/** Plays a scale degree and can step up when a link grows a new block. */
export function isMelodic(kind: BlockKind) {
  return kind === 'tone' || kind === 'pluck' || kind === 'bass';
}

/** Has a pitch to edit: the melodic voices, and the kick (its pitch is the drum's). */
export function hasPitch(kind: BlockKind) {
  return isMelodic(kind) || kind === 'kick';
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
  /** Name of the per-region bus it plays through; unset is the canvas bus. */
  bus?: string;
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
}

export const PLAIN: Readonly<NoteShape> = { velocity: 1, length: null };

interface Release extends NoteShape {
  mute: boolean;
  route: RouteMode;
}

interface Emission {
  block: string;
  beat: number;
  repeating: boolean;
  shift: number;
  /** Set for a delayed pulse: the block already ran its code and only has to sound and send. */
  release?: Release;
}

interface Compiled {
  code: string;
  program: Program;
}

export const MAX_PULSES = 128;
// Pulses reaching the same block this close together merge into one hit, which
// keeps branching graphs from multiplying pulses without bound.
const COALESCE_BEATS = 0.02;
const EPS = 1e-6;

function nextMultiple(beat: number, step: number) {
  return Math.ceil((beat + EPS) / step) * step;
}

export class Scheduler {
  pulses: Pulse[] = [];
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
  /** Pulses through each block and link so far, for "every N:". */
  private blockCounts = new Map<string, number>();
  private linkCounts = new Map<string, number>();
  /** Where each "route cycle" block sends next. */
  private turns = new Map<string, number>();
  private random = seededRandom(0);

  constructor(private onHit: (block: GraphBlock, beat: number, shift: number, shape: NoteShape) => void) {}

  block(id: string) {
    return this.blocks.get(id);
  }

  link(id: string) {
    return this.links.get(id);
  }

  inFlight() {
    let n = 0;
    for (const p of this.pulses) if (!p.handled) n++;
    return n;
  }

  setGraph(blocks: GraphBlock[], links: GraphLink[], nowBeat: number) {
    const prev = this.blocks;
    this.blocks = new Map(blocks.map((b) => [b.id, b]));
    this.graphLinks = links;
    this.blockCode = this.compileAll(blocks, 'block', this.blockCode);
    this.linkCode = this.compileAll(links, 'link', this.linkCode);
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
        if (emission.release) this.release(emission.block, emission.beat, emission.shift, emission.release);
        else this.arrive(emission.block, emission.beat, emission.shift);
      } else if (pulse) {
        pulse.handled = true;
        this.arrive(this.links.get(pulse.link)!.target, pulse.arrive, pulse.shift);
      } else {
        break;
      }
    }
  }

  /** Forget pulses that finished arriving before `beat`. */
  prune(beat: number) {
    this.pulses = this.pulses.filter((p) => !p.handled || p.arrive >= beat);
  }

  private arrive(blockId: string, beat: number, shift: number) {
    const block = this.blocks.get(blockId);
    if (!block) return;
    const last = this.lastHit.get(blockId);
    if (last !== undefined && Math.abs(beat - last) < COALESCE_BEATS) return;
    this.lastHit.set(blockId, beat);

    const out = this.runCode(this.blockCode, this.blockCounts, blockId);
    if (out.drop) return;
    const release = { mute: out.mute, route: out.route, velocity: out.velocity, length: out.length };
    shift = (out.shiftTo ?? shift) + out.transpose;
    if (out.delay > 0) {
      this.emissions.push({ block: blockId, beat: beat + out.delay, repeating: false, shift, release });
    } else {
      this.release(blockId, beat, shift, release);
    }
  }

  /** The block sounds, and sends the pulse on down the links its code picked. */
  private release(blockId: string, beat: number, shift: number, { mute, route, velocity, length }: Release) {
    const block = this.blocks.get(blockId);
    if (!block) return;
    if (!mute) this.onHit(block, beat, shift, { velocity, length });

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

  private rebuildLinks(nowBeat: number) {
    const straight = new Set(this.graphLinks.filter((l) => !l.bends?.length).map((l) => `${l.source}->${l.target}`));
    const next = new Map<string, LinkState>();
    this.outgoing = new Map();
    for (const l of this.graphLinks) {
      const a = this.blocks.get(l.source);
      const b = this.blocks.get(l.target);
      if (!a || !b) continue;
      const path = linkPath(a, b, l.bends ?? [], straight.has(`${l.target}->${l.source}`) ? PARALLEL_OFFSET : 0);
      next.set(l.id, { ...path, id: l.id, source: l.source, target: l.target, beats: linkBeats(path.len, this.snap) });
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
