// Building the piece: blocks, links, regions, tuning and waves. The same
// limits as a saved piece, so a deck edit can't put the canvas somewhere the
// file format would refuse.

import { PX_PER_BEAT, spanOf } from '../engine/geometry';
import { INSTRUMENTS, instrumentById, isInstrumentId } from '../engine/instruments';
import { MAX_PATTERN_CHARS, NEW_PATTERN, compilePattern } from '../engine/pattern';
import { MAX_DELAY, compile } from '../engine/script';
import { DEFAULT_SCALE_ID, KEYS, ROOT_HZ, SCALES } from '../engine/tuning';
import { stampOf, type Stamp } from '../engine/wave';
import { MIN_REGION } from '../regions';
import type { DeckEffect, DeckPlan } from './effects';
import { findBlocks, findRegions } from './plan';
import {
  beatCount,
  blockName,
  renderScene,
  type DeckBlock,
  type DeckInput,
  type DeckLink,
  type DeckRegion,
  type DeckWave,
} from './scene';

const MAX_BLOCKS = 2000;
const MAX_LINKS = 4000;
const MAX_REGIONS = 200;
const MAX_WAVES = 400;
const MAX_CODE = 4000;
const MAX_PATTERN = MAX_PATTERN_CHARS;
const FAR = 1e6;

const norm = (value: string) => value.trim().toLowerCase();

let seq = 0;

function freshId(prefix: string, taken: Iterable<string>) {
  const have = new Set(taken);
  let id = '';
  do {
    seq += 1;
    id = `${prefix}${seq}`;
  } while (have.has(id));
  return id;
}

function done(input: DeckInput, effects: DeckEffect[], lead: string): DeckPlan {
  return { effects, text: `${lead}\n\n${renderScene(input)}` };
}

function num(value: unknown, label: string, min: number, max: number): number | string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} needs a number.`;
  if (value < min || value > max) return `${label} is from ${min} to ${max}.`;
  return value;
}

function px(beats: number) {
  return Math.min(FAR, Math.max(-FAR, beats * PX_PER_BEAT));
}

function scalesOf(input: DeckInput) {
  return input.scales?.length ? input.scales : SCALES.map((scale) => ({ id: scale.id, name: scale.name }));
}

export function resolveKind(ref: string): { id: string } | { error: string } {
  const query = norm(ref);
  if (!query) return { error: 'Say which instrument, or start.' };
  if (query === 'start') return { id: 'start' };
  if (query === 'pattern') return { id: 'pattern' };
  if (isInstrumentId(query)) return { id: query };
  const exact = INSTRUMENTS.filter((instrument) => norm(instrument.name) === query || (instrument.short !== '' && norm(instrument.short) === query));
  if (exact.length === 1) return { id: exact[0].id };
  const partial = INSTRUMENTS.filter((instrument) => norm(instrument.name).includes(query) || instrument.id.includes(query));
  if (partial.length === 1) return { id: partial[0].id };
  if (partial.length > 1) {
    const list = partial
      .slice(0, 8)
      .map((instrument) => `${instrument.name} (${instrument.id})`)
      .join(', ');
    return { error: `"${ref}" matches ${list}. Say the id.` };
  }
  return { error: `No instrument called "${ref}". catalog lists them.` };
}

function resolveScale(input: DeckInput, ref: string): { id: string; name: string } | { error: string } {
  const query = norm(ref);
  const scales = scalesOf(input);
  const exact = scales.filter((scale) => scale.id === ref || norm(scale.id) === query || norm(scale.name) === query);
  if (exact.length === 1) return exact[0];
  const partial = scales.filter((scale) => norm(scale.name).includes(query) || norm(scale.id).includes(query));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) return { error: `"${ref}" matches ${partial.map((scale) => scale.name).join(', ')}. Say the id.` };
  return { error: `No scale called "${ref}". Scales: ${scales.map((scale) => scale.name).join(', ')}.` };
}

function resolveRoot(value: unknown): number | string {
  if (typeof value === 'number') return num(value, 'Root', 20, 2000);
  if (typeof value !== 'string' || !value.trim()) return 'Root is a note name, like D, or a frequency in Hz.';
  const query = value.trim().toLowerCase().replace('♯', '#').replace('♭', 'b');
  const key = KEYS.find((item) => item.name.toLowerCase().replace('♯', '#').replace('♭', 'b') === query);
  if (!key) return `No key called "${value}". Use one of ${KEYS.map((item) => item.name).join(' ')}, or a frequency.`;
  return key.hz;
}

function oneBlock(input: DeckInput, ref: string): DeckBlock | string {
  const found = findBlocks(input, ref);
  if (found.length === 1) return found[0];
  if (found.length > 1) return `"${ref}" matches ${found.map((block) => `${blockName(block.kind)} (${block.id})`).join(' and ')}. Say which id.`;
  return `No block called "${ref}".`;
}

function oneRegion(input: DeckInput, ref: string): DeckRegion | string {
  const found = findRegions(input, ref);
  if (found.length === 1) return found[0];
  if (found.length > 1) return `"${ref}" matches ${found.map((region) => `${region.name} (${region.id})`).join(' and ')}. Say which id.`;
  return `No region called "${ref}".`;
}

function keysTaken(input: DeckInput, except?: string) {
  const taken = new Map<string, string>();
  for (const block of input.blocks) if (block.key && block.id !== except) taken.set(block.key, `${blockName(block.kind)} (${block.id})`);
  for (const region of input.regions) if (region.key && region.id !== except) taken.set(region.key, `${region.name} (${region.id})`);
  return taken;
}

function readKey(value: unknown, taken: Map<string, string>): { key: string | null } | { error: string } {
  if (value === null || value === '') return { key: null };
  if (typeof value !== 'string' || !/^[a-z0-9]$/i.test(value)) return { error: 'A performance key is one letter or digit.' };
  const key = value.toLowerCase();
  const owner = taken.get(key);
  if (owner) return { error: `${key.toUpperCase()} already belongs to ${owner}.` };
  return { key };
}

function readCode(value: unknown, target: 'block' | 'link'): { code: string | null } | { error: string } {
  if (value === null || value === '') return { code: null };
  if (typeof value !== 'string') return { error: 'Code is text.' };
  if (value.length > MAX_CODE) return { error: `Code is limited to ${MAX_CODE} characters.` };
  const program = compile(value, target);
  if (program.errors.length) return { error: program.errors.map((error) => `Line ${error.line}: ${error.message}`).join(' ') };
  return { code: value };
}

function blankMix(): DeckRegion['mix'] {
  return { level: 0, pan: 0, mute: false };
}

function blankFx(): DeckRegion['fx'] {
  return { tone: 1, echo: 0, echoBeats: 0.75, reverb: 0.25, drive: 0, pump: 0, pumpBeats: 0.5 };
}

function blankGroove(): DeckRegion['groove'] {
  return { swing: 0, swingGrid: 0.5, humanize: 0 };
}

function catalog(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  const scales = scalesOf(input);
  const scaleLine = `Scales: ${scales.map((scale) => `${scale.name} (${scale.id})`).join(', ')}.`;
  const query = typeof command.query === 'string' ? norm(command.query) : '';
  if (!query) {
    return {
      effects: [],
      text: `${scaleLine}\n${INSTRUMENTS.length} instruments. Pass a query, like piano, drum or flute. start sends pulses. pattern adds a tone box.`,
    };
  }
  const found = INSTRUMENTS.filter(
    (instrument) => norm(instrument.name).includes(query) || instrument.id.includes(query) || (instrument.short !== '' && norm(instrument.short).includes(query)),
  ).slice(0, 40);
  if (!found.length) return { effects: [], text: `Nothing matches "${command.query}". ${scaleLine}` };
  const lines = found.map((instrument) => `${instrument.id} — ${instrument.name}`);
  return { effects: [], text: `${lines.join('\n')}\n\n${scaleLine}` };
}

function addBlock(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (input.blocks.length >= MAX_BLOCKS) return { error: `${MAX_BLOCKS} blocks is the limit.` };
  if (typeof command.kind !== 'string') return { error: 'Say the kind: start, pattern, or an instrument id or name.' };
  const kind = resolveKind(command.kind);
  if ('error' in kind) return { error: kind.error };
  const from = typeof command.from === 'string' && command.from.trim() ? oneBlock(input, command.from) : undefined;
  if (typeof from === 'string') return { error: from };

  let resolved = kind.id;
  let pattern = typeof command.pattern === 'string' ? command.pattern : undefined;
  if (resolved === 'pattern') {
    resolved = 'tone';
    pattern = pattern ?? NEW_PATTERN;
  }
  if (pattern !== undefined && resolved === 'start') return { error: 'A start block only sends pulses. It cannot hold a pattern.' };
  if (pattern !== undefined) {
    if (pattern.length > MAX_PATTERN) return { error: `A pattern is limited to ${MAX_PATTERN} characters.` };
    const compiled = compilePattern(pattern);
    if (compiled.error) return { error: compiled.error };
  }

  const degree = command.degree === undefined ? (from && instrumentById(from.kind)?.steps ? from.degree + 1 : 0) : num(command.degree, 'Degree', -200, 200);
  if (typeof degree === 'string') return { error: degree };
  const every = command.every === undefined ? 0 : num(command.every, 'Every', 0, MAX_DELAY);
  if (typeof every === 'string') return { error: every };
  if (every !== 0 && resolved !== 'start') return { error: 'every is for start blocks: how often they fire, in beats. 0 fires once when play starts.' };

  const beats = pattern === undefined ? undefined : command.beats === undefined ? spanOf({ pattern }) : num(command.beats, 'Length', 0.25, 32);
  if (typeof beats === 'string') return { error: beats };
  const figure = command.figure;
  if (figure !== undefined && figure !== 'roll' && figure !== 'fall' && figure !== 'spiral' && figure !== 'wheel') {
    return { error: 'A pattern figure is roll, fall, spiral or wheel.' };
  }
  if (figure && figure !== 'roll' && pattern === undefined) return { error: 'A figure is for a pattern block.' };

  const level = command.level === undefined ? undefined : num(command.level, 'Level', 0, 1);
  if (typeof level === 'string') return { error: level };
  const tone = command.tone === undefined ? undefined : num(command.tone, 'Tone', 0, 1);
  if (typeof tone === 'string') return { error: tone };
  if ((level !== undefined || tone !== undefined) && pattern === undefined) return { error: 'Level and tone on a block belong to a pattern box.' };

  const written = command.code === undefined ? undefined : readCode(command.code, 'block');
  if (written && 'error' in written) return { error: written.error };
  const keyValue = command.key === undefined ? undefined : readKey(command.key, keysTaken(input));
  if (keyValue && 'error' in keyValue) return { error: keyValue.error };
  if (keyValue && keyValue.key && resolved !== 'start') return { error: 'A performance key on a block fires a start block. Regions use a key to mute.' };

  let x: number;
  let y: number;
  if (command.x === undefined && command.y === undefined) {
    const spot = from ? { x: from.x + PX_PER_BEAT * 1.5, y: from.y } : defaultSpot(input);
    x = spot.x;
    y = spot.y;
  } else {
    const bx = num(command.x ?? 0, 'x', -4000, 4000);
    if (typeof bx === 'string') return { error: bx };
    const by = num(command.y ?? 0, 'y', -4000, 4000);
    if (typeof by === 'string') return { error: by };
    x = px(bx);
    y = px(by);
  }

  const block: DeckBlock = {
    id: freshId('b', input.blocks.map((item) => item.id)),
    kind: resolved,
    degree: Math.round(degree),
    every: resolved === 'start' ? every : 0,
    x,
    y,
    ...(keyValue?.key ? { key: keyValue.key } : {}),
    ...(written?.code ? { code: written.code } : {}),
    ...(pattern !== undefined
      ? {
          pattern,
          beats,
          ...(figure && figure !== 'roll' ? { figure } : {}),
          ...(typeof level === 'number' && level < 1 ? { level } : {}),
          ...(typeof tone === 'number' && tone < 1 ? { tone } : {}),
        }
      : {}),
  };

  const blocks = [...input.blocks, block];
  let links = input.links;
  const effects: DeckEffect[] = [{ type: 'addBlock', block }];
  let lead = `Added ${blockName(block.kind)} (${block.id}) at ${trimBeat(x / PX_PER_BEAT)}, ${trimBeat(y / PX_PER_BEAT)}.`;
  if (from) {
    if (links.length >= MAX_LINKS) return { error: `${MAX_LINKS} links is the limit.` };
    const link: DeckLink = { id: freshId('l', links.map((item) => item.id)), from: from.id, to: block.id, bends: [] };
    links = [...links, link];
    effects.push({ type: 'addLink', link });
    lead += ` Linked from ${blockName(from.kind)}.`;
  }
  return done({ ...input, blocks, links }, effects, lead);
}

function defaultSpot(input: DeckInput) {
  if (!input.blocks.length) return { x: 0, y: 0 };
  return { x: Math.max(...input.blocks.map((block) => block.x)) + PX_PER_BEAT * 1.5, y: 0 };
}

function editBlock(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.block !== 'string' || !command.block.trim()) return { error: 'Say which block to edit.' };
  const block = oneBlock(input, command.block);
  if (typeof block === 'string') return { error: block };
  const next: DeckBlock = { ...block };
  const notes: string[] = [];

  if (command.kind !== undefined) {
    if (typeof command.kind !== 'string') return { error: 'Kind is an instrument id or name, or start.' };
    const kind = resolveKind(command.kind);
    if ('error' in kind) return { error: kind.error };
    if (kind.id === 'pattern') return { error: 'To make a pattern box, set pattern. kind pattern is only for a new block.' };
    next.kind = kind.id;
    if (next.kind === 'start') {
      delete next.pattern;
      delete next.beats;
      delete next.figure;
      delete next.level;
      delete next.tone;
    } else next.every = 0;
    notes.push(blockName(next.kind));
  }
  if (command.degree !== undefined) {
    const degree = num(command.degree, 'Degree', -200, 200);
    if (typeof degree === 'string') return { error: degree };
    next.degree = Math.round(degree);
    notes.push(`degree ${next.degree}`);
  }
  if (command.every !== undefined) {
    const every = num(command.every, 'Every', 0, MAX_DELAY);
    if (typeof every === 'string') return { error: every };
    if (next.kind !== 'start') return { error: 'every is for start blocks.' };
    next.every = every;
    notes.push(every === 0 ? 'fires once' : `every ${beatCount(every)}`);
  }
  if (command.clearPattern) {
    delete next.pattern;
    delete next.beats;
    delete next.figure;
    delete next.level;
    delete next.tone;
    notes.push('no longer a pattern');
  }
  if (command.pattern !== undefined && !command.clearPattern) {
    if (typeof command.pattern !== 'string') return { error: 'Pattern is text.' };
    if (next.kind === 'start') return { error: 'A start block cannot hold a pattern.' };
    if (command.pattern.length > MAX_PATTERN) return { error: `A pattern is limited to ${MAX_PATTERN} characters.` };
    const compiled = compilePattern(command.pattern);
    if (compiled.error) return { error: compiled.error };
    const had = next.pattern !== undefined;
    next.pattern = command.pattern;
    if (!had) next.beats = spanOf({ pattern: command.pattern });
    notes.push('pattern set');
  }
  if (command.beats !== undefined && next.pattern !== undefined) {
    const beats = num(command.beats, 'Length', 0.25, 32);
    if (typeof beats === 'string') return { error: beats };
    const left = next.x - (spanOf(block) * PX_PER_BEAT) / 2;
    next.beats = beats;
    next.x = left + (spanOf(next) * PX_PER_BEAT) / 2;
    notes.push(`${beatCount(beats)} long`);
  } else if (command.beats !== undefined) return { error: 'Length is for a pattern block. Set a pattern first.' };
  if (command.figure !== undefined) {
    const figure = command.figure;
    if (figure !== 'roll' && figure !== 'fall' && figure !== 'spiral' && figure !== 'wheel') return { error: 'A pattern figure is roll, fall, spiral or wheel.' };
    if (next.pattern === undefined) return { error: 'A figure is for a pattern block.' };
    if (figure === 'roll') delete next.figure;
    else next.figure = figure;
    notes.push(String(figure));
  }
  if (command.level !== undefined) {
    const level = num(command.level, 'Level', 0, 1);
    if (typeof level === 'string') return { error: level };
    if (next.pattern === undefined) return { error: 'Level on a block belongs to a pattern box.' };
    if (level >= 1) delete next.level;
    else next.level = Math.round(level * 100) / 100;
    notes.push('level set');
  }
  if (command.tone !== undefined) {
    const tone = num(command.tone, 'Tone', 0, 1);
    if (typeof tone === 'string') return { error: tone };
    if (next.pattern === undefined) return { error: 'Tone on a block belongs to a pattern box.' };
    if (tone >= 1) delete next.tone;
    else next.tone = Math.round(tone * 100) / 100;
    notes.push('tone set');
  }
  if (command.clearCode || command.code === '') delete next.code;
  else if (command.code !== undefined) {
    const code = readCode(command.code, 'block');
    if ('error' in code) return { error: code.error };
    if (code.code) next.code = code.code;
    else delete next.code;
    notes.push('code set');
  }
  if (command.clearKey || command.key === '') {
    delete next.key;
    notes.push('key cleared');
  } else if (command.key !== undefined) {
    const key = readKey(command.key, keysTaken(input, block.id));
    if ('error' in key) return { error: key.error };
    if (!key.key) delete next.key;
    else if (next.kind !== 'start') return { error: 'A performance key on a block fires a start block.' };
    else {
      next.key = key.key;
      notes.push(`key ${key.key.toUpperCase()}`);
    }
  }
  if (command.x !== undefined || command.y !== undefined) {
    const bx = command.x === undefined ? next.x / PX_PER_BEAT : num(command.x, 'x', -4000, 4000);
    if (typeof bx === 'string') return { error: bx };
    const by = command.y === undefined ? next.y / PX_PER_BEAT : num(command.y, 'y', -4000, 4000);
    if (typeof by === 'string') return { error: by };
    next.x = px(bx);
    next.y = px(by);
    notes.push(`at ${trimBeat(bx)}, ${trimBeat(by)}`);
  }
  if (!notes.length) return { error: 'Say what to change on the block.' };
  const blocks = input.blocks.map((item) => (item.id === block.id ? next : item));
  return done({ ...input, blocks }, [{ type: 'putBlock', block: next }], `${blockName(block.kind)} (${block.id}): ${notes.join(', ')}.`);
}

function trimBeat(beats: number) {
  return String(Math.round(beats * 100) / 100);
}

function linkBlocks(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (input.links.length >= MAX_LINKS) return { error: `${MAX_LINKS} links is the limit.` };
  if (typeof command.from !== 'string' || typeof command.to !== 'string') return { error: 'Say the block a link leaves, and the block it arrives at.' };
  const from = oneBlock(input, command.from);
  if (typeof from === 'string') return { error: from };
  const to = oneBlock(input, command.to);
  if (typeof to === 'string') return { error: to };
  if (from.id === to.id) return { error: 'A link needs two different blocks.' };
  if (input.links.some((link) => link.from === from.id && link.to === to.id)) {
    return { error: `${blockName(from.kind)} already links to ${blockName(to.kind)}.` };
  }
  const written = command.code === undefined ? undefined : readCode(command.code, 'link');
  if (written && 'error' in written) return { error: written.error };
  const link: DeckLink = {
    id: freshId('l', input.links.map((item) => item.id)),
    from: from.id,
    to: to.id,
    bends: [],
    ...(written?.code ? { code: written.code } : {}),
  };
  return done(
    { ...input, links: [...input.links, link] },
    [{ type: 'addLink', link }],
    `Linked ${blockName(from.kind)} to ${blockName(to.kind)} (${link.id}).`,
  );
}

function linksBetween(input: DeckInput, ref: string): DeckLink[] | string {
  const query = norm(ref);
  const byId = input.links.filter((link) => link.id === ref || norm(link.id) === query);
  if (byId.length) return byId;
  const parts = ref
    .split(/\s*(?:→|->|>| to )\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) return [];
  const from = oneBlock(input, parts[0]);
  const to = oneBlock(input, parts[1]);
  if (typeof from === 'string') return from;
  if (typeof to === 'string') return to;
  return input.links.filter((link) => link.from === from.id && link.to === to.id);
}

function editLink(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.link !== 'string' || !command.link.trim()) return { error: 'Say which link to edit.' };
  const links = linksBetween(input, command.link);
  if (typeof links === 'string') return { error: links };
  if (!links.length) return { error: `No link called "${command.link}".` };
  if (links.length > 1) return { error: `"${command.link}" matches ${links.map((link) => link.id).join(' and ')}. Say which id.` };
  const link = { ...links[0], bends: [...links[0].bends] };
  const notes: string[] = [];
  if (command.straighten) {
    link.bends = [];
    notes.push('straight');
  }
  if (command.clearCode || command.code === '') {
    delete link.code;
    notes.push('code cleared');
  } else if (command.code !== undefined) {
    const code = readCode(command.code, 'link');
    if ('error' in code) return { error: code.error };
    if (code.code) link.code = code.code;
    else delete link.code;
    notes.push('code set');
  }
  if (!notes.length) return { error: 'Say what to change: code, or straighten.' };
  return done(
    { ...input, links: input.links.map((item) => (item.id === link.id ? link : item)) },
    [{ type: 'putLink', link }],
    `${link.id}: ${notes.join(', ')}.`,
  );
}

function remove(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.target !== 'string' || !command.target.trim()) return { error: 'Say what to remove.' };
  const ref = command.target;
  const blocks = findBlocks(input, ref);
  const regions = findRegions(input, ref);
  const links = linksBetween(input, ref);
  const waves = (input.waves ?? []).filter((wave) => wave.id === ref || norm(wave.id) === norm(ref));
  if (typeof links === 'string') return { error: links };
  const hits = blocks.length + regions.length + links.length + waves.length;
  if (hits === 0) return { error: `Nothing called "${ref}".` };
  if (hits > 1) return { error: `"${ref}" matches more than one thing. Say the id.` };

  if (blocks.length === 1) {
    const block = blocks[0];
    const gone = new Set(input.links.filter((link) => link.from === block.id || link.to === block.id).map((link) => link.id));
    const next = {
      ...input,
      blocks: input.blocks.filter((item) => item.id !== block.id),
      links: input.links.filter((link) => !gone.has(link.id)),
    };
    return done(next, [{ type: 'drop', blockIds: [block.id], linkIds: [...gone], regionIds: [], waveIds: [] }], `Removed ${blockName(block.kind)} (${block.id})${gone.size ? ` and ${gone.size === 1 ? 'its link' : `${gone.size} links`}` : ''}.`);
  }
  if (links.length === 1) {
    const link = links[0];
    const from = input.blocks.find((block) => block.id === link.from);
    const to = input.blocks.find((block) => block.id === link.to);
    return done(
      { ...input, links: input.links.filter((item) => item.id !== link.id) },
      [{ type: 'drop', blockIds: [], linkIds: [link.id], regionIds: [], waveIds: [] }],
      `Removed the link from ${from ? blockName(from.kind) : link.from} to ${to ? blockName(to.kind) : link.to}.`,
    );
  }
  if (regions.length === 1) {
    const region = regions[0];
    return done(
      { ...input, regions: input.regions.filter((item) => item.id !== region.id) },
      [{ type: 'drop', blockIds: [], linkIds: [], regionIds: [region.id], waveIds: [] }],
      `Removed region ${region.name}. The blocks stay.`,
    );
  }
  const wave = waves[0];
  return done(
    { ...input, waves: (input.waves ?? []).filter((item) => item.id !== wave.id) },
    [{ type: 'drop', blockIds: [], linkIds: [], regionIds: [], waveIds: [wave.id] }],
    `Removed wave ${wave.id}.`,
  );
}

function addRegion(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (input.regions.length >= MAX_REGIONS) return { error: `${MAX_REGIONS} regions is the limit.` };
  let scaleId = input.scaleId || DEFAULT_SCALE_ID;
  let scaleName = input.scaleName || scalesOf(input).find((scale) => scale.id === scaleId)?.name || scaleId;
  if (typeof command.scale === 'string' && command.scale.trim()) {
    const scale = resolveScale(input, command.scale);
    if ('error' in scale) return { error: scale.error };
    scaleId = scale.id;
    scaleName = scale.name;
  }
  const root = command.root === undefined ? (input.rootHz ?? ROOT_HZ) : resolveRoot(command.root);
  if (typeof root === 'string') return { error: root };
  const key = command.key === undefined ? undefined : readKey(command.key, keysTaken(input));
  if (key && 'error' in key) return { error: key.error };

  const around = typeof command.around === 'string' && command.around.trim()
    ? command.around.split(',').map((part) => part.trim()).filter(Boolean)
    : [];
  const wrapped: DeckBlock[] = [];
  for (const ref of around) {
    const block = oneBlock(input, ref);
    if (typeof block === 'string') return { error: block };
    wrapped.push(block);
  }

  let x: number;
  let y: number;
  let w: number;
  let h: number;
  if (wrapped.length) {
    const xs = wrapped.map((block) => block.x);
    const ys = wrapped.map((block) => block.y);
    x = Math.min(...xs) - MIN_REGION;
    y = Math.min(...ys) - MIN_REGION;
    w = Math.max(...xs) + MIN_REGION - x;
    h = Math.max(...ys) + MIN_REGION - y;
  } else if (command.x !== undefined || command.w !== undefined) {
    const bx = num(command.x ?? 0, 'x', -4000, 4000);
    if (typeof bx === 'string') return { error: bx };
    const by = num(command.y ?? 0, 'y', -4000, 4000);
    if (typeof by === 'string') return { error: by };
    const bw = num(command.w ?? 4, 'Width', MIN_REGION / PX_PER_BEAT, 4000);
    if (typeof bw === 'string') return { error: bw };
    const bh = num(command.h ?? 3, 'Height', MIN_REGION / PX_PER_BEAT, 4000);
    if (typeof bh === 'string') return { error: bh };
    x = px(bx);
    y = px(by);
    w = bw * PX_PER_BEAT;
    h = bh * PX_PER_BEAT;
  } else {
    const spot = defaultSpot(input);
    x = spot.x;
    y = spot.y - PX_PER_BEAT;
    w = 4 * PX_PER_BEAT;
    h = 3 * PX_PER_BEAT;
  }

  const name = typeof command.name === 'string' && command.name.trim() ? command.name.trim().slice(0, 80) : `Region ${input.regions.length + 1}`;
  const region: DeckRegion = {
    id: freshId('r', input.regions.map((item) => item.id)),
    name,
    scaleId,
    scaleName,
    rootHz: root,
    ...(key?.key ? { key: key.key } : {}),
    x,
    y,
    w,
    h,
    mix: blankMix(),
    fx: blankFx(),
    groove: blankGroove(),
  };
  return done({ ...input, regions: [...input.regions, region] }, [{ type: 'addRegion', region }], `Added region ${name} (${region.id}).`);
}

function editRegion(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.region !== 'string' || !command.region.trim()) return { error: 'Say which region to edit.' };
  const region = oneRegion(input, command.region);
  if (typeof region === 'string') return { error: region };
  const next: DeckRegion = { ...region };
  const notes: string[] = [];
  if (typeof command.name === 'string') {
    const name = command.name.trim().slice(0, 80);
    if (!name) return { error: 'A region needs a name.' };
    next.name = name;
    notes.push(name);
  }
  if (typeof command.scale === 'string' && command.scale.trim()) {
    const scale = resolveScale(input, command.scale);
    if ('error' in scale) return { error: scale.error };
    next.scaleId = scale.id;
    next.scaleName = scale.name;
    notes.push(scale.name);
  }
  if (command.root !== undefined) {
    const root = resolveRoot(command.root);
    if (typeof root === 'string') return { error: root };
    next.rootHz = root;
    notes.push('root set');
  }
  if (command.clearKey || command.key === '') {
    delete next.key;
    notes.push('key cleared');
  } else if (command.key !== undefined) {
    const key = readKey(command.key, keysTaken(input, region.id));
    if ('error' in key) return { error: key.error };
    if (!key.key) delete next.key;
    else {
      next.key = key.key;
      notes.push(`key ${key.key.toUpperCase()}`);
    }
  }
  if (command.x !== undefined || command.y !== undefined || command.w !== undefined || command.h !== undefined) {
    const bx = command.x === undefined ? next.x / PX_PER_BEAT : num(command.x, 'x', -4000, 4000);
    if (typeof bx === 'string') return { error: bx };
    const by = command.y === undefined ? next.y / PX_PER_BEAT : num(command.y, 'y', -4000, 4000);
    if (typeof by === 'string') return { error: by };
    const bw = command.w === undefined ? next.w / PX_PER_BEAT : num(command.w, 'Width', MIN_REGION / PX_PER_BEAT, 4000);
    if (typeof bw === 'string') return { error: bw };
    const bh = command.h === undefined ? next.h / PX_PER_BEAT : num(command.h, 'Height', MIN_REGION / PX_PER_BEAT, 4000);
    if (typeof bh === 'string') return { error: bh };
    next.x = px(bx);
    next.y = px(by);
    next.w = bw * PX_PER_BEAT;
    next.h = bh * PX_PER_BEAT;
    notes.push('moved');
  }
  if (!notes.length) return { error: 'Say what to change on the region.' };
  return done(
    { ...input, regions: input.regions.map((item) => (item.id === region.id ? next : item)) },
    [{
      type: 'placeRegion',
      id: next.id,
      x: next.x,
      y: next.y,
      w: next.w,
      h: next.h,
      name: next.name,
      scaleId: next.scaleId,
      rootHz: next.rootHz,
      key: command.clearKey || command.key === '' ? null : next.key,
    }],
    `${region.name}: ${notes.join(', ')}.`,
  );
}

function tune(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  const next = { ...input };
  const notes: string[] = [];
  if (typeof command.scale === 'string' && command.scale.trim()) {
    const scale = resolveScale(input, command.scale);
    if ('error' in scale) return { error: scale.error };
    next.scaleId = scale.id;
    next.scaleName = scale.name;
    notes.push(scale.name);
  }
  if (command.root !== undefined) {
    const root = resolveRoot(command.root);
    if (typeof root === 'string') return { error: root };
    next.rootHz = root;
    notes.push('root set');
  }
  if (command.snap !== undefined) {
    if (typeof command.snap !== 'boolean') return { error: 'Snap is true or false.' };
    next.snap = command.snap;
    notes.push(command.snap ? 'snap ¼ on' : 'snap off');
  }
  if (!notes.length) return { error: 'Say a scale, a root, or snap.' };
  return done(next, [{ type: 'tune', scaleId: next.scaleId, rootHz: next.rootHz, snap: command.snap === undefined ? undefined : next.snap }], `Canvas: ${notes.join(', ')}.`);
}

const STAMPS = ['saw', 'square', 'sine', 'decay'] as const;

function wave(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  const waves = input.waves ?? [];
  if (typeof command.stamp === 'string') {
    if (waves.length >= MAX_WAVES) return { error: `${MAX_WAVES} waves is the limit.` };
    if (!STAMPS.includes(command.stamp as Stamp)) return { error: 'A wave stamp is saw, square, sine or decay.' };
    const bx = command.x === undefined ? 0 : num(command.x, 'x', -4000, 4000);
    if (typeof bx === 'string') return { error: bx };
    const by = command.y === undefined ? 0 : num(command.y, 'y', -4000, 4000);
    if (typeof by === 'string') return { error: by };
    let instrument: string | undefined;
    if (typeof command.instrument === 'string' && command.instrument.trim() && norm(command.instrument) !== 'region') {
      const kind = resolveKind(command.instrument);
      if ('error' in kind) return { error: kind.error };
      if (kind.id === 'start' || kind.id === 'pattern') return { error: 'A wave aims at an instrument, or at the region when you leave it off.' };
      instrument = kind.id;
    }
    const shape = stampOf(command.stamp as Stamp, { x: px(bx), y: px(by) });
    const drawn: DeckWave = {
      id: freshId('w', waves.map((item) => item.id)),
      role: shape.role,
      points: shape.points,
      ...(instrument ? { instrument } : {}),
    };
    return done(
      { ...input, waves: [...waves, drawn] },
      [{ type: 'addWave', wave: drawn }],
      `Added a ${command.stamp} ${shape.role} (${drawn.id})${instrument ? ` for ${blockName(instrument)}` : ''}.`,
    );
  }

  const waveId = command.wave;
  if (typeof waveId !== 'string' || !waveId.trim()) return { error: 'Say a stamp to add, or which wave to change.' };
  const found = waves.filter((item) => item.id === waveId || norm(item.id) === norm(waveId));
  if (found.length !== 1) return { error: found.length ? `"${waveId}" matches more than one wave.` : `No wave called "${waveId}".` };
  if (command.remove === true) {
    return done(
      { ...input, waves: waves.filter((item) => item.id !== found[0].id) },
      [{ type: 'drop', blockIds: [], linkIds: [], regionIds: [], waveIds: [found[0].id] }],
      `Removed wave ${found[0].id}.`,
    );
  }
  const next: DeckWave = { ...found[0], points: found[0].points.map((point) => ({ ...point })) };
  const notes: string[] = [];
  if (command.dx !== undefined || command.dy !== undefined) {
    const dx = command.dx === undefined ? 0 : num(command.dx, 'dx', -32, 32);
    if (typeof dx === 'string') return { error: dx };
    const dy = command.dy === undefined ? 0 : num(command.dy, 'dy', -32, 32);
    if (typeof dy === 'string') return { error: dy };
    next.points = next.points.map((point) => ({ x: point.x + dx * PX_PER_BEAT, y: point.y + dy * PX_PER_BEAT }));
    notes.push('moved');
  }
  if (command.clearInstrument || norm(String(command.instrument ?? '')) === 'region') {
    delete next.instrument;
    notes.push('aims at the region');
  } else if (typeof command.instrument === 'string' && command.instrument.trim()) {
    const kind = resolveKind(command.instrument);
    if ('error' in kind) return { error: kind.error };
    if (kind.id === 'start' || kind.id === 'pattern') return { error: 'A wave aims at an instrument, or at the region.' };
    next.instrument = kind.id;
    notes.push(`for ${blockName(kind.id)}`);
  }
  if (!notes.length) return { error: 'Move the wave, aim it at an instrument, or remove it.' };
  return done(
    { ...input, waves: waves.map((item) => (item.id === next.id ? next : item)) },
    [{ type: 'putWave', wave: next }],
    `${next.id}: ${notes.join(', ')}.`,
  );
}

const BUILD_OPS = new Set(['catalog', 'add_block', 'edit_block', 'link', 'edit_link', 'remove', 'add_region', 'edit_region', 'tune', 'wave']);

/** Null when `command` is not a building move, so the player can try the performance tools. */
export function build(input: DeckInput, command: Record<string, unknown>): DeckPlan | null {
  const op = command.op;
  if (typeof op !== 'string' || !BUILD_OPS.has(op)) return null;
  if (op === 'catalog') return catalog(input, command);
  if (op === 'add_block') return addBlock(input, command);
  if (op === 'edit_block') return editBlock(input, command);
  if (op === 'link') return linkBlocks(input, command);
  if (op === 'edit_link') return editLink(input, command);
  if (op === 'remove') return remove(input, command);
  if (op === 'add_region') return addRegion(input, command);
  if (op === 'edit_region') return editRegion(input, command);
  if (op === 'tune') return tune(input, command);
  return wave(input, command);
}
