import { MAX_BED_CLIPS, MAX_BED_SECONDS, MIN_CLIP_SECONDS, wholeClip, type Bed, type BedClip } from './bed';
import { DEFAULT_GROOVE, type Groove } from './engine/groove';
import { DEFAULT_FX, DEFAULT_MIX, MIN_LEVEL, type Fx, type Mix } from './engine/mixer';
import type { SampleRef } from './engine/samples';
import { MAX_SPAN, MIN_SPAN, spanOf } from './engine/geometry';
import { MAX_PATTERN_CHARS } from './engine/pattern';
import { clampGraph } from './engine/graph';
import { MAX_DELAY } from './engine/script';
import type { BlockKind } from './engine/scheduler';
import { clampPatch, type SynthMachine } from './engine/synth';
import { instrumentById } from './engine/instruments';
import { DEFAULT_SCALE_ID, ROOT_HZ, type Scale } from './engine/tuning';
import { MAX_WAVE_POINTS, type WaveRole } from './engine/wave';
import type { PatternFigure, Piece } from './piece';
import { MAX_TAKE_BEATS, MAX_TAKE_NOTES, MAX_TAKES, type Take, type TakeNote } from './takes';

// Every piece that comes in — from this browser's storage, a file, or a shared
// link — goes through here. Links and files come from anyone, so nothing is
// trusted: wrong types are replaced by defaults, numbers are clamped, unknown
// fields are dropped, links to missing blocks are cut, and sizes are capped so
// a hostile piece can't make the page grind. Pieces saved by earlier versions,
// which lack newer fields, get those fields' defaults the same way.

const LIMITS = { blocks: 2000, links: 4000, regions: 200, waves: 400, scales: 100, machines: 24, notes: 1000, bends: 64, code: 4000, text: 200, id: 100 };
const WAVE_ROLES: WaveRole[] = ['cycle', 'motion'];
const FAR = 1e6;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const text = (v: unknown, max = LIMITS.text, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
function num(v: unknown, min: number, max: number, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
const int = (v: unknown, min: number, max: number, fallback: number) => Math.round(num(v, min, max, fallback));
const id = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= LIMITS.id ? v : null);
const point = (v: unknown) => (isObject(v) ? { x: num(v.x, -FAR, FAR, 0), y: num(v.y, -FAR, FAR, 0) } : null);
/** `roll` is the default, so it is stored by leaving the field off. */
function readFigure(v: unknown): PatternFigure | undefined {
  return v === 'fall' || v === 'spiral' || v === 'wheel' ? v : undefined;
}

/** Keeps the first of each id; anything without a usable one is dropped. */
function unique<T extends { id: string }>(items: (T | null)[]): T[] {
  const seen = new Set<string>();
  return items.filter((item): item is T => !!item && !seen.has(item.id) && !!seen.add(item.id));
}

function readScale(v: unknown): Scale | null {
  if (!isObject(v) || !id(v.id)) return null;
  const cents = list(v.cents, LIMITS.notes).filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  const period = num(v.period, 0, 100000, 0);
  if (!cents.length || period <= 0) return null;
  return { id: v.id as string, name: text(v.name) || (v.id as string), cents, period };
}

function readMix(v: unknown): Mix {
  const m = isObject(v) ? v : {};
  return {
    level: num(m.level, MIN_LEVEL, 6, DEFAULT_MIX.level),
    pan: num(m.pan, -1, 1, DEFAULT_MIX.pan),
    mute: m.mute === true,
  };
}

function readFx(v: unknown): Fx {
  const f = isObject(v) ? v : {};
  return {
    tone: num(f.tone, 0, 1, DEFAULT_FX.tone),
    echo: num(f.echo, 0, 1, DEFAULT_FX.echo),
    echoBeats: num(f.echoBeats, 1 / 16, 4, DEFAULT_FX.echoBeats),
    reverb: num(f.reverb, 0, 1, DEFAULT_FX.reverb),
    drive: num(f.drive, 0, 1, DEFAULT_FX.drive),
    pump: num(f.pump, 0, 1, DEFAULT_FX.pump),
    pumpBeats: num(f.pumpBeats, 1 / 16, 4, DEFAULT_FX.pumpBeats),
  };
}

function readGroove(v: unknown): Groove {
  const g = isObject(v) ? v : {};
  return {
    swing: num(g.swing, 0, 1, DEFAULT_GROOVE.swing),
    swingGrid: g.swingGrid === 0.25 ? 0.25 : 0.5,
    humanize: num(g.humanize, 0, 1, DEFAULT_GROOVE.humanize),
  };
}

/** A performance key: one letter or digit. Anything else would clash with the app's own shortcuts. */
const readKey = (v: unknown) => (typeof v === 'string' && /^[a-z0-9]$/.test(v) ? v : undefined);

/** A synth machine: the patch fields are clamped wholesale by clampPatch (see engine/synth.ts). */
function readMachine(v: unknown): SynthMachine | null {
  if (!isObject(v) || !id(v.id)) return null;
  const name = text(v.name, 40) || 'Synth';
  return {
    id: v.id as string,
    name,
    short: text(v.short, 8) || name.slice(0, 7),
    hint: text(v.hint, LIMITS.text),
    patch: clampPatch(v.patch),
  };
}

function readSample(v: unknown): SampleRef | undefined {
  if (!isObject(v) || typeof v.id !== 'string' || !/^smp-[0-9a-f]{1,64}$/.test(v.id)) return undefined;
  return { id: v.id, name: text(v.name) || 'sample' };
}

function readClip(v: unknown, fileDuration: number): BedClip | null {
  if (!isObject(v) || !id(v.id)) return null;
  const offset = num(v.offset, 0, fileDuration, 0);
  const seconds = Math.min(num(v.seconds, MIN_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, fileDuration - offset), 0), Math.max(0, fileDuration - offset));
  if (!(seconds >= MIN_CLIP_SECONDS)) return null;
  const fadeIn = Math.min(num(v.fadeIn, 0, seconds, 0), seconds);
  return {
    id: v.id as string,
    beat: num(v.beat, 0, 100000, 0),
    offset,
    seconds,
    gain: num(v.gain, 0, 1, 1),
    fadeIn,
    fadeOut: Math.min(num(v.fadeOut, 0, seconds, 0), Math.max(0, seconds - fadeIn)),
    mute: v.mute === true,
  };
}

function readBed(v: unknown): Bed | undefined {
  if (!isObject(v)) return undefined;
  const sample = readSample(v.sample);
  if (!sample) return undefined;
  const duration = num(v.duration, MIN_CLIP_SECONDS, MAX_BED_SECONDS, 0);
  if (!(duration >= MIN_CLIP_SECONDS)) return undefined;
  const clips = Array.isArray(v.clips)
    ? unique(list(v.clips, MAX_BED_CLIPS).map((clip) => readClip(clip, duration)))
    : [wholeClip(duration, 'bed-1')];
  return { sample, duration, level: num(v.level, 0, 1, 0.8), clips };
}

function readTakeNote(v: unknown): TakeNote | null {
  if (!isObject(v)) return null;
  if (typeof v.beat !== 'number' || typeof v.beats !== 'number' || typeof v.degree !== 'number' || typeof v.velocity !== 'number') return null;
  if (![v.beat, v.beats, v.degree, v.velocity].every((n) => Number.isFinite(n))) return null;
  if (v.beats <= 0) return null;
  return {
    beat: num(v.beat, 0, MAX_TAKE_BEATS, 0),
    degree: int(v.degree, -200, 200, 0),
    beats: num(v.beats, 1 / 16, MAX_TAKE_BEATS, 1 / 16),
    velocity: num(v.velocity, 0, 1, 1),
  };
}

/** A recorded performance. Unknown instruments and notes that aren't notes are dropped. */
function readTake(v: unknown, machineIds: ReadonlySet<string>, machineNames: ReadonlyMap<string, string>): Take | null {
  if (!isObject(v) || !id(v.id)) return null;
  const instrument = text(v.instrument, LIMITS.id);
  const known = instrument ? instrumentById(instrument) : undefined;
  if (!known && !machineIds.has(instrument)) return null;
  return {
    id: v.id as string,
    name: text(v.name) || known?.name || machineNames.get(instrument) || 'Take',
    instrument,
    notes: list(v.notes, MAX_TAKE_NOTES).map(readTakeNote).filter((note): note is TakeNote => note !== null),
  };
}

/** A piece from anywhere, made safe to use. Throws if it isn't a piece at all. */
export function readPiece(raw: unknown): Piece {
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.blocks) || !Array.isArray(raw.links)) {
    throw new Error("it isn't a Pulse Canvas piece.");
  }
  const rootHz = num(raw.rootHz, 20, 2000, ROOT_HZ);

  // Machines come first, so blocks, takes and waves can name them.
  const machines = unique(list(raw.machines, LIMITS.machines).map(readMachine));
  const machineIds = new Set(machines.map((machine) => machine.id));
  const machineNames = new Map(machines.map((machine) => [machine.id, machine.name]));

  const blocks = unique(
    list(raw.blocks, LIMITS.blocks).map((v) => {
      if (!isObject(v) || !id(v.id)) return null;
      const kind = String(v.kind ?? '');
      if (v.kind !== 'start' && !instrumentById(kind) && !machineIds.has(kind)) return null;
      const code = text(v.code, LIMITS.code);
      // A start block only sends pulses out, so it can't hold a pattern.
      const pattern = typeof v.pattern === 'string' && v.kind !== 'start' ? v.pattern.slice(0, MAX_PATTERN_CHARS).replace(/\s+/g, ' ') : undefined;
      const figure = pattern !== undefined ? readFigure(v.figure) : undefined;
      const level = pattern !== undefined && typeof v.level === 'number' ? num(v.level, 0, 1, 1) : undefined;
      const tone = pattern !== undefined && typeof v.tone === 'number' ? num(v.tone, 0, 1, 1) : undefined;
      return {
        id: v.id as string,
        x: num(v.x, -FAR, FAR, 0),
        y: num(v.y, -FAR, FAR, 0),
        kind: v.kind as BlockKind,
        degree: int(v.degree, -200, 200, 0),
        every: num(v.every, 0, MAX_DELAY, 0),
        ...(code ? { code } : {}),
        ...(readKey(v.key) ? { key: readKey(v.key) } : {}),
        ...(pattern !== undefined
          ? {
              pattern,
              beats: num(v.beats, MIN_SPAN, MAX_SPAN, spanOf({ pattern })),
              ...(figure ? { figure } : {}),
              ...(level !== undefined && level < 1 ? { level } : {}),
              ...(tone !== undefined && tone < 1 ? { tone } : {}),
            }
          : {}),
      };
    }),
  );
  const blockIds = new Set(blocks.map((b) => b.id));

  const pairs = new Set<string>();
  const links = unique(
    list(raw.links, LIMITS.links).map((v) => {
      if (!isObject(v) || !id(v.id)) return null;
      const { from, to } = v;
      if (typeof from !== 'string' || typeof to !== 'string' || from === to || !blockIds.has(from) || !blockIds.has(to)) return null;
      if (pairs.has(`${from}>${to}`)) return null;
      pairs.add(`${from}>${to}`);
      const bends = list(v.bends, LIMITS.bends).map(point).filter((p) => p !== null);
      const code = text(v.code, LIMITS.code);
      return { id: v.id as string, from, to, ...(bends.length ? { bends } : {}), ...(code ? { code } : {}) };
    }),
  );

  const regions = unique(
    list(raw.regions, LIMITS.regions).map((v) => {
      if (!isObject(v) || !id(v.id)) return null;
      const sample = readSample(v.sample);
      return {
        id: v.id as string,
        x: num(v.x, -FAR, FAR, 0),
        y: num(v.y, -FAR, FAR, 0),
        w: num(v.w, 1, FAR, 400),
        h: num(v.h, 1, FAR, 300),
        name: text(v.name),
        scaleId: text(v.scaleId, LIMITS.id, DEFAULT_SCALE_ID),
        rootHz: num(v.rootHz, 20, 2000, rootHz),
        mix: readMix(v.mix),
        fx: readFx(v.fx),
        groove: readGroove(v.groove),
        ...(sample ? { sample } : {}),
        ...(readKey(v.key) ? { key: readKey(v.key) } : {}),
      };
    }),
  );

  const waves = unique(
    list(raw.waves, LIMITS.waves).map((v) => {
      if (!isObject(v) || !id(v.id) || !WAVE_ROLES.includes(v.role as WaveRole)) return null;
      const points = list(v.points, MAX_WAVE_POINTS).map(point).filter((p) => p !== null);
      if (points.length < 2) return null;
      const instrument = text(v.instrument, LIMITS.id);
      const known = instrument && (instrumentById(instrument) || machineIds.has(instrument)) ? instrument : '';
      return { id: v.id as string, role: v.role as WaveRole, points, ...(known ? { instrument: known } : {}) };
    }),
  );

  const takes = unique(list(raw.takes, MAX_TAKES).map((v) => readTake(v, machineIds, machineNames)));
  const bed = readBed(raw.bed);
  const graph = clampGraph(raw.graph, (kind) => !!instrumentById(kind) || machineIds.has(kind));

  return {
    version: 1,
    bpm: int(raw.bpm, 50, 200, 112),
    snap: raw.snap !== false,
    scaleId: text(raw.scaleId, LIMITS.id, DEFAULT_SCALE_ID),
    rootHz,
    scales: unique(list(raw.scales, LIMITS.scales).map(readScale)),
    machines,
    blocks,
    links,
    regions,
    waves,
    takes,
    graph,
    ...(bed ? { bed } : {}),
  };
}
