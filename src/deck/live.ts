// Playing an instrument by hand, and the two recordings: a WAV of everything
// heard, and a take that can be laid on the canvas as linked blocks.

import { blockName, renderScene, type DeckInput } from './scene';
import { resolveKind } from './build';
import type { DeckEffect, DeckPlan } from './effects';
import { MAX_TAKES, MAX_TAKE_BEATS, MAX_TAKE_NOTES, clipTake, defaultTakeName, type Take, type TakeNote } from '../takes';

const OPS = new Set(['play_instrument', 'record', 'take']);

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

interface PlayNote {
  degree: number;
  beats: number;
  at: number;
  velocity: number;
}

function instrumentOf(ref: unknown): { id: string } | { error: string } {
  if (typeof ref !== 'string' || !ref.trim()) return { error: 'Say which instrument.' };
  const kind = resolveKind(ref);
  if ('error' in kind) return kind;
  if (kind.id === 'start' || kind.id === 'pattern') return { error: 'That is not an instrument. catalog lists them.' };
  return kind;
}

function playNotes(raw: unknown): PlayNote[] | string {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : null;
  if (!list?.length) return 'Say the notes to play: a degree and how many beats to hold it.';
  if (list.length > MAX_TAKE_NOTES) return `A phrase holds at most ${MAX_TAKE_NOTES} notes.`;
  const notes: PlayNote[] = [];
  let cursor = 0;
  for (const item of list) {
    if (typeof item !== 'object' || item === null) return 'Each note needs a degree and a length in beats.';
    const note = item as Record<string, unknown>;
    const degree = num(note.degree, 'Degree', -200, 200);
    if (typeof degree === 'string') return degree;
    const beats = num(note.beats, 'Length', 1 / 16, MAX_TAKE_BEATS);
    if (typeof beats === 'string') return beats;
    const at = note.at === undefined ? cursor : num(note.at, 'At', 0, MAX_TAKE_BEATS);
    if (typeof at === 'string') return at;
    if (at + beats > MAX_TAKE_BEATS) return `A phrase stays inside ${MAX_TAKE_BEATS} beats.`;
    const velocity = note.velocity === undefined ? 1 : num(note.velocity, 'Velocity', 0, 1);
    if (typeof velocity === 'string') return velocity;
    notes.push({ degree: Math.round(degree), beats, at, velocity });
    cursor = at + beats;
  }
  return notes;
}

function playInstrument(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  const instrument = instrumentOf(command.instrument);
  if ('error' in instrument) return { error: instrument.error };
  const raw = command.notes ?? (command.degree !== undefined ? { degree: command.degree, beats: command.beats ?? 1, at: command.at, velocity: command.velocity } : undefined);
  const notes = playNotes(raw);
  if (typeof notes === 'string') return { error: notes };
  const end = Math.max(...notes.map((note) => note.at + note.beats));
  const line = notes.map((note) => `degree ${note.degree} for ${note.beats} at ${note.at}`).join(', ');
  return done(input, [{ type: 'playNotes', instrument: instrument.id, notes }], `Playing ${blockName(instrument.id)}: ${line}. The phrase lasts ${end} beats.`);
}

function record(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  const action = command.action;
  if (action !== 'start' && action !== 'stop') return { error: 'Record action is "start" or "stop".' };
  if (action === 'start') {
    if (input.recording) return done(input, [], 'Already recording.');
    const next = { ...input, recording: true, playing: true, beat: input.playing ? input.beat : 0 };
    return done(next, [{ type: 'recordStart' }], 'Recording. Playback is running so the first notes are caught. Stop it to download the WAV.');
  }
  if (!input.recording) return { error: 'Nothing is recording.' };
  return done({ ...input, recording: false }, [{ type: 'recordStop' }], 'Recording stopped. The WAV file is downloading.');
}

function takeNotes(raw: unknown, snap: boolean): TakeNote[] | string {
  if (!Array.isArray(raw) || !raw.length) return 'A take needs notes: beat, degree, and beats.';
  const notes: TakeNote[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return 'Each note needs a beat, a degree, and a length.';
    const note = item as Record<string, unknown>;
    const beat = num(note.beat, 'Beat', 0, MAX_TAKE_BEATS);
    if (typeof beat === 'string') return beat;
    const degree = num(note.degree, 'Degree', -200, 200);
    if (typeof degree === 'string') return degree;
    const beats = num(note.beats, 'Length', 1 / 16, MAX_TAKE_BEATS);
    if (typeof beats === 'string') return beats;
    const velocity = note.velocity === undefined ? 1 : num(note.velocity, 'Velocity', 0, 1);
    if (typeof velocity === 'string') return velocity;
    notes.push({ beat, degree, beats, velocity });
  }
  const clipped = clipTake(notes, snap);
  if (!clipped.length) return 'Those notes are outside the take, which holds 32 beats.';
  return clipped;
}

function findTake(input: DeckInput, ref: string): Take | string {
  const takes = input.takes ?? [];
  const query = ref.trim().toLowerCase();
  const found = takes.filter((take) => take.id === ref || take.name.toLowerCase() === query);
  if (found.length === 1) return found[0];
  if (found.length > 1) return `"${ref}" matches more than one take. Say the id.`;
  return `No take called "${ref}".`;
}

function take(input: DeckInput, command: Record<string, unknown>): DeckPlan {
  if (typeof command.place === 'string' && command.place.trim() && command.notes === undefined) {
    const found = findTake(input, command.place);
    if (typeof found === 'string') return { error: found };
    if (!found.notes.length) return { error: `${found.name} has no notes to place.` };
    return done(input, [{ type: 'placeTake', take: found }], `Placed ${found.name} on the canvas.`);
  }

  const instrument = instrumentOf(command.instrument);
  if ('error' in instrument) return { error: instrument.error };
  const notes = takeNotes(command.notes, input.snap);
  if (typeof notes === 'string') return { error: notes };
  const takes = input.takes ?? [];
  if (takes.length >= MAX_TAKES) return { error: `${MAX_TAKES} takes is the limit. Place or leave one before recording another.` };
  const saved: Take = {
    id: freshId('take', takes.map((item) => item.id)),
    name: typeof command.name === 'string' && command.name.trim() ? command.name.trim().slice(0, 80) : defaultTakeName(blockName(instrument.id), takes, instrument.id),
    instrument: instrument.id,
    notes,
  };
  const next = { ...input, takes: [...takes, saved] };
  const effects: DeckEffect[] = [{ type: 'saveTake', take: saved }];
  let lead = `Saved take ${saved.name} (${saved.id}), ${saved.notes.length} ${saved.notes.length === 1 ? 'note' : 'notes'} on ${blockName(instrument.id)}.`;
  if (command.place === true) {
    effects.push({ type: 'placeTake', take: saved });
    lead += ' Placed it on the canvas.';
  }
  return done(next, effects, lead);
}

/** Null when this is not a playing or recording command. */
export function live(input: DeckInput, command: Record<string, unknown>): DeckPlan | null {
  const op = command.op;
  if (typeof op !== 'string' || !OPS.has(op)) return null;
  if (op === 'play_instrument') return playInstrument(input, command);
  if (op === 'record') return record(input, command);
  return take(input, command);
}
