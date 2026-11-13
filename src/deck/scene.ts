// What the deck tells the player: the open canvas, in beats. A link's length
// is how long a pulse takes to cross it. Positions are beats from the origin;
// right is +x and down the canvas is +y.

import { pieceCycle } from '../cycle';
import { PX_PER_BEAT, formatBeats, linkBeats, linkBetween, spanOf, type SpanPoint } from '../engine/geometry';
import { instrumentById } from '../engine/instruments';
import { findLoops } from '../loops';

export interface DeckMix {
  level: number;
  pan: number;
  mute: boolean;
}

export interface DeckFx {
  tone: number;
  echo: number;
  echoBeats: number;
  reverb: number;
}

export interface DeckGroove {
  swing: number;
  swingGrid: number;
  humanize: number;
}

export interface DeckBlock {
  id: string;
  kind: string;
  degree: number;
  every: number;
  key?: string;
  pattern?: string;
  beats?: number;
  hasCode?: boolean;
  /** Canvas pixels. */
  x: number;
  y: number;
}

export interface DeckLink {
  id: string;
  from: string;
  to: string;
  bends: { x: number; y: number }[];
  hasCode?: boolean;
}

export interface DeckRegion {
  id: string;
  name: string;
  key?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  mix: DeckMix;
  fx: DeckFx;
  groove: DeckGroove;
}

export interface DeckInput {
  canvasName: string;
  bpm: number;
  snap: boolean;
  playing: boolean;
  beat: number;
  blocks: DeckBlock[];
  links: DeckLink[];
  regions: DeckRegion[];
}

export function blockName(kind: string) {
  if (kind === 'start') return 'Start';
  return instrumentById(kind)?.name ?? kind;
}

export function beatCount(beats: number) {
  const n = Math.round(beats * 100) / 100;
  return `${n} ${n === 1 ? 'beat' : 'beats'}`;
}

function place(px: number) {
  return String(Math.round((px / PX_PER_BEAT) * 100) / 100);
}

function pointOf(block: DeckBlock): SpanPoint {
  return { x: block.x, y: block.y, pattern: block.pattern, beats: block.beats };
}

export function travelBeats(input: DeckInput, link: DeckLink, blocks: readonly DeckBlock[] = input.blocks): number {
  const from = blocks.find((block) => block.id === link.from);
  const to = blocks.find((block) => block.id === link.to);
  if (!from || !to) return 0;
  return linkBeats(linkBetween(pointOf(from), pointOf(to), link.bends, 0).len, input.snap);
}

function regionOf(input: DeckInput, block: DeckBlock): DeckRegion | undefined {
  let best: DeckRegion | undefined;
  let area = Infinity;
  for (const region of input.regions) {
    if (block.x < region.x || block.y < region.y || block.x > region.x + region.w || block.y > region.y + region.h) continue;
    const size = region.w * region.h;
    if (size < area) {
      best = region;
      area = size;
    }
  }
  return best;
}

function formatLevel(db: number) {
  const n = Math.round(db);
  if (n <= -40) return 'silent';
  if (n === 0) return '0 dB';
  return `${n > 0 ? '+' : ''}${n} dB`;
}

function formatPan(pan: number) {
  const n = Math.round(pan * 100);
  if (n === 0) return 'center';
  return `${n < 0 ? 'L' : 'R'} ${Math.abs(n)}`;
}

function regionLine(region: DeckRegion) {
  const mix = region.mix;
  const fx = region.fx;
  const groove = region.groove;
  const echo = fx.echo <= 0 ? 'echo off' : `echo ${Math.round(fx.echo * 100)}% at ${formatBeats(fx.echoBeats, true)}`;
  const swing = groove.swing <= 0 ? 'swing off' : `swing ${Math.round(groove.swing * 100)}% on ${groove.swingGrid === 0.25 ? '16ths' : '8ths'}`;
  const human = groove.humanize > 0 ? ` · humanize ${Math.round(groove.humanize * 100)}%` : '';
  const key = region.key ? ` · key ${region.key.toUpperCase()}` : '';
  return `${region.name} (${region.id})${key} · ${mix.mute ? 'muted' : 'on'} · ${formatLevel(mix.level)} · ${formatPan(mix.pan)} · tone ${fx.tone >= 0.99 ? 'open' : `${Math.round(fx.tone * 100)}% open`} · ${echo} · reverb ${Math.round(fx.reverb * 100)}% · ${swing}${human}`;
}

function blockLine(input: DeckInput, block: DeckBlock) {
  const name = blockName(block.kind);
  const bits = [`${name} (${block.id})`];
  if (block.key) bits.push(`key ${block.key.toUpperCase()}`);
  if (block.kind === 'start') bits.push(block.every > 0 ? `every ${beatCount(block.every)}` : 'fires once when play starts');
  else if (instrumentById(block.kind)?.pitched) bits.push(`degree ${block.degree}`);
  if (block.pattern !== undefined) {
    const text = block.pattern.replace(/\s+/g, ' ').trim();
    const shown = text.length > 60 ? `${text.slice(0, 57)}...` : text || 'empty';
    bits.push(`pattern "${shown}" over ${beatCount(spanOf(block))}`);
  }
  if (block.hasCode) bits.push('has code');
  const region = regionOf(input, block);
  bits.push(`at ${place(block.x)}, ${place(block.y)}`);
  bits.push(region ? `in ${region.name}` : 'on the canvas');
  return bits.join(' · ');
}

function linkLine(input: DeckInput, link: DeckLink) {
  const from = input.blocks.find((block) => block.id === link.from);
  const to = input.blocks.find((block) => block.id === link.to);
  const code = link.hasCode ? ' · has code' : '';
  return `${link.id} · ${from ? blockName(from.kind) : link.from} → ${to ? blockName(to.kind) : link.to} · ${beatCount(travelBeats(input, link))}${code}`;
}

function cycleLine(input: DeckInput) {
  const loops = loopsOf(input);
  const periods = [
    ...loops.map((loop) => loop.beats),
    ...input.blocks.filter((block) => block.kind === 'start' && block.every > 0).map((block) => block.every),
  ];
  const cycle = pieceCycle(periods);
  if (cycle.kind === 'repeats') return `The parts line up every ${beatCount(cycle.beats)}.`;
  if (cycle.kind === 'drifts') return 'The loops do not line up exactly.';
  if (cycle.kind === 'too-long') return 'The loops line up only after a very long time.';
  return '';
}

export function loopsOf(input: DeckInput) {
  const positions = new Map(input.blocks.map((block) => [block.id, { x: block.x, y: block.y }]));
  const links = input.links.flatMap((link) => {
    if (!positions.has(link.from) || !positions.has(link.to)) return [];
    return [{ source: link.from, target: link.to, beats: travelBeats(input, link) }];
  });
  const spans = new Map(input.blocks.map((block) => [block.id, spanOf(block)]));
  return findLoops(positions, links, spans);
}

/** The canvas as a player would want it read back. */
export function renderScene(input: DeckInput): string {
  const state = input.playing ? `playing, beat ${input.beat}` : 'stopped';
  const lines = [`${input.canvasName} · ${input.bpm} bpm · ${state}${input.snap ? ' · snap ¼' : ''}`];
  const cycle = cycleLine(input);
  if (cycle) lines.push(cycle);
  lines.push('');
  lines.push(input.regions.length ? 'Regions (each one is a mixer channel):' : 'Regions: none. Blocks on the open canvas share one sound.');
  for (const region of input.regions) lines.push(`- ${regionLine(region)}`);
  lines.push('');
  lines.push('Blocks:');
  if (!input.blocks.length) lines.push('- none');
  for (const block of input.blocks) lines.push(`- ${blockLine(input, block)}`);
  lines.push('');
  lines.push('Links, whose length is the time a pulse takes to travel:');
  if (!input.links.length) lines.push('- none');
  for (const link of input.links) lines.push(`- ${linkLine(input, link)}`);
  const loops = loopsOf(input);
  if (loops.length) {
    lines.push('');
    lines.push('Loops:');
    for (const loop of loops) {
      const names = loop.blocks.map((id) => blockName(input.blocks.find((block) => block.id === id)?.kind ?? id));
      lines.push(`- ${names.join(' → ')} · ${beatCount(loop.beats)}`);
    }
  }
  lines.push('');
  lines.push('Right is +x. Down the canvas is +y. Moving a block changes how long its links take.');
  return lines.join('\n');
}
