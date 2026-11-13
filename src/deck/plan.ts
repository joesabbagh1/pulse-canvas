// Turns a deck command into a change the canvas can apply, and the words to
// say back. The canvas stays the source of truth; this only plans.

import { GRID, PX_PER_BEAT, fitLength, inPort, linkBetween, outPort, spanOf } from '../engine/geometry';
import { instrumentById } from '../engine/instruments';
import {
  beatCount,
  blockName,
  renderScene,
  travelBeats,
  type DeckBlock,
  type DeckFx,
  type DeckGroove,
  type DeckInput,
  type DeckLink,
  type DeckMix,
  type DeckRegion,
} from './scene';
import { build } from './build';
import { live } from './live';
import type { DeckEffect, DeckPlan } from './effects';

export type { DeckEffect, DeckPlan };

const MAX_NUDGE = 32;
const MAX_LINK = 64;

const norm = (value: string) => value.trim().toLowerCase();

function names(blocks: readonly DeckBlock[]) {
  return blocks
    .map((block) => `${blockName(block.kind)} (${block.id}${block.key ? `, key ${block.key.toUpperCase()}` : ''})`)
    .join(' and ');
}

export function findBlocks(input: DeckInput, ref: string): DeckBlock[] {
  const query = norm(ref);
  if (!query) return [];
  const byId = input.blocks.filter((block) => block.id === ref || norm(block.id) === query);
  if (byId.length) return byId;
  if (/^[a-z0-9]$/i.test(query)) {
    const byKey = input.blocks.filter((block) => block.key?.toLowerCase() === query);
    if (byKey.length) return byKey;
  }
  return input.blocks.filter((block) => {
    const short = instrumentById(block.kind)?.short ?? '';
    return norm(blockName(block.kind)) === query || norm(block.kind) === query || (short !== '' && norm(short) === query);
  });
}

export function findRegions(input: DeckInput, ref: string): DeckRegion[] {
  const query = norm(ref);
  if (!query) return [];
  const byId = input.regions.filter((region) => region.id === ref || norm(region.id) === query);
  if (byId.length) return byId;
  if (/^[a-z0-9]$/i.test(query)) {
    const byKey = input.regions.filter((region) => region.key?.toLowerCase() === query);
    if (byKey.length) return byKey;
  }
  return input.regions.filter((region) => norm(region.name) === query);
}

function blockError(input: DeckInput, ref: string): DeckBlock | string {
  const found = findBlocks(input, ref);
  if (found.length === 1) return found[0];
  if (found.length > 1) return `"${ref}" matches ${names(found)}. Say which id.`;
  const regions = findRegions(input, ref);
  if (regions.length === 1 && regions[0].key?.toLowerCase() === norm(ref)) {
    return `${ref.toUpperCase()} mutes ${regions[0].name}. Hit takes a block.`;
  }
  return `No block called "${ref}". Look at the canvas for ids, keys and instrument names.`;
}

function regionError(input: DeckInput, ref: string): DeckRegion | string {
  if (!input.regions.length) return 'There are no regions to mix. Blocks on the open canvas share one sound.';
  const found = findRegions(input, ref);
  if (found.length === 1) return found[0];
  if (found.length > 1) return `"${ref}" matches ${found.map((region) => `${region.name} (${region.id})`).join(' and ')}. Say which id.`;
  if (findBlocks(input, ref).length) return `${ref} is a block. Mix a region: ${input.regions.map((region) => region.name).join(', ')}.`;
  return `No region called "${ref}". Regions: ${input.regions.map((region) => region.name).join(', ')}.`;
}

function findLinks(input: DeckInput, ref: string): DeckLink[] | string {
  const query = norm(ref);
  const byId = input.links.filter((link) => link.id === ref || norm(link.id) === query);
  if (byId.length) return byId;
  const parts = ref
    .split(/\s*(?:→|->|>| to )\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) return [];
  const from = blockError(input, parts[0]);
  const to = blockError(input, parts[1]);
  if (typeof from === 'string') return from;
  if (typeof to === 'string') return to;
  return input.links.filter((link) => link.from === from.id && link.to === to.id);
}

function asRecord(command: unknown): Record<string, unknown> | string {
  if (typeof command !== 'object' || command === null || Array.isArray(command)) return 'The deck got a command it could not read.';
  return command as Record<string, unknown>;
}

function numberIn(value: unknown, label: string, min: number, max: number): number | string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} needs a number.`;
  if (value < min || value > max) return `${label} is from ${min} to ${max}.`;
  return value;
}

function roundTo(value: number, step: number) {
  return Math.round(value / step) * step;
}

function say(input: DeckInput, lead: string): DeckPlan {
  return { effects: [], text: `${lead}\n\n${renderScene(input)}` };
}

function done(input: DeckInput, effects: DeckEffect[], lead: string): DeckPlan {
  return { effects, text: `${lead}\n\n${renderScene(input)}` };
}

function transport(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  const effects: DeckEffect[] = [];
  let next = input;
  const notes: string[] = [];
  if (command.bpm !== undefined) {
    const bpm = numberIn(command.bpm, 'Tempo', 50, 200);
    if (typeof bpm === 'string') return { error: bpm };
    const whole = Math.round(bpm);
    effects.push({ type: 'bpm', bpm: whole });
    next = { ...next, bpm: whole };
    notes.push(`Tempo is ${whole} bpm.`);
  }
  if (command.action === 'play') {
    if (!next.playing) {
      effects.push({ type: 'play' });
      next = { ...next, playing: true, beat: 0 };
      notes.push('Playing. Start blocks have sent their pulses.');
    } else notes.push(`Already playing, at beat ${input.beat}.`);
  } else if (command.action === 'stop') {
    if (next.playing) {
      effects.push({ type: 'stop' });
      next = { ...next, playing: false, beat: 0 };
      notes.push('Stopped.');
    } else notes.push('Already stopped.');
  } else if (command.action !== undefined) {
    return { error: 'Transport action is "play" or "stop".' };
  }
  if (!notes.length) return { error: 'Say play, stop, or a tempo.' };
  return done(next, effects, notes.join(' '));
}

function hit(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.block !== 'string' || !command.block.trim()) return { error: 'Say which block to fire.' };
  if (!input.playing) return { error: 'The canvas is stopped. Play first, then hit.' };
  const block = blockError(input, command.block);
  if (typeof block === 'string') return { error: block };
  const key = block.key ? `, key ${block.key.toUpperCase()}` : '';
  return done(input, [{ type: 'fire', id: block.id }], `Fired a pulse from ${blockName(block.kind)} (${block.id}${key}).`);
}

function mix(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.region !== 'string' || !command.region.trim()) return { error: 'Say which region to mix.' };
  const region = regionError(input, command.region);
  if (typeof region === 'string') return { error: region };
  const patch: { mix?: Partial<DeckMix>; fx?: Partial<DeckFx>; groove?: Partial<DeckGroove> } = {};
  const notes: string[] = [];

  if (command.mute !== undefined) {
    if (typeof command.mute !== 'boolean') return { error: 'Mute is true or false.' };
    patch.mix = { ...patch.mix, mute: command.mute };
    notes.push(command.mute ? 'muted' : 'on');
  }
  if (command.level !== undefined) {
    const level = numberIn(command.level, 'Level', -40, 6);
    if (typeof level === 'string') return { error: level };
    const db = Math.round(level);
    patch.mix = { ...patch.mix, level: db };
    notes.push(db <= -40 ? 'silent' : `${db} dB`);
  }
  if (command.pan !== undefined) {
    const pan = numberIn(command.pan, 'Pan', -1, 1);
    if (typeof pan === 'string') return { error: pan };
    const stepped = roundTo(pan, 0.05);
    patch.mix = { ...patch.mix, pan: stepped };
    const side = Math.round(stepped * 100);
    notes.push(side === 0 ? 'center' : `${side < 0 ? 'left' : 'right'} ${Math.abs(side)}`);
  }
  if (command.tone !== undefined) {
    const tone = numberIn(command.tone, 'Tone', 0, 1);
    if (typeof tone === 'string') return { error: tone };
    const stepped = roundTo(tone, 0.01);
    patch.fx = { ...patch.fx, tone: stepped };
    notes.push(stepped >= 0.99 ? 'tone open' : `tone ${Math.round(stepped * 100)}% open`);
  }
  if (command.echo !== undefined) {
    const echo = numberIn(command.echo, 'Echo', 0, 1);
    if (typeof echo === 'string') return { error: echo };
    const stepped = roundTo(echo, 0.01);
    patch.fx = { ...patch.fx, echo: stepped };
    notes.push(stepped <= 0 ? 'echo off' : `echo ${Math.round(stepped * 100)}%`);
  }
  if (command.echoBeats !== undefined) {
    const beats = numberIn(command.echoBeats, 'Echo time', 0.25, 4);
    if (typeof beats === 'string') return { error: beats };
    const stepped = roundTo(beats, 0.25);
    patch.fx = { ...patch.fx, echoBeats: stepped };
    notes.push(`echo time ${beatCount(stepped)}`);
  }
  if (command.reverb !== undefined) {
    const reverb = numberIn(command.reverb, 'Reverb', 0, 1);
    if (typeof reverb === 'string') return { error: reverb };
    const stepped = roundTo(reverb, 0.01);
    patch.fx = { ...patch.fx, reverb: stepped };
    notes.push(`reverb ${Math.round(stepped * 100)}%`);
  }
  if (command.swing !== undefined) {
    const swing = numberIn(command.swing, 'Swing', 0, 1);
    if (typeof swing === 'string') return { error: swing };
    const stepped = roundTo(swing, 0.01);
    patch.groove = { ...patch.groove, swing: stepped };
    notes.push(stepped <= 0 ? 'swing off' : `swing ${Math.round(stepped * 100)}%`);
  }
  if (command.swingGrid !== undefined) {
    const grid = command.swingGrid === '16ths' ? 0.25 : command.swingGrid === '8ths' ? 0.5 : null;
    if (grid === null) return { error: 'Swing grid is "8ths" or "16ths".' };
    patch.groove = { ...patch.groove, swingGrid: grid };
    notes.push(`swing on ${command.swingGrid}`);
  }
  if (command.humanize !== undefined) {
    const humanize = numberIn(command.humanize, 'Humanize', 0, 1);
    if (typeof humanize === 'string') return { error: humanize };
    const stepped = roundTo(humanize, 0.01);
    patch.groove = { ...patch.groove, humanize: stepped };
    notes.push(stepped <= 0 ? 'humanize off' : `humanize ${Math.round(stepped * 100)}%`);
  }
  if (!notes.length) return { error: 'Say what to change: mute, level, pan, tone, echo, reverb, swing, or humanize.' };

  const next: DeckInput = {
    ...input,
    regions: input.regions.map((item) =>
      item.id === region.id
        ? {
            ...item,
            mix: { ...item.mix, ...patch.mix },
            fx: { ...item.fx, ...patch.fx },
            groove: { ...item.groove, ...patch.groove },
          }
        : item,
    ),
  };
  return done(next, [{ type: 'region', id: region.id, ...patch }], `${region.name}: ${notes.join(', ')}.`);
}

function direction(dx: number, dy: number) {
  const parts: string[] = [];
  if (dx) parts.push(`${dx > 0 ? 'right' : 'left'} ${beatCount(Math.abs(dx))}`);
  if (dy) parts.push(`${dy > 0 ? 'down' : 'up'} ${beatCount(Math.abs(dy))}`);
  return parts.join(' and ');
}

function nudge(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.block !== 'string' || !command.block.trim()) return { error: 'Say which block to move.' };
  const dx = numberIn(command.dx, 'dx', -MAX_NUDGE, MAX_NUDGE);
  if (typeof dx === 'string') return { error: dx };
  const dy = numberIn(command.dy, 'dy', -MAX_NUDGE, MAX_NUDGE);
  if (typeof dy === 'string') return { error: dy };
  if (dx === 0 && dy === 0) return { error: 'That leaves the block where it is.' };
  const block = blockError(input, command.block);
  if (typeof block === 'string') return { error: block };
  const moved: DeckBlock = { ...block, x: block.x + dx * PX_PER_BEAT, y: block.y + dy * PX_PER_BEAT };
  const blocks = input.blocks.map((item) => (item.id === block.id ? moved : item));
  const next = { ...input, blocks };
  const changes = input.links.flatMap((link) => {
    if (link.from !== block.id && link.to !== block.id) return [];
    const before = travelBeats(input, link);
    const after = travelBeats(next, link, blocks);
    if (before === after) return [];
    const from = blocks.find((item) => item.id === link.from);
    const to = blocks.find((item) => item.id === link.to);
    return [`${from ? blockName(from.kind) : link.from} → ${to ? blockName(to.kind) : link.to} is now ${beatCount(after)} (was ${beatCount(before)})`];
  });
  const heard = changes.length
    ? changes.join('. ') + '.'
    : input.snap
      ? 'The links still round to the same length while Snap ¼ is on.'
      : 'Its links kept the same length.';
  return done(next, [{ type: 'move', id: block.id, x: moved.x, y: moved.y }], `Moved ${blockName(block.kind)} ${direction(dx, dy)}. ${heard}`);
}

function stretch(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.link !== 'string' || !command.link.trim()) return { error: 'Say which link to stretch.' };
  const beats = numberIn(command.beats, 'Length', 0, MAX_LINK);
  if (typeof beats === 'string') return { error: beats };
  if (beats === 0) return { error: 'A link needs some length. Move the blocks together to bring them closer.' };
  const links = findLinks(input, command.link);
  if (typeof links === 'string') return { error: links };
  if (!links.length) return { error: `No link called "${command.link}". Name its id, or the two blocks, like "Start to Kick".` };
  if (links.length > 1) return { error: `"${command.link}" matches ${links.map((link) => link.id).join(' and ')}. Say which id.` };
  const link = links[0];
  const from = input.blocks.find((block) => block.id === link.from);
  const to = input.blocks.find((block) => block.id === link.to);
  if (!from || !to) return { error: 'That link is missing a block.' };
  const heard = input.snap ? Math.max(GRID, roundTo(beats, GRID)) : roundTo(beats, 0.01);
  const straight = linkBetween(point(from), point(to), [], 0).len / PX_PER_BEAT;
  if (heard * PX_PER_BEAT < straight - 0.01) {
    return { error: `The straight line between them is ${beatCount(straight)}. Move a block closer to make the link shorter.` };
  }
  const current = travelBeats(input, link);
  const snapNote = input.snap && Math.abs(heard - beats) > 1e-6 ? ` Snap ¼ plays that as ${beatCount(heard)}.` : '';
  if (Math.abs(current - heard) < 1e-6) return say(input, `${blockName(from.kind)} → ${blockName(to.kind)} is already ${beatCount(heard)}.${snapNote}`);
  const bends = fitLength(outPort(point(from), spanOf(from)), inPort(point(to), spanOf(to)), link.bends, heard * PX_PER_BEAT);
  if (!bends) return { error: `The straight line between them is ${beatCount(straight)}. Move a block closer to make the link shorter.` };
  const next = { ...input, links: input.links.map((item) => (item.id === link.id ? { ...item, bends } : item)) };
  return done(
    next,
    [{ type: 'bends', id: link.id, bends }],
    `${blockName(from.kind)} → ${blockName(to.kind)} is now ${beatCount(heard)} (was ${beatCount(current)}).${snapNote}`,
  );
}

function point(block: DeckBlock) {
  return { x: block.x, y: block.y, pattern: block.pattern, beats: block.beats };
}

export function perform(input: DeckInput, command: unknown): DeckPlan {
  const record = asRecord(command);
  if (typeof record === 'string') return { error: record };
  const op = record.op;
  if (op === 'look') {
    return {
      effects: [],
      text: `${renderScene(input)}\n\nBuild with catalog, add_block, edit_block, link, edit_link, remove, add_region, edit_region, tune and wave. Play an instrument with play_instrument, record a WAV with record, and keep a performance with take. Perform the canvas with transport, hit, mix, nudge and stretch.`,
    };
  }
  if (op === 'transport') return transport(input, record);
  if (op === 'hit') return hit(input, record);
  if (op === 'mix') return mix(input, record);
  if (op === 'nudge') return nudge(input, record);
  if (op === 'stretch') return stretch(input, record);
  const built = build(input, record);
  if (built) return built;
  const played = live(input, record);
  if (played) return played;
  return { error: 'Unknown move. Look, then build, play_instrument, record, take, or perform with transport, hit, mix, nudge and stretch.' };
}
