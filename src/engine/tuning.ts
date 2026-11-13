// Pitch is always stored as a scale degree. It only becomes a frequency at
// the moment a sound is played, so any tuning system is just data: a list of
// cents offsets within one period (usually the 1200-cent octave).

export interface Scale {
  id: string;
  name: string;
  cents: number[];
  period: number;
}

export const SCALES: Scale[] = [
  { id: 'major-penta', name: 'Major pentatonic', cents: [0, 200, 400, 700, 900], period: 1200 },
  { id: 'minor-penta', name: 'Minor pentatonic', cents: [0, 300, 500, 700, 1000], period: 1200 },
  { id: 'major', name: 'Major', cents: [0, 200, 400, 500, 700, 900, 1100], period: 1200 },
  // Quarter-tone (24-TET) approximations; real performance inflects these.
  { id: 'rast', name: 'Maqam Rast (24-TET approx.)', cents: [0, 200, 350, 500, 700, 900, 1050], period: 1200 },
  { id: 'bayati', name: 'Maqam Bayati (24-TET approx.)', cents: [0, 150, 300, 500, 700, 800, 1000], period: 1200 },
];

export const DEFAULT_SCALE_ID = 'major-penta';
export const ROOT_HZ = 261.6256; // C4

/** A scale, and the frequency its degree 0 sounds at. */
export interface Tuning {
  scale: Scale;
  rootHz: number;
}

/** `library` is every scale on offer: the built-in ones plus any imported. */
export function scaleById(id: string, library: readonly Scale[] = SCALES): Scale {
  return library.find((s) => s.id === id) ?? SCALES[0];
}

/** Total cents above the root for a (possibly negative) scale degree. */
export function degreeCents(degree: number, scale: Scale): number {
  const n = scale.cents.length;
  const octave = Math.floor(degree / n);
  const index = ((degree % n) + n) % n;
  return octave * scale.period + scale.cents[index];
}

export function degreeToHz(degree: number, scale: Scale, rootHz = ROOT_HZ): number {
  return rootHz * 2 ** (degreeCents(degree, scale) / 1200);
}

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Cents from C4 to a frequency. */
export const centsFromC4 = (hz: number) => 1200 * Math.log2(hz / ROOT_HZ);

/** Nearest 12-TET name for a pitch, plus how far off it is in cents. */
export function describePitch(degree: number, scale: Scale, rootHz = ROOT_HZ) {
  const inScale = degreeCents(degree, scale);
  const cents = inScale + centsFromC4(rootHz);
  const semis = Math.round(cents / 100);
  return {
    name: NOTE_NAMES[((semis % 12) + 12) % 12],
    octave: 4 + Math.floor(semis / 12),
    offset: Math.round(cents - semis * 100),
    // Colour follows the degree's place in the scale, whatever the root.
    pitchClass: (((inScale % scale.period) + scale.period) % scale.period) / scale.period,
  };
}

// Roots offered as keys: the twelve 12-TET notes from F♯3 up to F4, so
// changing key keeps a piece in roughly the same register.
export const KEYS = NOTE_NAMES.map((name, i) => {
  const semis = i > 5 ? i - 12 : i;
  return { name, hz: ROOT_HZ * 2 ** (semis / 12) };
});

/** The key a root is, if it is one of them to within half a cent. */
export function keyOf(rootHz: number) {
  return KEYS.find((k) => Math.abs(centsFromC4(rootHz) - centsFromC4(k.hz)) < 0.5);
}
