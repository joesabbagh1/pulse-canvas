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
  drive: number;
  pump: number;
  pumpBeats: number;
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
  code?: string;
  pattern?: string;
  beats?: number;
  /** Anything but the default roll. */
  figure?: 'fall' | 'spiral' | 'wheel';
  level?: number;
  tone?: number;
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
  code?: string;
  hasCode?: boolean;
}

export interface DeckWave {
  id: string;
  role: 'cycle' | 'motion';
  points: { x: number; y: number }[];
  instrument?: string;
}

export interface DeckRegion {
  id: string;
  name: string;
  key?: string;
  scaleId?: string;
  scaleName?: string;
  rootHz?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  mix: DeckMix;
  fx: DeckFx;
  groove: DeckGroove;
  /** Audio file the region's tones play, when one is set. */
  sample?: { id: string; name: string };
}

export interface DeckBedClip {
  id: string;
  beat: number;
  offset: number;
  seconds: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  mute: boolean;
}

export interface DeckBed {
  name: string;
  sampleId: string;
  duration: number;
  level: number;
  missing?: boolean;
  clips: DeckBedClip[];
}

export interface DeckInput {
  canvasName: string;
  bpm: number;
  snap: boolean;
  playing: boolean;
  beat: number;
  /** The canvas tuning, outside every region. */
  scaleId?: string;
  scaleName?: string;
  rootHz?: number;
  /** Built-in scales plus any this piece imported. */
  scales?: { id: string; name: string }[];
  blocks: DeckBlock[];
  links: DeckLink[];
  regions: DeckRegion[];
  waves?: DeckWave[];
  recording?: boolean;
  takes?: { id: string; name: string; instrument: string; notes: { beat: number; degree: number; beats: number; velocity: number }[] }[];
  /** Every canvas in this browser. The open one is `canvasId`, or else `canvasName`. */
  canvasId?: string;
  canvases?: { id: string; name: string }[];
  /** Null when the piece has no background. Absent when the caller didn't say. */
  bed?: DeckBed | null;
  canUndo?: boolean;
  canRedo?: boolean;
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
  const drive = fx.drive > 0.001 ? ` · drive ${Math.round(fx.drive * 100)}%` : '';
  const pump = fx.pump > 0.001 ? ` · pump ${Math.round(fx.pump * 100)}% over ${formatBeats(fx.pumpBeats, true)}` : '';
  const swing = groove.swing <= 0 ? 'swing off' : `swing ${Math.round(groove.swing * 100)}% on ${groove.swingGrid === 0.25 ? '16ths' : '8ths'}`;
  const human = groove.humanize > 0 ? ` · humanize ${Math.round(groove.humanize * 100)}%` : '';
  const key = region.key ? ` · key ${region.key.toUpperCase()}` : '';
  const tuning = region.scaleName ? ` · ${region.scaleName}${region.rootHz ? ` · ${rootName(region.rootHz)}` : ''}` : '';
  const box = ` · at ${place(region.x)}, ${place(region.y)} · ${place(region.w)} by ${place(region.h)}`;
  const sample = region.sample ? ` · sample "${region.sample.name}"` : '';
  return `${region.name} (${region.id})${tuning}${key} · ${mix.mute ? 'muted' : 'on'} · ${formatLevel(mix.level)} · ${formatPan(mix.pan)} · tone ${fx.tone >= 0.99 ? 'open' : `${Math.round(fx.tone * 100)}% open`} · ${echo} · reverb ${Math.round(fx.reverb * 100)}%${drive}${pump} · ${swing}${human}${sample}${box}`;
}

function rootName(hz: number) {
  const cents = 1200 * Math.log2(hz / 261.6256);
  const semis = Math.round(cents / 100);
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  if (Math.abs(cents - semis * 100) > 1) return `${Math.round(hz)} Hz`;
  return names[((semis % 12) + 12) % 12];
}

function quote(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
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
    if (block.figure) bits.push(block.figure);
    if (typeof block.level === 'number' && block.level < 1) bits.push(`level ${Math.round(block.level * 100)}%`);
    if (typeof block.tone === 'number' && block.tone < 1) bits.push(`tone ${Math.round(block.tone * 100)}% open`);
  }
  if (block.code) bits.push(`code "${quote(block.code)}"`);
  else if (block.hasCode) bits.push('has code');
  const region = regionOf(input, block);
  bits.push(`at ${place(block.x)}, ${place(block.y)}`);
  bits.push(region ? `in ${region.name}` : 'on the canvas');
  return bits.join(' · ');
}

function linkLine(input: DeckInput, link: DeckLink) {
  const from = input.blocks.find((block) => block.id === link.from);
  const to = input.blocks.find((block) => block.id === link.to);
  const code = link.code ? ` · code "${quote(link.code)}"` : link.hasCode ? ' · has code' : '';
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
  const tuning = input.scaleName ? ` · ${input.scaleName}${input.rootHz ? ` · ${rootName(input.rootHz)}` : ''}` : '';
  const lines = [`${input.canvasName} · ${input.bpm} bpm · ${state}${input.recording ? ' · recording' : ''}${input.snap ? ' · snap ¼' : ''}${tuning}`];
  const canvases = canvasLine(input);
  if (canvases) lines.push(canvases);
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
  const waves = input.waves ?? [];
  if (waves.length) {
    lines.push('');
    lines.push('Waves (a cycle replaces a tone, a motion bends a filter; width is the loop):');
    for (const wave of waves) {
      const center = wave.points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
      const at = { x: center.x / wave.points.length, y: center.y / wave.points.length };
      const who = wave.instrument ? blockName(wave.instrument) : 'the region tone';
      const width = Math.max(...wave.points.map((point) => point.x)) - Math.min(...wave.points.map((point) => point.x));
      const points = wave.points.map((point) => `${place(point.x)},${place(point.y)}`).join(' ');
      lines.push(`- ${wave.id} · ${wave.role} · ${who} · ${beatCount(width / PX_PER_BEAT)} wide · at ${place(at.x)}, ${place(at.y)} · points ${points}`);
    }
  }
  const takes = input.takes ?? [];
  if (takes.length) {
    lines.push('');
    lines.push('Takes (a recorded performance; place puts it on the canvas as linked blocks):');
    for (const take of takes) lines.push(`- ${take.name} (${take.id}) · ${blockName(take.instrument)} · ${take.notes.length} ${take.notes.length === 1 ? 'note' : 'notes'}`);
  }
  if (input.bed !== undefined) {
    lines.push('');
    lines.push(bedLine(input.bed, input.bpm));
  }
  lines.push('');
  lines.push('Right is +x. Down the canvas is +y. Moving a block changes how long its links take.');
  return lines.join('\n');
}

function canvasLine(input: DeckInput) {
  const list = input.canvases;
  if (!list?.length) return '';
  const bits = list.map((canvas) => {
    const open = input.canvasId ? canvas.id === input.canvasId : canvas.name === input.canvasName;
    return `${canvas.name} (${canvas.id}${open ? ', open' : ''})`;
  });
  return `Canvases: ${bits.join(', ')}`;
}

function bedLine(bed: DeckBed | null, bpm: number) {
  if (!bed) return 'Background: none. Load a file in the browser to play one behind the piece.';
  const missing = bed.missing ? ' · missing from this browser' : '';
  const lines = [`Background: ${bed.name} · level ${Math.round(bed.level * 100)}% · ${Math.round(bed.duration * 10) / 10} s${missing}`];
  if (!bed.clips.length) lines.push('- no cuts. bed whole uses the whole file.');
  const secondsPerBeat = bpm > 0 ? 60 / bpm : 0;
  for (const clip of bed.clips) {
    const long = secondsPerBeat > 0 ? beatCount(clip.seconds / secondsPerBeat) : `${clip.seconds} s`;
    const gain = clip.gain < 0.999 ? ` · gain ${Math.round(clip.gain * 100)}%` : '';
    const fades = clip.fadeIn > 0.001 || clip.fadeOut > 0.001 ? ` · fade ${Math.round(clip.fadeIn * 100) / 100}s/${Math.round(clip.fadeOut * 100) / 100}s` : '';
    lines.push(`- ${clip.id} · at ${beatCount(clip.beat)} · ${long}${clip.mute ? ' · muted' : ''}${gain}${fades}`);
  }
  return lines.join('\n');
}
