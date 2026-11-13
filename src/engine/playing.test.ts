import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from './instruments';
import { degreeCents, ROOT_HZ, scaleById } from './tuning';
import {
  PLAYING,
  degreeForKey,
  hintFor,
  initialFocus,
  midiHz,
  notesInRange,
  shiftFocus,
  stringStops,
  windowNotes,
  type Playing,
} from './playing';

function span(playing: Playing): { low: number; high: number } | null {
  return 'low' in playing ? { low: playing.low, high: playing.high } : null;
}

describe('playing surfaces', () => {
  it('gives every instrument one surface', () => {
    const ids = INSTRUMENTS.map((instrument) => instrument.id).sort();
    expect(Object.keys(PLAYING).sort()).toEqual(ids);
  });

  it('keeps ranges inside MIDI and hearing, and open strings inside the range', () => {
    for (const playing of Object.values(PLAYING)) {
      const range = span(playing);
      if (!range) continue;
      expect(range.low).toBeGreaterThanOrEqual(0);
      expect(range.high).toBeLessThanOrEqual(127);
      expect(range.low).toBeLessThanOrEqual(range.high);
      expect(midiHz(range.low)).toBeGreaterThanOrEqual(20);
      expect(midiHz(range.high)).toBeLessThanOrEqual(16000);
      if ('strings' in playing) {
        for (const open of playing.strings) {
          expect(open).toBeGreaterThanOrEqual(range.low);
          expect(open).toBeLessThanOrEqual(range.high);
        }
      }
    }
  });

  it('lists every scale degree inside a violin, and none outside it', () => {
    const major = scaleById('major');
    const notes = notesInRange(major, ROOT_HZ, 55, 100);
    expect(notes.some((note) => note.name === 'G' && note.octave === 3)).toBe(true);
    expect(notes.some((note) => note.name === 'E' && note.octave === 7)).toBe(true);
    expect(notes.some((note) => note.name === 'F' && note.octave === 3)).toBe(false);
    expect(notes.some((note) => note.name === 'F' && note.octave === 7)).toBe(false);

    const penta = notesInRange(scaleById('major-penta'), ROOT_HZ, 55, 100);
    expect(penta.length).toBeLessThan(notes.length);
    expect(penta.some((note) => note.name === 'G' && note.octave === 3)).toBe(true);
    expect(penta.some((note) => note.name === 'F' && note.octave === 4)).toBe(false);
    for (const note of penta) {
      expect(note.hz).toBeGreaterThanOrEqual(midiHz(55) * 2 ** (-1 / 1200));
      expect(note.hz).toBeLessThanOrEqual(midiHz(100) * 2 ** (1 / 1200));
    }
  });

  it('keeps a bayati note that sits about 150 cents off the root', () => {
    const bayati = scaleById('bayati');
    const notes = notesInRange(bayati, ROOT_HZ, 60, 96);
    expect(notes.some((note) => Math.abs(degreeCents(note.degree, bayati) - 150) < 5)).toBe(true);
  });

  it('puts every violin note on at least one string', () => {
    const notes = notesInRange(scaleById('major'), ROOT_HZ, 55, 100);
    const stops = stringStops([55, 62, 69, 76], notes);
    const played = new Set(stops.map((stop) => stop.note.degree));
    for (const note of notes) expect(played.has(note.degree)).toBe(true);
  });

  it('maps the home row onto the focused octave, in scale order', () => {
    const major = scaleById('major');
    const notes = notesInRange(major, ROOT_HZ, 55, 100);
    expect(initialFocus(notes, major)).toBe(0);
    const window = windowNotes(notes, 0, major);
    expect(window.length).toBeGreaterThan(0);
    expect(degreeForKey('a', 0, major, notes)).toBe(window[0].degree);
    expect(hintFor(window[0].degree, 0, major, notes)).toBe('A');
    expect(degreeForKey('s', 0, major, notes)).toBe(window[1].degree);
    const up = shiftFocus(0, major, notes, 1);
    expect(up).toBe(7);
    expect(windowNotes(notes, up, major)[0].degree).toBeGreaterThanOrEqual(7);
    expect(shiftFocus(up, major, notes, -1)).toBe(0);
    expect(degreeForKey('z', 0, major, notes)).toBeNull();
  });
});
