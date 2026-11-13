import { DEFAULT_FX, DEFAULT_MIX, MIN_LEVEL, type Fx, type Mix } from './engine/mixer';
import type { SampleRef } from './engine/samples';
import { MAX_DELAY } from './engine/script';
import type { BlockKind } from './engine/scheduler';
import { DEFAULT_SCALE_ID, ROOT_HZ, type Scale } from './engine/tuning';
import type { Piece } from './piece';

// Every piece that comes in — from this browser's storage, a file, or a shared
// link — goes through here. Links and files come from anyone, so nothing is
// trusted: wrong types are replaced by defaults, numbers are clamped, unknown
// fields are dropped, links to missing blocks are cut, and sizes are capped so
// a hostile piece can't make the page grind. Pieces saved by earlier versions,
// which lack newer fields, get those fields' defaults the same way.

const LIMITS = { blocks: 2000, links: 4000, regions: 200, scales: 100, notes: 1000, bends: 64, code: 4000, text: 200, id: 100 };
const KINDS: BlockKind[] = ['start', 'tone', 'pluck', 'bass', 'kick', 'snare', 'hat'];
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
  };
}

function readSample(v: unknown): SampleRef | undefined {
  if (!isObject(v) || typeof v.id !== 'string' || !/^smp-[0-9a-f]{1,64}$/.test(v.id)) return undefined;
  return { id: v.id, name: text(v.name) || 'sample' };
}

/** A piece from anywhere, made safe to use. Throws if it isn't a piece at all. */
export function readPiece(raw: unknown): Piece {
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.blocks) || !Array.isArray(raw.links)) {
    throw new Error("it isn't a Pulse Canvas piece.");
  }
  const rootHz = num(raw.rootHz, 20, 2000, ROOT_HZ);

  const blocks = unique(
    list(raw.blocks, LIMITS.blocks).map((v) => {
      if (!isObject(v) || !id(v.id) || !KINDS.includes(v.kind as BlockKind)) return null;
      const code = text(v.code, LIMITS.code);
      return {
        id: v.id as string,
        x: num(v.x, -FAR, FAR, 0),
        y: num(v.y, -FAR, FAR, 0),
        kind: v.kind as BlockKind,
        degree: int(v.degree, -200, 200, 0),
        every: num(v.every, 0, MAX_DELAY, 0),
        ...(code ? { code } : {}),
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
        ...(sample ? { sample } : {}),
      };
    }),
  );

  return {
    version: 1,
    bpm: int(raw.bpm, 50, 200, 112),
    snap: raw.snap !== false,
    scaleId: text(raw.scaleId, LIMITS.id, DEFAULT_SCALE_ID),
    rootHz,
    scales: unique(list(raw.scales, LIMITS.scales).map(readScale)),
    blocks,
    links,
    regions,
  };
}
