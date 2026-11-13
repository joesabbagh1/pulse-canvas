import type { InstrumentId } from './instruments';
import { degreeCents, degreeToHz, describePitch, type Scale } from './tuning';

// How an instrument is played on the Instruments page, and the pitches it can
// actually sound. Ranges are sounding MIDI note numbers. C4 is 60.

export type HitVariant =
  | 'snare'
  | 'hat'
  | 'open-hat'
  | 'wood'
  | 'taiko'
  | 'reverse-cymbal'
  | 'clap'
  | 'crash'
  | 'ride'
  | 'tambourine'
  | 'cowbell'
  | 'shaker'
  | 'stick'
  | 'rain'
  | 'fret'
  | 'breath'
  | 'sea'
  | 'bird'
  | 'phone'
  | 'helicopter'
  | 'applause'
  | 'gun';

type KeyboardVariant = 'piano' | 'rhodes' | 'harpsichord' | 'clavinet' | 'organ' | 'accordion' | 'celesta';
type WindVariant =
  | 'flute'
  | 'piccolo'
  | 'recorder'
  | 'shakuhachi'
  | 'whistle'
  | 'clarinet'
  | 'sax'
  | 'oboe'
  | 'bassoon'
  | 'ocarina'
  | 'harmonica'
  | 'bagpipe'
  | 'shanai';
type BrassVariant = 'trumpet' | 'muted' | 'trombone' | 'tuba' | 'horn' | 'section';
type BarVariant = 'wood' | 'metal' | 'tube' | 'comb' | 'bells';
type HeadVariant = 'tom' | 'kick' | 'electronic';
type GridVariant = 'keys' | 'bass' | 'pad';

export type Playing =
  | { layout: 'keyboard'; low: number; high: number; variant: KeyboardVariant }
  | { layout: 'fingerboard'; low: number; high: number; strings: number[] }
  | { layout: 'fretboard'; low: number; high: number; strings: number[] }
  | { layout: 'strings'; low: number; high: number; variant: 'harp' | 'koto' | 'dulcimer' }
  | { layout: 'tongue'; low: number; high: number }
  | { layout: 'pipes'; low: number; high: number; variant: 'pan' | 'calliope' | 'bottle' }
  | { layout: 'wind'; low: number; high: number; variant: WindVariant }
  | { layout: 'brass'; low: number; high: number; variant: BrassVariant }
  | { layout: 'bars'; low: number; high: number; variant: BarVariant }
  | { layout: 'kalimba'; low: number; high: number }
  | { layout: 'pan'; low: number; high: number }
  | { layout: 'kettles'; low: number; high: number }
  | { layout: 'heads'; low: number; high: number; variant: HeadVariant }
  | { layout: 'stabs'; low: number; high: number }
  | { layout: 'grid'; low: number; high: number; variant: GridVariant }
  | { layout: 'buttons'; low: number; high: number }
  | { layout: 'staff'; low: number; high: number; syllable: string }
  | { layout: 'hit'; variant: HitVariant };

export interface PlayNote {
  degree: number;
  hz: number;
  /** Nearest sounding MIDI note, for layout. C4 is 60. */
  midi: number;
  name: string;
  octave: number;
  /** Cents off the nearest 12-tone note. 0 sits on a chromatic pitch. */
  offset: number;
}

export interface StringStop {
  /** Index into the instrument's `strings` array. */
  string: number;
  note: PlayNote;
  /** 0 at the open string, 1 at the highest stop on that string. */
  along: number;
}

const NATURALS = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

/** Home row, then the row above, in scale order. Not a chromatic piano map. */
export const PLAY_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'w', 'e', 't', 'y', 'u'] as const;

/** Frequency of a MIDI note number. C4 (60) is the piece's default root. */
export function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function keyboard(low: number, high: number, variant: KeyboardVariant): Playing {
  return { layout: 'keyboard', low, high, variant };
}
function fingerboard(low: number, high: number, strings: number[]): Playing {
  return { layout: 'fingerboard', low, high, strings };
}
function fretboard(low: number, high: number, strings: number[]): Playing {
  return { layout: 'fretboard', low, high, strings };
}
function wind(low: number, high: number, variant: WindVariant): Playing {
  return { layout: 'wind', low, high, variant };
}
function brass(low: number, high: number, variant: BrassVariant): Playing {
  return { layout: 'brass', low, high, variant };
}
function bars(low: number, high: number, variant: BarVariant): Playing {
  return { layout: 'bars', low, high, variant };
}
function grid(low: number, high: number, variant: GridVariant): Playing {
  return { layout: 'grid', low, high, variant };
}
function hit(variant: HitVariant): Playing {
  return { layout: 'hit', variant };
}

const GUITAR = [40, 45, 50, 55, 59, 64];
const BASS = [28, 33, 38, 43];
const VIOLIN = [55, 62, 69, 76];
const SECTION = [36, 43, 50, 57, 64, 69, 76];

const PIANO = keyboard(21, 108, 'piano');
const ORGAN = keyboard(36, 96, 'organ');
const GUITAR_BOARD = fretboard(40, 88, GUITAR);
const BASS_FRETS = fretboard(28, 67, BASS);
const BASS_BOARD = fingerboard(28, 67, BASS);
const SECTION_BOARD = fingerboard(36, 100, SECTION);
const LEAD = grid(48, 96, 'keys');
const PAD = grid(36, 84, 'pad');
const SYNTH_BASS = grid(28, 60, 'bass');

export const PLAYING = {
  piano: PIANO,
  'piano-bright': PIANO,
  'piano-electric': PIANO,
  'piano-honky': PIANO,
  epiano: keyboard(28, 88, 'rhodes'),
  'epiano-2': keyboard(28, 88, 'rhodes'),
  harpsichord: keyboard(29, 89, 'harpsichord'),
  clavinet: keyboard(29, 88, 'clavinet'),
  'organ-drawbar': ORGAN,
  'organ-percussive': ORGAN,
  'organ-rock': ORGAN,
  'organ-church': keyboard(24, 96, 'organ'),
  'organ-reed': ORGAN,
  khuur: fingerboard(53, 84, [53, 60]),
  violin: fingerboard(55, 100, VIOLIN),
  viola: fingerboard(48, 88, [48, 55, 62, 69]),
  cello: fingerboard(36, 81, [36, 43, 50, 57]),
  contrabass: fingerboard(28, 67, BASS),
  'strings-tremolo': SECTION_BOARD,
  strings: SECTION_BOARD,
  'strings-2': SECTION_BOARD,
  fiddle: fingerboard(55, 100, VIOLIN),
  pluck: fretboard(40, 88, [40]),
  jawharp: { layout: 'tongue', low: 55, high: 79 },
  'guitar-nylon': GUITAR_BOARD,
  'guitar-steel': GUITAR_BOARD,
  'guitar-jazz': GUITAR_BOARD,
  'guitar-clean': GUITAR_BOARD,
  'guitar-muted': GUITAR_BOARD,
  'guitar-overdrive': GUITAR_BOARD,
  'guitar-distortion': GUITAR_BOARD,
  'guitar-harmonics': GUITAR_BOARD,
  'bass-acoustic': BASS_BOARD,
  'bass-finger': BASS_FRETS,
  'bass-pick': BASS_FRETS,
  'bass-fretless': BASS_BOARD,
  'bass-slap': BASS_FRETS,
  'bass-slap-2': BASS_FRETS,
  pizzicato: fingerboard(36, 88, SECTION),
  harp: { layout: 'strings', low: 23, high: 102, variant: 'harp' },
  dulcimer: { layout: 'strings', low: 50, high: 86, variant: 'dulcimer' },
  sitar: fretboard(48, 84, [48, 55, 60, 62, 67]),
  banjo: fretboard(50, 86, [50, 55, 59, 62, 67]),
  shamisen: fretboard(48, 84, [48, 53, 60]),
  koto: { layout: 'strings', low: 62, high: 86, variant: 'koto' },
  accordion: keyboard(53, 93, 'accordion'),
  harmonica: wind(60, 96, 'harmonica'),
  'accordion-tango': { layout: 'buttons', low: 48, high: 93 },
  'sax-soprano': wind(56, 88, 'sax'),
  'sax-alto': wind(49, 80, 'sax'),
  'sax-tenor': wind(44, 76, 'sax'),
  'sax-baritone': wind(37, 68, 'sax'),
  oboe: wind(58, 91, 'oboe'),
  'english-horn': wind(52, 84, 'oboe'),
  bassoon: wind(34, 75, 'bassoon'),
  clarinet: wind(50, 94, 'clarinet'),
  piccolo: wind(74, 108, 'piccolo'),
  flute: wind(60, 96, 'flute'),
  recorder: wind(72, 98, 'recorder'),
  'pan-flute': { layout: 'pipes', low: 60, high: 96, variant: 'pan' },
  bottle: { layout: 'pipes', low: 60, high: 84, variant: 'bottle' },
  shakuhachi: wind(62, 89, 'shakuhachi'),
  whistle: wind(74, 98, 'whistle'),
  ocarina: wind(72, 89, 'ocarina'),
  bagpipe: wind(67, 81, 'bagpipe'),
  shanai: wind(60, 84, 'shanai'),
  trumpet: brass(54, 86, 'trumpet'),
  trombone: brass(40, 70, 'trombone'),
  tuba: brass(26, 65, 'tuba'),
  'trumpet-muted': brass(54, 86, 'muted'),
  horn: brass(35, 77, 'horn'),
  brass: brass(40, 86, 'section'),
  kick: { layout: 'heads', low: 24, high: 48, variant: 'kick' },
  snare: hit('snare'),
  hat: hit('hat'),
  celesta: keyboard(60, 108, 'celesta'),
  glockenspiel: bars(79, 108, 'metal'),
  'music-box': bars(72, 96, 'comb'),
  vibraphone: bars(53, 89, 'metal'),
  marimba: bars(45, 96, 'wood'),
  xylophone: bars(77, 108, 'wood'),
  bells: bars(60, 77, 'tube'),
  kalimba: { layout: 'kalimba', low: 60, high: 88 },
  'steel-drum': { layout: 'pan', low: 60, high: 89 },
  bell: bars(84, 108, 'bells'),
  agogo: bars(79, 84, 'bells'),
  timpani: { layout: 'kettles', low: 38, high: 60 },
  'tom-melodic': { layout: 'heads', low: 40, high: 64, variant: 'tom' },
  woodblock: hit('wood'),
  taiko: hit('taiko'),
  'synth-drum': { layout: 'heads', low: 36, high: 72, variant: 'electronic' },
  'cymbal-reverse': hit('reverse-cymbal'),
  'orchestra-hit': { layout: 'stabs', low: 36, high: 84 },
  'hat-open': hit('open-hat'),
  tom: { layout: 'heads', low: 40, high: 67, variant: 'tom' },
  clap: hit('clap'),
  crash: hit('crash'),
  ride: hit('ride'),
  tambourine: hit('tambourine'),
  cowbell: hit('cowbell'),
  shaker: hit('shaker'),
  sidestick: hit('stick'),
  choir: { layout: 'staff', low: 48, high: 84, syllable: 'ah' },
  'voice-oohs': { layout: 'staff', low: 48, high: 84, syllable: 'oh' },
  'synth-voice': { layout: 'staff', low: 48, high: 84, syllable: 'ah' },
  'lead-voice': { layout: 'staff', low: 48, high: 84, syllable: 'ah' },
  tone: grid(36, 96, 'keys'),
  bass: SYNTH_BASS,
  'bass-synth': SYNTH_BASS,
  'bass-synth-2': SYNTH_BASS,
  'synth-strings': grid(36, 96, 'keys'),
  'synth-strings-2': grid(36, 96, 'keys'),
  'brass-synth': grid(36, 86, 'keys'),
  'brass-synth-2': grid(36, 86, 'keys'),
  'lead-square': LEAD,
  'lead-saw': LEAD,
  'lead-calliope': { layout: 'pipes', low: 60, high: 96, variant: 'calliope' },
  'lead-chiff': LEAD,
  'lead-charang': LEAD,
  'lead-fifths': LEAD,
  'lead-bass': SYNTH_BASS,
  'pad-new-age': PAD,
  'pad-warm': PAD,
  'pad-poly': PAD,
  'pad-choir': PAD,
  'pad-bowed': PAD,
  'pad-metal': PAD,
  'pad-halo': PAD,
  'pad-sweep': PAD,
  'fx-rain': hit('rain'),
  'fx-soundtrack': PAD,
  'fx-crystal': bars(60, 96, 'metal'),
  'fx-atmosphere': PAD,
  'fx-brightness': LEAD,
  'fx-goblins': PAD,
  'fx-echoes': bars(60, 96, 'metal'),
  'fx-scifi': LEAD,
  'fret-noise': hit('fret'),
  breath: hit('breath'),
  seashore: hit('sea'),
  bird: hit('bird'),
  telephone: hit('phone'),
  helicopter: hit('helicopter'),
  applause: hit('applause'),
  gunshot: hit('gun'),
} satisfies { [K in InstrumentId]: Playing };

export function playingFor(id: string): Playing | undefined {
  return (PLAYING as Record<string, Playing>)[id];
}

/** A sharp, a flat, or a note that sits off 12-tone, so it draws as a raised key. */
export function isRaisedKey(note: PlayNote): boolean {
  return note.offset !== 0 || !NATURALS.has(note.name);
}

function inSpan(hz: number, lowHz: number, highHz: number): boolean {
  if (!(hz > 0) || !Number.isFinite(hz)) return false;
  const cents = 1200 * Math.log2(hz / lowHz);
  const top = 1200 * Math.log2(highHz / lowHz);
  return cents >= -1 && cents <= top + 1;
}

function toNote(degree: number, scale: Scale, rootHz: number, hz: number): PlayNote {
  const pitch = describePitch(degree, scale, rootHz);
  return {
    degree,
    hz,
    midi: Math.round(69 + 12 * Math.log2(hz / 440)),
    name: pitch.name,
    octave: pitch.octave,
    offset: pitch.offset,
  };
}

/**
 * Every scale degree whose sounding pitch falls inside the MIDI span.
 * A span that lands between two degrees keeps the nearest one, so the
 * surface is never empty.
 */
export function notesInRange(scale: Scale, rootHz: number, low: number, high: number): PlayNote[] {
  const steps = scale.cents.length;
  if (steps < 1 || !(scale.period > 0) || !(rootHz > 0)) return [];
  const lowHz = midiHz(Math.min(low, high));
  const highHz = midiHz(Math.max(low, high));
  const lowCents = 1200 * Math.log2(lowHz / rootHz);
  const highCents = 1200 * Math.log2(highHz / rootHz);
  const per = scale.period / steps;
  const start = Math.max(-4000, Math.floor(lowCents / per) - steps - 2);
  const end = Math.min(4000, Math.ceil(highCents / per) + steps + 2);
  const notes: PlayNote[] = [];
  let nearest = start;
  let nearestErr = Infinity;
  const mid = (lowCents + highCents) / 2;
  for (let degree = start; degree <= end; degree++) {
    const hz = degreeToHz(degree, scale, rootHz);
    const err = Math.abs(degreeCents(degree, scale) - mid);
    if (err < nearestErr) {
      nearest = degree;
      nearestErr = err;
    }
    if (inSpan(hz, lowHz, highHz)) notes.push(toNote(degree, scale, rootHz, hz));
  }
  if (notes.length) return notes;
  const hz = degreeToHz(nearest, scale, rootHz);
  return Number.isFinite(hz) && hz > 0 ? [toNote(nearest, scale, rootHz, hz)] : [];
}

const FIFTH = 2 ** (7 / 12);

/**
 * Stops on a fingerboard or fretboard. A note sits on every string at or
 * below it, up to a fifth past the next open string. The top string continues
 * to the top of the range. Every note appears at least once.
 */
export function stringStops(strings: readonly number[], notes: readonly PlayNote[]): StringStop[] {
  const opens = strings.map((midi) => midiHz(midi));
  const order = opens.map((hz, index) => ({ hz, index })).sort((a, b) => a.hz - b.hz);
  const chosen: { string: number; note: PlayNote }[] = [];
  for (const note of notes) {
    let placed = false;
    for (let i = 0; i < order.length; i++) {
      const next = order[i + 1]?.hz;
      const limit = next === undefined ? Infinity : next * FIFTH;
      if (note.hz >= order[i].hz * 2 ** (-1 / 1200) && note.hz <= limit * 2 ** (1 / 1200)) {
        chosen.push({ string: order[i].index, note });
        placed = true;
      }
    }
    if (!placed && order.length) chosen.push({ string: order[0].index, note });
  }
  const byString = new Map<number, { string: number; note: PlayNote }[]>();
  for (const stop of chosen) {
    const list = byString.get(stop.string) ?? [];
    list.push(stop);
    byString.set(stop.string, list);
  }
  const out: StringStop[] = [];
  for (const [string, list] of byString) {
    const open = opens[string];
    const cents = list.map((stop) => (open > 0 && stop.note.hz > 0 ? 1200 * Math.log2(stop.note.hz / open) : 0));
    const span = Math.max(1, ...cents);
    list.forEach((stop, i) => out.push({ string, note: stop.note, along: Math.max(0, cents[i]) / span }));
  }
  return out;
}

export function periodOf(degree: number, scale: Scale): number {
  const steps = Math.max(1, scale.cents.length);
  return Math.floor(degree / steps) * steps;
}

/** The scale octave that contains the root, or the lowest octave in range. */
export function initialFocus(notes: readonly PlayNote[], scale: Scale): number {
  const steps = Math.max(1, scale.cents.length);
  if (notes.some((note) => note.degree >= 0 && note.degree < steps)) return 0;
  if (!notes.length) return 0;
  return periodOf(notes[0].degree, scale);
}

export function windowNotes(notes: readonly PlayNote[], focus: number, scale: Scale): PlayNote[] {
  const steps = Math.max(1, scale.cents.length);
  return notes.filter((note) => note.degree >= focus && note.degree < focus + steps);
}

/** Move to the next scale octave that still has a note. Z is down, X is up. */
export function shiftFocus(focus: number, scale: Scale, notes: readonly PlayNote[], direction: -1 | 1): number {
  const starts = [...new Set(notes.map((note) => periodOf(note.degree, scale)))].sort((a, b) => a - b);
  if (direction < 0) {
    const lower = starts.filter((start) => start < focus);
    return lower.length ? lower[lower.length - 1] : focus;
  }
  const higher = starts.find((start) => start > focus);
  return higher ?? focus;
}

export function degreeForKey(key: string, focus: number, scale: Scale, notes: readonly PlayNote[]): number | null {
  const index = PLAY_KEYS.indexOf(key.toLowerCase() as (typeof PLAY_KEYS)[number]);
  if (index < 0) return null;
  return windowNotes(notes, focus, scale)[index]?.degree ?? null;
}

export function hintFor(degree: number, focus: number, scale: Scale, notes: readonly PlayNote[]): string | null {
  const index = windowNotes(notes, focus, scale).findIndex((note) => note.degree === degree);
  if (index < 0 || index >= PLAY_KEYS.length) return null;
  return PLAY_KEYS[index].toUpperCase();
}

const LAYOUT_LINE: Record<Playing['layout'], string> = {
  keyboard: 'The keys run across the instrument’s range.',
  fingerboard: 'Each string is stopped where that note sits.',
  fretboard: 'Frets follow the scale along each string.',
  strings: 'Each string is one note.',
  tongue: 'The tongue plays the notes of the jaw harp.',
  pipes: 'Each pipe is one note. Longer is lower.',
  wind: 'Each hole is one note, low toward the bell.',
  brass: 'Each mark is one note.',
  bars: 'Each bar is one note. Longer is lower.',
  kalimba: 'The longest tine, in the center, is the lowest note.',
  pan: 'Notes sit in rings on the drum. The center is highest.',
  kettles: 'Each kettle is one note. Larger is lower.',
  heads: 'Each head is one note. Larger is lower.',
  stabs: 'Each stab is one note.',
  grid: 'A column is one step of the scale. A row is an octave.',
  buttons: 'Each button is one note, in scale order.',
  staff: 'Each note head is one pitch you can sing.',
  hit: 'Tap the instrument.',
};

export function playingHint(playing: Playing): string {
  if (playing.layout === 'hit' || playing.layout === 'heads') {
    const line = playing.layout === 'hit' ? LAYOUT_LINE.hit : LAYOUT_LINE.heads;
    return `${line} A S D F G H J K and W E T Y U play it too. A tap plays the whole hit.`;
  }
  return `${LAYOUT_LINE[playing.layout]} A S D F G H J K W E T Y U play this octave of the scale. Z and X move the octave. The note sounds while the key is held.`;
}
