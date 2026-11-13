import { BLOCK_SIZE, PX_PER_BEAT, type XY } from './engine/geometry';
import { degreeCents, degreeToHz, type Scale } from './engine/tuning';

// A take is one performance on the Instruments page: note-ons and note-offs
// in beats, at the piece tempo. It lives on the piece so a reload keeps it,
// and "Use on canvas" turns it into linked blocks.

export const MAX_TAKE_NOTES = 64;
export const MAX_TAKE_BEATS = 32;
export const MAX_TAKES = 32;

/** Where the first placed note sits, and how far the next row steps if that spot is taken. */
export const TAKE_ORIGIN_X = 80;
export const TAKE_ORIGIN_Y = 80;
export const TAKE_STAGGER_Y = 120;

export interface TakeNote {
  /** Start, in beats from the beginning of the take. */
  beat: number;
  /** Scale degree. 0 is the piece root. */
  degree: number;
  /** How long the key was held, in beats. */
  beats: number;
  /** 0 to 1, of full loudness. */
  velocity: number;
}

export interface Take {
  id: string;
  name: string;
  /** Instrument id. The block's kind when the take is placed. */
  instrument: string;
  notes: TakeNote[];
}

/** "Tone 1", then "Tone 2": the instrument's name plus how many takes it already has. */
export function defaultTakeName(instrumentName: string, takes: readonly { instrument: string }[], instrumentId: string): string {
  const count = takes.filter((take) => take.instrument === instrumentId).length + 1;
  return `${instrumentName} ${count}`;
}

/** 1/4 when snap is on, otherwise 1/16. Both grids divide a beat into a whole number of steps. */
export function snapBeat(beat: number, snap: boolean): number {
  const parts = snap ? 4 : 16;
  return Math.round(beat * parts) / parts;
}

/**
 * Quantize a performance onto the piece grid and keep it inside the caps.
 * Notes that start at 32 beats are dropped. A hold that runs past 32 is cut
 * to the grid line at the cap. A tap shorter than one grid step becomes one.
 */
export function clipTake(notes: readonly TakeNote[], snap: boolean): TakeNote[] {
  const step = snap ? 1 / 4 : 1 / 16;
  const out: TakeNote[] = [];
  for (const note of notes) {
    if (out.length >= MAX_TAKE_NOTES) break;
    if (!Number.isFinite(note.beat) || !Number.isFinite(note.beats) || !Number.isFinite(note.degree)) continue;
    const beat = snapBeat(Math.max(0, note.beat), snap);
    if (beat >= MAX_TAKE_BEATS) continue;
    let beats = snapBeat(Math.max(0, note.beats), snap);
    if (beats < step) beats = step;
    if (beat + beats > MAX_TAKE_BEATS) {
      const room = MAX_TAKE_BEATS - beat;
      beats = Math.floor(room / step + 1e-6) * step;
    }
    if (beats <= 0) continue;
    const velocity = Number.isFinite(note.velocity) ? Math.min(1, Math.max(0, note.velocity)) : 1;
    out.push({ beat, degree: Math.round(note.degree), beats, velocity });
  }
  return out;
}

/**
 * The scale degree a piano key plays.
 *
 * `semitone` is a chromatic step above the piece root: 0 is the root and 12
 * is one equal-tempered octave. Pitch is stored as a scale degree, and one
 * octave of the scale is `cents.length` degrees — 12 only when the scale has
 * 12 notes. The degree chosen is the one whose cents (`degreeCents`) sit
 * closest to that semitone, so an equal 12-note scale stays chromatic and
 * every other scale still gives every key, white or black, a note audition
 * can play. Ties keep the lower degree.
 */
export function keyDegree(semitone: number, scale: Scale): number {
  const steps = scale.cents.length;
  if (steps < 1 || !(scale.period > 0) || !Number.isFinite(semitone)) return 0;
  const target = semitone * 100;
  const reach = Math.ceil(Math.abs(target) / scale.period) + 1;
  const span = steps * reach + steps;
  let best = 0;
  let bestErr = Infinity;
  for (let degree = -span; degree <= span; degree++) {
    const err = Math.abs(degreeCents(degree, scale) - target);
    if (err < bestErr) {
      best = degree;
      bestErr = err;
    }
  }
  const hz = degreeToHz(best, scale);
  // A degree the synth would skip is no use. The semitone offset still sounds.
  if (!Number.isFinite(hz) || hz < 20 || hz > 16000) return Math.round(semitone);
  return best;
}

/**
 * A row of blocks. Each note's x is `origin + beat * PX_PER_BEAT`, so the
 * straight link to the next note lasts as many beats as the gap between them.
 * The row starts at (80, 80) and steps down while a block already occupies that spot.
 */
export function layoutTake(notes: readonly TakeNote[], occupied: readonly XY[]): { notes: TakeNote[]; positions: XY[] } {
  if (!notes.length) return { notes: [], positions: [] };
  let y = TAKE_ORIGIN_Y;
  let guard = 0;
  while (guard++ < 80 && occupied.some((block) => Math.hypot(block.x - TAKE_ORIGIN_X, block.y - y) < BLOCK_SIZE)) {
    y += TAKE_STAGGER_Y;
  }
  const ordered = notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.beat - b.note.beat || a.index - b.index)
    .map(({ note }) => note);
  return {
    notes: ordered,
    positions: ordered.map((note) => ({ x: TAKE_ORIGIN_X + note.beat * PX_PER_BEAT, y })),
  };
}
