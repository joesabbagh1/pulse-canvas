// The canvas list, examples, undo, the background lane, and a region's sample.
// The open piece is still the source of truth. Opening another canvas or
// stepping through history is applied first, then the page reads itself back.

import { MAX_BED_CLIPS, duplicateClip, moveClip, shapeClip, splitClip, trimClip, wholeClip, type Bed, type BedClip } from '../bed';
import { EXAMPLES } from '../examples';
import { canvasName } from '../library';
import { findRegions } from './plan';
import type { DeckEffect, DeckPlan } from './effects';
import { beatCount, renderScene, type DeckBed, type DeckBedClip, type DeckInput } from './scene';

const OPS = new Set(['open_canvas', 'rename_canvas', 'delete_canvas', 'examples', 'open_example', 'undo', 'redo', 'bed', 'sample']);

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

function done(input: DeckInput, effects: DeckEffect[], lead: string): DeckPlan {
  return { effects, text: `${lead}\n\n${renderScene(input)}` };
}

let cutSeq = 0;

function cutId(taken: readonly string[]) {
  const have = new Set(taken);
  let id = '';
  do {
    cutSeq += 1;
    id = `cut-${cutSeq}`;
  } while (have.has(id));
  return id;
}

function listOf(input: DeckInput) {
  return input.canvases ?? [];
}

function findCanvas(input: DeckInput, ref: string): { id: string; name: string } | string {
  const list = listOf(input);
  if (!list.length) return 'Look at the canvas first. The list of canvases comes back with it.';
  const query = fold(ref);
  if (!query) return 'Say which canvas.';
  const byId = list.filter((canvas) => canvas.id === ref || fold(canvas.id) === query);
  if (byId.length === 1) return byId[0];
  const byName = list.filter((canvas) => fold(canvas.name) === query);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return `"${ref}" matches ${byName.map((canvas) => `${canvas.name} (${canvas.id})`).join(' and ')}. Say which id.`;
  return `No canvas called "${ref}". Canvases: ${list.map((canvas) => canvas.name).join(', ')}.`;
}

function isOpen(input: DeckInput, canvas: { id: string; name: string }) {
  return input.canvasId ? canvas.id === input.canvasId : canvas.name === input.canvasName;
}

function openCanvas(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.canvas !== 'string') return { error: 'Say which canvas to open.' };
  const canvas = findCanvas(input, command.canvas);
  if (typeof canvas === 'string') return { error: canvas };
  if (isOpen(input, canvas)) return { effects: [], text: `${canvas.name} is already open.\n\n${renderScene(input)}` };
  return { effects: [{ type: 'openCanvas', id: canvas.id }], text: `Opened ${canvas.name}.`, reread: true };
}

function renameCanvas(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  const ref = typeof command.canvas === 'string' && command.canvas.trim() ? command.canvas : (input.canvasId ?? input.canvasName);
  const canvas = findCanvas(input, ref);
  if (typeof canvas === 'string') return { error: canvas };
  if (typeof command.name !== 'string' || !command.name.trim()) return { error: 'Say the new name.' };
  const name = canvasName(command.name, canvas.name);
  if (name === canvas.name) return { effects: [], text: `${canvas.name} already has that name.\n\n${renderScene(input)}` };
  const canvases = listOf(input).map((item) => (item.id === canvas.id ? { ...item, name } : item));
  const next = { ...input, canvases, ...(isOpen(input, canvas) ? { canvasName: name } : {}) };
  return done(next, [{ type: 'renameCanvas', id: canvas.id, name }], `Renamed ${canvas.name} to ${name}.`);
}

function deleteCanvas(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  const ref = typeof command.canvas === 'string' && command.canvas.trim() ? command.canvas : (input.canvasId ?? input.canvasName);
  const canvas = findCanvas(input, ref);
  if (typeof canvas === 'string') return { error: canvas };
  const last = listOf(input).length <= 1;
  const open = isOpen(input, canvas);
  const lead = last
    ? `Deleted ${canvas.name}. A blank canvas takes its place.`
    : open
      ? `Deleted ${canvas.name}.`
      : `Deleted ${canvas.name}. ${input.canvasName} stays open.`;
  return { effects: [{ type: 'deleteCanvas', id: canvas.id }], text: lead, reread: true };
}

function examples(): DeckPlan {
  const lines = ['Examples. open_example loads one into the canvas that is open. Undo brings the piece back.', ''];
  for (const example of EXAMPLES) {
    const sentence = example.description.split(/(?<=\.)\s/)[0];
    lines.push(`- ${example.id} · ${example.title} · ${example.tradition} · ${sentence}`);
  }
  return { effects: [], text: lines.join('\n') };
}

function matchExample(ref: string) {
  const query = fold(ref);
  const byId = EXAMPLES.filter((example) => example.id === ref || fold(example.id) === query);
  if (byId.length === 1) return byId[0];
  const byTitle = EXAMPLES.filter((example) => fold(example.title) === query);
  if (byTitle.length === 1) return byTitle[0];
  const partial = EXAMPLES.filter((example) => fold(example.title).includes(query) || fold(example.id).includes(query));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) return `"${ref}" matches ${partial.map((example) => example.title).join(' and ')}. Say which one.`;
  return `No example called "${ref}". examples lists them.`;
}

function openExample(command: Record<string, unknown>): DeckPlan {
  if (typeof command.example !== 'string' || !command.example.trim()) return { error: 'Say which example. examples lists them.' };
  const example = matchExample(command.example);
  if (typeof example === 'string') return { error: example };
  return {
    effects: [{ type: 'openExample', id: example.id }],
    text: `Opened ${example.title} into this canvas. Undo brings the piece back.`,
    reread: true,
  };
}

function history(input: DeckInput, direction: 'undo' | 'redo'): DeckPlan {
  const can = direction === 'undo' ? input.canUndo : input.canRedo;
  if (!can) return { error: direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.' };
  return { effects: [{ type: direction }], text: direction === 'undo' ? 'Undone.' : 'Redone.', reread: true };
}

function num(value: unknown, label: string, min: number, max: number): number | string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} needs a number.`;
  if (value < min || value > max) return `${label} is from ${min} to ${max}.`;
  return value;
}

function oneClip(bed: DeckBed, ref: unknown): DeckBedClip | string {
  if (ref === undefined) {
    if (bed.clips.length === 1) return bed.clips[0];
    if (!bed.clips.length) return 'The background has no cuts. Pass whole to use the whole file.';
    return `Say which cut: ${bed.clips.map((clip) => clip.id).join(', ')}.`;
  }
  if (typeof ref !== 'string' || !ref.trim()) return 'A cut is its id.';
  const query = fold(ref);
  const found = bed.clips.filter((clip) => clip.id === ref || fold(clip.id) === query);
  if (found.length === 1) return found[0];
  return found.length ? `"${ref}" matches more than one cut.` : `No cut called "${ref}". Cuts: ${bed.clips.map((clip) => clip.id).join(', ')}.`;
}

function toClip(clip: DeckBedClip): BedClip {
  return { ...clip };
}

function bedOf(bed: DeckBed, clips: DeckBedClip[], level = bed.level): Bed {
  return { sample: { id: bed.sampleId, name: bed.name }, duration: bed.duration, level, clips: clips.map(toClip) };
}

function bed(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (command.clear === true) {
    if (!input.bed) return { error: 'There is no background to remove.' };
    return done({ ...input, bed: null }, [{ type: 'setBed', bed: null }], `Removed the background ${input.bed.name}.`);
  }
  if (!input.bed) return { error: 'There is no background. Load a file in the browser first. The deck can then move, trim, split and mix the cuts.' };
  const structural = [command.split, command.duplicate, command.remove, command.whole].filter((value) => value === true).length;
  if (structural > 1) return { error: 'Split, duplicate, remove a cut, or use the whole file, one at a time.' };
  let level = input.bed.level;
  if (command.level !== undefined) {
    const next = num(command.level, 'level', 0, 1);
    if (typeof next === 'string') return { error: next };
    level = next;
  }
  if (command.whole === true) {
    const clip = wholeClip(input.bed.duration, cutId(input.bed.clips.map((item) => item.id)));
    const next = { ...input.bed, level, clips: [clip] };
    return done({ ...input, bed: next }, [{ type: 'setBed', bed: bedOf(next, next.clips) }], 'The background plays the whole file from beat 0.');
  }

  const shaping = command.beat !== undefined || command.trim !== undefined || command.mute !== undefined || command.gain !== undefined || command.fadeIn !== undefined || command.fadeOut !== undefined;
  if (structural === 0 && !shaping && command.level === undefined) return { error: 'Say what to change on the background.' };
  if ((command.split === true || command.duplicate === true || command.remove === true) && shaping) {
    return { error: 'Split, duplicate, or remove a cut on its own.' };
  }

  const clip = oneClip(input.bed, command.clip);
  if (typeof clip === 'string') {
    if (command.level !== undefined && !shaping && structural === 0) {
      const next = { ...input.bed, level };
      return done({ ...input, bed: next }, [{ type: 'setBed', bed: bedOf(next, next.clips) }], `Background level is ${Math.round(level * 100)}%.`);
    }
    return { error: clip };
  }

  if (command.remove === true) {
    const clips = input.bed.clips.filter((item) => item.id !== clip.id);
    const next = { ...input.bed, level, clips };
    return done({ ...input, bed: next }, [{ type: 'setBed', bed: bedOf(next, clips) }], `Removed cut ${clip.id}.`);
  }
  if (command.duplicate === true) {
    if (input.bed.clips.length >= MAX_BED_CLIPS) return { error: `${MAX_BED_CLIPS} cuts is the limit.` };
    const copy = duplicateClip(toClip(clip), 60 / input.bpm, cutId(input.bed.clips.map((item) => item.id)));
    const clips = [...input.bed.clips, copy];
    const next = { ...input.bed, level, clips };
    return done({ ...input, bed: next }, [{ type: 'setBed', bed: bedOf(next, clips) }], `Duplicated ${clip.id} as ${copy.id}, starting where the first ends.`);
  }

  let edited = toClip(clip);
  const notes: string[] = [];
  if (command.beat !== undefined) {
    const beat = num(command.beat, 'beat', 0, 100000);
    if (typeof beat === 'string') return { error: beat };
    edited = moveClip(edited, beat, input.snap);
    notes.push(`at ${beatCount(edited.beat)}`);
  }
  if (command.trim !== undefined) {
    if (command.trim !== 'start' && command.trim !== 'end') return { error: 'Trim is start or end.' };
    const delta = num(command.delta, 'delta', -100000, 100000);
    if (typeof delta === 'string') return { error: delta };
    edited = trimClip(edited, command.trim, delta, 60 / input.bpm, input.bed.duration, input.snap);
    notes.push(`trimmed the ${command.trim}`);
  }
  if (command.mute !== undefined || command.gain !== undefined || command.fadeIn !== undefined || command.fadeOut !== undefined) {
    if (command.mute !== undefined && typeof command.mute !== 'boolean') return { error: 'Mute is true or false.' };
    const gain = command.gain === undefined ? undefined : num(command.gain, 'gain', 0, 1);
    if (typeof gain === 'string') return { error: gain };
    const fadeIn = command.fadeIn === undefined ? undefined : num(command.fadeIn, 'fadeIn', 0, input.bed.duration);
    if (typeof fadeIn === 'string') return { error: fadeIn };
    const fadeOut = command.fadeOut === undefined ? undefined : num(command.fadeOut, 'fadeOut', 0, input.bed.duration);
    if (typeof fadeOut === 'string') return { error: fadeOut };
    edited = shapeClip(edited, {
      ...(typeof command.mute === 'boolean' ? { mute: command.mute } : {}),
      ...(gain !== undefined ? { gain } : {}),
      ...(fadeIn !== undefined ? { fadeIn } : {}),
      ...(fadeOut !== undefined ? { fadeOut } : {}),
    });
    if (typeof command.mute === 'boolean') notes.push(command.mute ? 'muted' : 'unmuted');
    if (gain !== undefined) notes.push(`gain ${Math.round(edited.gain * 100)}%`);
    if (fadeIn !== undefined || fadeOut !== undefined) notes.push('fades set');
  }
  if (command.split === true) {
    const secondsPerBeat = 60 / input.bpm;
    const into = input.playing ? (input.beat - clip.beat) * secondsPerBeat : clip.seconds / 2;
    const parts = splitClip(edited, into, secondsPerBeat, cutId(input.bed.clips.map((item) => item.id))) ?? splitClip(edited, clip.seconds / 2, secondsPerBeat, cutId([...input.bed.clips.map((item) => item.id), 'spare']));
    if (!parts) return { error: 'That cut is too short to split.' };
    const clips = input.bed.clips.flatMap((item) => (item.id === clip.id ? parts : [item]));
    const next = { ...input.bed, level, clips };
    return done({ ...input, bed: next }, [{ type: 'setBed', bed: bedOf(next, clips) }], `Split ${clip.id} into ${parts[0].id} and ${parts[1].id}.`);
  }
  if (!notes.length && command.level === undefined) return { error: 'Say what to change on the background.' };
  const clips = input.bed.clips.map((item) => (item.id === clip.id ? edited : item));
  const next = { ...input.bed, level, clips };
  const levelNote = command.level !== undefined ? `Background level is ${Math.round(level * 100)}%. ` : '';
  const clipNote = notes.length ? `${clip.id}: ${notes.join(', ')}.` : '';
  return done({ ...input, bed: next }, [{ type: 'setBed', bed: bedOf(next, clips) }], `${levelNote}${clipNote}`.trim());
}

function sample(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.region !== 'string' || !command.region.trim()) return { error: 'Say which region.' };
  const region = findRegions(input, command.region);
  if (region.length !== 1) {
    if (!input.regions.length) return { error: 'There are no regions. Add one, then give it a sample.' };
    if (region.length > 1) return { error: `"${command.region}" matches ${region.map((item) => item.name).join(' and ')}. Say which id.` };
    return { error: `No region called "${command.region}". Regions: ${input.regions.map((item) => item.name).join(', ')}.` };
  }
  const target = region[0];
  if (command.clear === true && command.from !== undefined) return { error: 'Clear the sample, or copy one.' };
  if (command.clear === true) {
    if (!target.sample) return { error: `${target.name} has no sample.` };
    const regions = input.regions.map((item) => (item.id === target.id ? { ...item, sample: undefined } : item));
    return done({ ...input, regions }, [{ type: 'regionSample', id: target.id, sample: null }], `Cleared the sample on ${target.name}. Its tones play the synth again.`);
  }
  if (typeof command.from !== 'string' || !command.from.trim()) return { error: 'Say which sample to copy: a region, or bed for the background. A new file is loaded from the browser.' };
  const from = fold(command.from);
  let picked: { id: string; name: string } | string;
  if (from === 'bed' || from === 'background') {
    if (!input.bed) picked = 'There is no background to copy.';
    else if (input.bed.missing) picked = `${input.bed.name} is missing from this browser.`;
    else picked = { id: input.bed.sampleId, name: input.bed.name };
  } else {
    const source = findRegions(input, command.from).filter((item) => item.id !== target.id);
    if (source.length !== 1) picked = source.length > 1 ? `"${command.from}" matches more than one region.` : `No region called "${command.from}" has a sample to copy.`;
    else if (!source[0].sample) picked = `${source[0].name} has no sample.`;
    else picked = source[0].sample;
  }
  if (typeof picked === 'string') return { error: picked };
  const regions = input.regions.map((item) => (item.id === target.id ? { ...item, sample: picked } : item));
  return done({ ...input, regions }, [{ type: 'regionSample', id: target.id, sample: picked }], `${target.name} plays "${picked.name}".`);
}

/** Null when this command is not about the library, examples, history, the background, or a sample. */
export function arrange(input: DeckInput, command: Record<string, unknown>): DeckPlan | null {
  const op = command.op;
  if (typeof op !== 'string' || !OPS.has(op)) return null;
  if (op === 'open_canvas') return openCanvas(input, command);
  if (op === 'rename_canvas') return renameCanvas(input, command);
  if (op === 'delete_canvas') return deleteCanvas(input, command);
  if (op === 'examples') return examples();
  if (op === 'open_example') return openExample(command);
  if (op === 'undo') return history(input, 'undo');
  if (op === 'redo') return history(input, 'redo');
  if (op === 'bed') return bed(input, command);
  return sample(input, command);
}
