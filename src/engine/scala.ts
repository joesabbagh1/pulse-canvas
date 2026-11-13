import { degreeCents, type Scale } from './tuning';

// Scala (.scl) is the common file format for tunings; the Scala archive alone
// has thousands. A file is: "!" comment lines, a description line (which may be
// empty), the number of pitches, then one pitch per line, either in cents (any
// number with a ".") or as a ratio ("3/2", or "2" for 2/1). Anything after the
// pitch on its line is ignored. The 1/1 at the bottom is implied, and the last
// pitch is the period the scale repeats at, usually the 2/1 octave.
// https://www.huygens-fokker.org/scala/scl_format.html

function pitchCents(token: string, line: number): number {
  if (token.includes('.')) {
    const cents = Number(token);
    if (Number.isFinite(cents)) return cents;
  } else {
    const ratio = /^(\d+)(?:\/(\d+))?$/.exec(token);
    const num = ratio && Number(ratio[1]);
    const den = ratio && Number(ratio[2] ?? 1);
    if (num && den) return 1200 * Math.log2(num / den);
  }
  throw new Error(`pitch ${line}, "${token}", is neither cents nor a ratio.`);
}

// Imported scales are named by their content, so importing the same file twice
// gives the same scale rather than a duplicate.
function contentId(name: string, cents: number[], period: number) {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify([name, cents, period])) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return `scl-${(h >>> 0).toString(36)}`;
}

/** Throws an Error whose message says what is wrong with the file. */
export function parseScala(text: string, fallbackName: string): Scale {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => !l.startsWith('!'));
  const description = (lines[0] ?? '').trim();
  const rest = lines
    .slice(1)
    .map((l) => l.trim().split(/\s+/)[0])
    .filter(Boolean);
  const count = Number(rest[0]);
  if (!Number.isInteger(count) || count < 1) throw new Error('it has no pitch count after the description.');
  if (rest.length - 1 < count) throw new Error(`it promises ${count} pitches but lists ${rest.length - 1}.`);

  const pitches = rest.slice(1, count + 1).map((token, i) => pitchCents(token, i + 1));
  const period = pitches[count - 1];
  if (!(period > 0)) throw new Error('its last pitch, the period it repeats at, must be above 1/1.');
  const name = description || fallbackName;
  const cents = [0, ...pitches.slice(0, -1)];
  return { id: contentId(name, cents, period), name, cents, period };
}

// A Scala keyboard mapping (.kbm) says which MIDI key plays which scale degree
// and pins one key to a frequency. Blocks here are already scale degrees, so
// only the pinned pitch matters: it sets the frequency of degree 0, the root.
// The header is seven numbers: map size, first and last key, middle key (the
// one playing degree 0), reference key, its frequency, and the formal octave
// in degrees. Then come `map size` entries, each a degree or "x" for unmapped.
// https://www.huygens-fokker.org/scala/help.htm#mappings

/** The root frequency a .kbm file gives `scale`. Throws an Error saying what is wrong. */
export function parseKbm(text: string, scale: Scale): number {
  const values = text
    .split(/\r\n|\r|\n/)
    .filter((l) => !l.startsWith('!'))
    .map((l) => l.trim().split(/\s+/)[0])
    .filter(Boolean);
  if (values.length < 7) throw new Error('it needs seven header lines, from map size to formal octave.');
  const [size, , , middle, reference, hz, formalOctave] = values.slice(0, 7).map(Number);
  if (!Number.isInteger(size) || size < 0) throw new Error('its map size must be a whole number.');
  if (!Number.isInteger(middle) || !Number.isInteger(reference)) throw new Error('its middle and reference keys must be whole numbers.');
  if (!(hz > 0)) throw new Error('its reference frequency must be above 0 Hz.');
  const mapping = values.slice(7, 7 + size);
  if (mapping.length < size) throw new Error(`it promises ${size} mapping entries but lists ${mapping.length}.`);

  // Which degree the reference key plays: one step per key when the map is
  // empty, otherwise through the mapping, a formal octave per repeat.
  const offset = reference - middle;
  let degree = offset;
  if (size > 0) {
    const entry = mapping[((offset % size) + size) % size];
    if (entry === 'x') throw new Error(`its reference key, ${reference}, isn't mapped to a degree.`);
    degree = Number(entry) + Math.floor(offset / size) * (formalOctave || scale.cents.length);
    if (!Number.isInteger(degree)) throw new Error(`mapping entry "${entry}" isn't a degree or "x".`);
  }
  return hz / 2 ** (degreeCents(degree, scale) / 1200);
}
