import { BLOCK_SIZE, PX_PER_BEAT } from './engine/geometry';
import { ROOT_HZ, type Scale } from './engine/tuning';
import { backbeat, bassPulse, phraseLoop, songStart, waltz, type Note } from './melody';
import { demoPiece, type Piece } from './piece';

// Ready-made patches, each in a different tradition's tuning. The non-western
// scales are transcriptions from the Huygens-Fokker Scala archive (kept in
// scales/); their ids are the content ids parseScala would give them, so
// importing the same .scl file later lands on the same scale, not a duplicate.

const RAST: Scale = {
  // scales/arabic_rast_on_c.scl — Dr. Ozan Yarman. The 3rd and 7th are the
  // half-flat notes (e.g. E half-flat) that give maqam rast its color; the
  // 1203.9-cent period is the stretched octave of the measured source.
  id: 'scl-8ngref',
  name: 'Arabic Rast with perde rast on C by Dr. Ozan Yarman',
  cents: [0, 199.98, 354.55, 501.98, 701.96, 901.93, 1003.8, 1056.5],
  period: 1203.93,
};

const CHAHARGAH: Scale = {
  // scales/chahargah3.scl — Julien J. Weiss. Dastgah Chahargah: the 138.6-cent
  // second and 840.5-cent sixth are just intonation's 13:12 and 13:8.
  id: 'scl-136ap2a',
  name: 'Iranian Chahargah, Julien J. Weiss',
  cents: [0, 138.57, 386.31, 498.04, 701.96, 840.53, 1088.27],
  period: 1200,
};

const SHUR: Scale = {
  // scales/schulter_shur17.scl — M. Schulter. A 17-note thirdtone set covering
  // the dastgah-ha; the melody below traces shur's low neutral tetrachord.
  id: 'scl-ni90sf',
  name: 'Peppermint 17-note thirdtone set for Persian dastgah-ha',
  cents: [0, 69.99, 128.67, 208.19, 287.71, 357.7, 416.38, 495.9, 565.89, 624.57, 704.1, 774.09, 832.76, 912.29, 991.81, 1061.8, 1120.48],
  period: 1200,
};

const KHOOMEI: Scale = {
  // scales/khoomei_harmonics_8_16.scl — harmonics 8..16, the segment throat
  // singers filter out of the drone. Degrees 2 and 4 are the 11th and 13th
  // harmonics, the "blue" notes of sygyt melodies.
  id: 'scl-ev7t6d',
  name: 'Khoomei harmonics 8-16',
  cents: [0, 203.9, 386.31, 551.32, 701.96, 840.53, 968.83, 1088.27],
  period: 1200,
};

const chain = (ids: string[]) => ids.slice(1).map((to, i) => ({ id: `${ids[i]}>${to}`, from: ids[i], to }));

const run = (degrees: number[], beats: number): Note[] => degrees.map((degree) => ({ degree, beats }));

/** A region wrapped around these blocks, one block's width of margin past their centres. */
function around(blocks: { x: number; y: number }[]) {
  const xs = blocks.map((b) => b.x);
  const ys = blocks.map((b) => b.y);
  const x = Math.min(...xs) - BLOCK_SIZE;
  const y = Math.min(...ys) - BLOCK_SIZE;
  return { x, y, w: Math.max(...xs) + BLOCK_SIZE - x, h: Math.max(...ys) + BLOCK_SIZE - y };
}

const start = { id: 'start', x: -520, y: 0, kind: 'start' as const, degree: 0, every: 0 };

function westernPiece(): Piece {
  const mel = phraseLoop('mel', 180, -40, run([0, 4, 7, 9, 11, 7], 0.75));
  const drums = backbeat(-460, -260);
  const m1 = mel.blocks[0];
  return {
    version: 1,
    bpm: 104,
    snap: true,
    scaleId: 'major',
    rootHz: ROOT_HZ,
    scales: [],
    blocks: [start, ...drums.blocks, ...mel.blocks, { id: 'bass', x: m1.x - PX_PER_BEAT, y: m1.y + PX_PER_BEAT, kind: 'bass', degree: -7, every: 0 }],
    links: [
      ...chain(['start', 'kick']),
      ...drums.links,
      { id: 'start>mel-1', from: 'start', to: mel.first },
      ...mel.links,
      { id: 'mel-1>bass', from: 'mel-1', to: 'bass' },
    ],
    regions: [],
  };
}

function arabicPiece(): Piece {
  // Maqam rast: the melody leans on degrees 2 and 6, the half-flat 3rd and
  // 7th, resolving down the ajnas to the tonic while the rast period's slight
  // stretch (1203.9¢) keeps the octaves wide, like a good oud. A pluck stands
  // in for the oud; the drone is the bass voice.
  const mel = phraseLoop('mel', 180, -40, run([2, 3, 4, 2, 0], 0.75), 'pluck');
  const drums = backbeat(-460, -260);
  const m1 = mel.blocks[0];
  return {
    version: 1,
    bpm: 96,
    snap: true,
    scaleId: RAST.id,
    rootHz: ROOT_HZ,
    scales: [RAST],
    blocks: [
      start,
      ...drums.blocks,
      ...mel.blocks,
      { id: 'drone', x: m1.x - PX_PER_BEAT, y: m1.y + PX_PER_BEAT, kind: 'bass', degree: -8, every: 0 },
    ],
    links: [
      ...chain(['start', 'kick']),
      ...drums.links,
      { id: 'start>mel-1', from: 'start', to: mel.first },
      ...mel.links,
      { id: 'mel-1>drone', from: 'mel-1', to: 'drone' },
    ],
    regions: [],
  };
}

function persianPiece(): Piece {
  // Dastgah shur on the canvas; a Chahargah region holds its own phrase, so a
  // pulse wandering in modulates between the two dastgah-ha as it plays.
  const shur = phraseLoop('shur', -80, 40, run([0, 2, 3, 5, 3], 0.75), 'pluck');
  const chahar = phraseLoop('chahar', 520, 40, run([0, 1, 3, 4, 0], 0.75), 'pluck');
  const drums = backbeat(-520, -280);
  const c1 = chahar.blocks[0];
  return {
    version: 1,
    bpm: 84,
    snap: true,
    scaleId: SHUR.id,
    rootHz: ROOT_HZ,
    scales: [SHUR, CHAHARGAH],
    blocks: [start, ...drums.blocks, ...shur.blocks, ...chahar.blocks, { id: 'bass', x: c1.x + PX_PER_BEAT, y: c1.y + PX_PER_BEAT, kind: 'bass', degree: -7, every: 0 }],
    links: [
      ...chain(['start', 'kick']),
      ...drums.links,
      { id: 'start>shur-1', from: 'start', to: shur.first },
      ...shur.links,
      { id: 'shur-1>chahar-1', from: 'shur-1', to: chahar.first },
      ...chahar.links,
      { id: 'chahar-1>bass', from: 'chahar-1', to: 'bass' },
    ],
    regions: [
      // Each dastgah on its own side of the stereo field, and Chahargah echoing.
      { id: 'r-shur', ...around(shur.blocks), name: 'Shur', scaleId: SHUR.id, rootHz: ROOT_HZ, mix: { level: 0, pan: -0.4, mute: false } },
      {
        id: 'r-chahar',
        ...around(chahar.blocks),
        name: 'Chahargah',
        scaleId: CHAHARGAH.id,
        rootHz: ROOT_HZ,
        mix: { level: -1, pan: 0.4, mute: false },
        fx: { echo: 0.25, echoBeats: 0.5, reverb: 0.35 },
      },
    ],
  };
}

function mongolianPiece(): Piece {
  // Khoomei: a low drone breathes every 3 beats, an octave below the melody —
  // degree 0 is already harmonic 8, so the drone at degree -8 is harmonic 4,
  // the 131 Hz C under the whistle tune. Melody degrees 2 and 4 are the 11th
  // and 13th harmonics, the notes that make sygyt sound otherworldly. The
  // drone is the bass voice, darkened and drenched by its own region.
  const mel = phraseLoop('mel', 200, -80, run([0, 2, 4, 2, 5, 3], 0.75));
  const drone = phraseLoop('drone', -280, 220, run([-8, -8, -8], 1), 'bass');
  const box = around(drone.blocks);
  return {
    version: 1,
    bpm: 66,
    snap: true,
    scaleId: KHOOMEI.id,
    rootHz: ROOT_HZ,
    scales: [KHOOMEI],
    blocks: [start, ...mel.blocks, ...drone.blocks],
    links: [
      { id: 'start>mel-1', from: 'start', to: mel.first },
      ...mel.links,
      { id: 'start>drone-1', from: 'start', to: drone.first },
      ...drone.links,
    ],
    regions: [
      {
        id: 'r-drone',
        name: 'Drone',
        scaleId: KHOOMEI.id,
        rootHz: ROOT_HZ,
        ...box,
        mix: { level: -3, pan: 0, mute: false },
        fx: { tone: 0.35, reverb: 0.6 },
      },
    ],
  };
}

export interface Example {
  id: string;
  tradition: string;
  title: string;
  description: string;
  /** The scale names shown on the card, for a quick read of each tuning. */
  scales: string[];
  piece: Piece;
}

/* ---------- famous tunes ---------- */

// The tune builders live in melody.ts: a phrase folded around a rectangle,
// plus the two-note bass pulse underneath.

const CHROMATIC: Scale = {
  id: 'chromatic-12',
  name: '12-TET chromatic',
  cents: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
  period: 1200,
};

const MINOR: Scale = {
  id: 'natural-minor',
  name: 'Natural minor',
  cents: [0, 200, 300, 500, 700, 800, 1000],
  period: 1200,
};

function odeToJoyPiece(): Piece {
  // Beethoven, Symphony No. 9 — E E F G G F E D C C D E E. D D, twice, with
  // the second ending falling to the tonic. Degrees of the C-major scale.
  const phrase: Note[] = [
    { degree: 2, beats: 1 }, { degree: 2, beats: 1 }, { degree: 3, beats: 1 }, { degree: 4, beats: 1 },
    { degree: 4, beats: 1 }, { degree: 3, beats: 1 }, { degree: 2, beats: 1 }, { degree: 1, beats: 1 },
    { degree: 0, beats: 1 }, { degree: 0, beats: 1 }, { degree: 1, beats: 1 }, { degree: 2, beats: 1 },
    { degree: 2, beats: 1.5 }, { degree: 1, beats: 0.5, soft: true }, { degree: 1, beats: 2 },
  ];
  const ending: Note[] = [
    { degree: 1, beats: 1.5 }, { degree: 0, beats: 0.5, soft: true }, { degree: 0, beats: 2 },
  ];
  const notes = [...phrase, ...phrase.slice(0, -3), ...ending];
  const mel = phraseLoop('mel', 220, -80, notes);
  const bass = bassPulse('bass', -40, 520, [-7, -3]);
  const drums = backbeat(-460, -280);
  return {
    version: 1,
    bpm: 112,
    snap: true,
    scaleId: 'major',
    rootHz: ROOT_HZ,
    scales: [],
    blocks: [songStart, ...drums.blocks, ...mel.blocks, ...bass.blocks],
    links: [
      ...chain(['start', 'kick']),
      ...drums.links,
      { id: 'start>mel-1', from: 'start', to: mel.first },
      { id: 'start>bass-a', from: 'start', to: bass.first },
      ...mel.links,
      ...bass.links,
    ],
    regions: [],
  };
}

function fuerElisePiece(): Piece {
  // Beethoven, WoO 59 — the A-minor theme. Needs the chromatic scale for the
  // D♯; degrees are semitones from C4, so A4 is 9 and E5 is 16.
  const notes: Note[] = [
    { degree: 16, beats: 0.5 }, { degree: 15, beats: 0.5 }, { degree: 16, beats: 0.5 }, { degree: 15, beats: 0.5 },
    { degree: 16, beats: 0.5 }, { degree: 11, beats: 0.5 }, { degree: 14, beats: 0.5 }, { degree: 13, beats: 0.5 },
    { degree: 9, beats: 1 },
    { degree: 0, beats: 0.5, soft: true }, { degree: 4, beats: 0.5, soft: true }, { degree: 9, beats: 0.5, soft: true },
    { degree: 11, beats: 1 },
    { degree: 4, beats: 0.5, soft: true }, { degree: 8, beats: 0.5, soft: true }, { degree: 11, beats: 0.5, soft: true },
    { degree: 13, beats: 1 },
  ];
  const mel = phraseLoop('mel', 220, -40, notes, 'pluck');
  const bass = bassPulse('bass', -60, 480, [-3, -8], 1); // A2–E3, a beat apart
  return {
    version: 1,
    bpm: 108,
    snap: true,
    scaleId: CHROMATIC.id,
    rootHz: ROOT_HZ,
    scales: [CHROMATIC],
    blocks: [songStart, ...mel.blocks, ...bass.blocks],
    links: [
      { id: 'start>mel-1', from: 'start', to: mel.first },
      { id: 'start>bass-a', from: 'start', to: bass.first },
      ...mel.links,
      ...bass.links,
    ],
    regions: [],
  };
}

function mountainKingPiece(): Piece {
  // Grieg, Peer Gynt — the ostinato that climbs a step every two bars:
  // B D E F♯ twice, then the same shape a step up, and again. In natural
  // minor degrees: 0 2 3 4, 0 2 3 4, 1 3 4 5, 1 3 4 5, 2 4 5 6, 2 4 5 6,
  // 3 5 6 7, 3 5 6 7. All eighths; the drone rings an octave below.
  const bar = (root: number): Note[] => [root, root + 2, root + 3, root + 4].map((degree) => ({ degree, beats: 0.5 }));
  const notes = [...bar(0), ...bar(0), ...bar(1), ...bar(1), ...bar(2), ...bar(2), ...bar(3), ...bar(3)];
  const mel = phraseLoop('mel', 220, -80, notes, 'pluck');
  const drone = bassPulse('drone', -80, 520, [-7, -7]);
  return {
    version: 1,
    bpm: 126,
    snap: true,
    scaleId: MINOR.id,
    rootHz: ROOT_HZ,
    scales: [MINOR],
    blocks: [songStart, ...mel.blocks, ...drone.blocks],
    links: [
      { id: 'start>mel-1', from: 'start', to: mel.first },
      { id: 'start>drone-a', from: 'start', to: drone.first },
      ...mel.links,
      ...drone.links,
    ],
    regions: [],
  };
}

function happyBirthdayPiece(): Piece {
  // Hill & Hill, the most-sung tune there is. The pickup pairs are eighths
  // played soft, the phrase ends hold. Degrees of the C-major scale; the
  // third line peaks on G5 (degree 11). Drums are a waltz: kick, hat, snare,
  // a beat apart, folded into an L.
  const line = (n: Note[]): Note[] => n;
  const notes = [
    ...line([{ degree: 4, beats: 0.5, soft: true }, { degree: 4, beats: 0.5, soft: true }, { degree: 5, beats: 1 }, { degree: 4, beats: 1 }, { degree: 7, beats: 1 }, { degree: 6, beats: 2 }]),
    ...line([{ degree: 4, beats: 0.5, soft: true }, { degree: 4, beats: 0.5, soft: true }, { degree: 5, beats: 1 }, { degree: 4, beats: 1 }, { degree: 8, beats: 1 }, { degree: 7, beats: 2 }]),
    ...line([{ degree: 4, beats: 0.5, soft: true }, { degree: 4, beats: 0.5, soft: true }, { degree: 11, beats: 1 }, { degree: 9, beats: 1 }, { degree: 7, beats: 1 }, { degree: 6, beats: 1 }, { degree: 5, beats: 1 }]),
    ...line([{ degree: 3, beats: 0.5, soft: true }, { degree: 3, beats: 0.5, soft: true }, { degree: 9, beats: 1 }, { degree: 7, beats: 1 }, { degree: 1, beats: 1 }, { degree: 0, beats: 2 }]),
  ];
  const mel = phraseLoop('mel', 220, -40, notes);
  const drums = waltz(-460, -260);
  return {
    version: 1,
    bpm: 120,
    snap: true,
    scaleId: 'major',
    rootHz: ROOT_HZ,
    scales: [],
    blocks: [songStart, ...drums.blocks, ...mel.blocks],
    links: [
      ...chain(['start', 'kick']),
      ...drums.links,
      { id: 'start>mel-1', from: 'start', to: mel.first },
      ...mel.links,
    ],
    regions: [],
  };
}

// Root of D4, so the built-in major scale reads as D major: degree 0 is D,
// and both rings below count from there.
const D4 = 293.6648;

function canonPiece(): Piece {
  // Pachelbel, Canon in D. The ground bass is the star: eight half notes,
  // D A B F♯ G D G A (degrees of D major, an octave down), folded into their
  // own loop of eight bass blocks, 16 beats round. The first violin's opening
  // walks over it — two bars of quarters falling from F♯5, two answering bars,
  // then the cadence in half notes (F♯ D E C♯) — a 24-beat loop against the
  // bass's 16, so the two realign every third bass pass.
  const mel = phraseLoop('mel', 280, -160, [
    { degree: 9, beats: 1 }, { degree: 8, beats: 1 }, { degree: 7, beats: 1 }, { degree: 6, beats: 1 },
    { degree: 5, beats: 1 }, { degree: 4, beats: 1 }, { degree: 5, beats: 1 }, { degree: 6, beats: 1 },
    { degree: 7, beats: 1 }, { degree: 6, beats: 1 }, { degree: 5, beats: 1 }, { degree: 4, beats: 1 },
    { degree: 3, beats: 1 }, { degree: 2, beats: 1 }, { degree: 3, beats: 1 }, { degree: 1, beats: 1 },
    { degree: 2, beats: 2 }, { degree: 0, beats: 2 }, { degree: 1, beats: 2 }, { degree: -1, beats: 2 },
  ]);
  // D3 A2 B2 F♯3 G3 D3 G3 A3 — the famous eight-chord ground, half notes.
  const bass = phraseLoop('bass', -420, -40, [
    { degree: -7, beats: 2 }, { degree: -10, beats: 2 }, { degree: -9, beats: 2 }, { degree: -5, beats: 2 },
    { degree: -4, beats: 2 }, { degree: -7, beats: 2 }, { degree: -4, beats: 2 }, { degree: -3, beats: 2 },
  ], 'bass');
  return {
    version: 1,
    bpm: 96,
    snap: true,
    scaleId: 'major',
    rootHz: D4,
    scales: [],
    blocks: [songStart, ...mel.blocks, ...bass.blocks],
    links: [
      { id: 'start>mel-1', from: 'start', to: mel.first },
      { id: 'start>bass-1', from: 'start', to: bass.first },
      ...mel.links,
      ...bass.links,
    ],
    regions: [],
  };
}

const NAHAWAND: Scale = {
  // Maqam nahawand on D (the 12-TET approximation Lamma Bada is sung in):
  // a harmonic-minor shape — the flat 6th and the raised leading 7th that the
  // descent keeps brushing against on its way home to D.
  id: 'scl-lamma',
  name: 'Maqam for Lamma Bada (nahawand on D)',
  cents: [0, 200, 300, 500, 700, 800, 1100],
  period: 1200,
};

function lammaBadaPiece(): Piece {
  // Lamma Bada, complete, transcribed from a notated piano arrangement of the
  // muwashshah (Duqmaq arr.): all eleven measures of the D.S. al Fine form,
  // the ornamental sixteenth runs kept as their structural notes. Samai
  // thaqil's long-short lilt comes through the dotted values; the C♯s are the
  // raised leading tone the descents brush on their way home to D, and the
  // drone rings the octave below like the tonic pedal under the sung line.
  // Degrees of nahawand on D: D E F G A B♭ C♯.
  const n = (degree: number, beats: number, soft = false): Note => ({ degree, beats, ...(soft ? { soft } : {}) });
  const run = (degrees: number[], beats = 0.25): Note[] => degrees.map((d) => n(d, beats, true));
  const mel = phraseLoop('mel', 240, -80, [
    // Pickup: "Lam-ma ba-da…"
    n(0, 0.25, true),
    n(4, 1.5), ...run([5, 4, 3, 2]), n(3, 0.75), n(4, 0.25), n(0, 1),
    n(2, 0.25), n(4, 1), ...run([5, 4, 3, 2]), ...run([3, 4, 5, 6]), n(7, 1.5),
    // Segno: the peak phrase, G–F♯–E–D turn rising back up
    n(7, 2), n(4, 1.5), ...run([3, 4, 5]), n(4, 0.25), n(3, 0.75), n(2, 0.25),
    n(1, 0.25), n(2, 1), ...run([3, 2, 1, 0]), ...run([1, 2, 3, 4]), n(5, 0.25),
    // The C♯ turn under the high D
    n(4, 0.25), n(7, 1.5), ...run([6, 5, 4, 3]), n(2, 1), n(4, 1),
    n(0, 0.25), n(2, 1), n(4, 1), ...run([3, 2, 1, 0]), ...run([1, 2, 3]), n(4, 0.25),
    // Return of the theme, ornamented
    n(0, 0.25), n(4, 1.5), ...run([5, 4, 3, 2]), n(3, 0.75), n(4, 0.25), ...run([5, 6]), n(7, 1),
    n(7, 0.25), n(4, 1), ...run([5, 4, 3, 2]), ...run([3, 4, 5]), n(6, 0.25), n(7, 0.75), n(6, 0.25), n(5, 0.25),
    // Final descent: G–F♯–E–D… E–F–G–F–D, then home
    n(4, 1), ...run([3, 2, 1, 0, 1, 2, 3]), n(2, 0.25), n(0, 1),
    n(0, 0.25), n(4, 1), ...run([5, 4, 3, 2]), ...run([3, 4, 5, 6]), n(7, 2),
  ], 'pluck');
  const drone = bassPulse('drone', -200, -360, [-7, -7], 2);
  return {
    version: 1,
    bpm: 66,
    snap: true,
    scaleId: NAHAWAND.id,
    rootHz: D4,
    scales: [NAHAWAND],
    blocks: [songStart, ...mel.blocks, ...drone.blocks],
    links: [
      { id: 'start>mel-1', from: 'start', to: mel.first },
      { id: 'start>drone-a', from: 'start', to: drone.first },
      ...mel.links,
      ...drone.links,
    ],
    regions: [],
  };
}

function symphonyFivePiece(): Piece {
  // Beethoven, Symphony No. 5, first movement, the whole arc of a simplified
  // arrangement transcribed from notation: the fate theme in C minor — four
  // full statements of the hammer stroke with fermatas, then the compressed
  // echo that climbs to the B♮ — turning, as the movement does, to C major
  // for the legato horn theme, up to the A♭/F♯ chromatic squeeze, the
  // flourish over the top and the run down home, straight back into fate.
  // Chromatic because the movement won't stay in one scale: E♭ and E natural,
  // A♭ and F♯ all take their turns. The held notes carry "every 2: velocity
  // 70%" so alternate fermatas come back as their own echo.
  const stroke = (degree: number): Note => ({ degree, beats: 0.5 });
  const hold = (degree: number): Note => ({ degree, beats: 2.5, extra: 'every 2: velocity 70%  # the held note echoes' });
  const quarter = (degree: number, beats = 1): Note => ({ degree, beats });
  const theme = [stroke(-5), stroke(-5), stroke(-5), hold(3), stroke(-7), stroke(-7), stroke(-7), hold(2)];
  const lyrical: Note[] = [
    ...[12, 14, 16, 17, 19, 17, 16, 14, 12, 14, 16, 17, 19, 17, 16, 14].map((d) => quarter(d)),
    ...[12, 14, 15, 17, 19, 17, 16, 14].map((d) => quarter(d)),
    ...[15, 17, 19, 19].map((d) => quarter(d)),
    ...[20, 19, 17, 19, 20, 19, 17, 15, 20, 19, 17, 15, 20, 19, 18, 19].map((d) => quarter(d)),
    quarter(19, 2),
    ...[24, 23, 21].map((d) => quarter(d, 0.5)),
    ...[16, 17, 19, 17, 16, 14, 12].map((d) => quarter(d, 0.5)),
    { degree: 12, beats: 2.5 },
  ];
  const mel = phraseLoop('mel', 240, -120, [
    ...theme,
    ...theme,
    // The compressed statements that climb to the B natural
    stroke(-5), stroke(-5), stroke(-5), quarter(3),
    stroke(-7), stroke(-7), stroke(-7), quarter(2),
    stroke(-5), stroke(-5), stroke(-5), quarter(-1, 2),
    ...lyrical,
  ]);
  const bass = bassPulse('bass', -200, -360, [-5, -5], 1);
  return {
    version: 1,
    bpm: 108,
    snap: true,
    scaleId: CHROMATIC.id,
    rootHz: ROOT_HZ,
    scales: [CHROMATIC],
    blocks: [songStart, ...mel.blocks, ...bass.blocks],
    links: [
      { id: 'start>mel-1', from: 'start', to: mel.first },
      { id: 'start>bass-a', from: 'start', to: bass.first },
      ...mel.links,
      ...bass.links,
    ],
    regions: [],
  };
}

const SONGS: Example[] = [
  {
    id: 'ode',
    tradition: 'Song · Western',
    title: 'Ode to Joy — Beethoven',
    description:
      'The Ninth\'s theme folded around a rectangle, each hop as long as the note: quarters, the dotted figure, and a held final. A C–G bass line and a drum line play underneath, with a snare branching off the kick and rejoining on the backbeat.',
    scales: ['Major'],
    piece: odeToJoyPiece(),
  },
  {
    id: 'elise',
    tradition: 'Song · Western',
    title: 'Für Elise — Beethoven',
    description:
      'The A-minor theme on a plucked string and a 12-TET chromatic scale, since the D♯ won\'t sit in any diatonic scale. The phrase folds around a rectangle. The off-beat A–C–E arpeggios are coded velocity 65%, over an A–E bass.',
    scales: [CHROMATIC.name],
    piece: fuerElisePiece(),
  },
  {
    id: 'mountain-king',
    tradition: 'Song · Western',
    title: 'In the Hall of the Mountain King — Grieg',
    description:
      'Grieg\'s climbing ostinato in natural minor, played on a pluck: the same four-note shape a step higher every two bars, all eighths, over a bass drone an octave down. As it loops, nudge the tempo slider up and lose the race just like in the Peer Gynt score.',
    scales: [MINOR.name],
    piece: mountainKingPiece(),
  },
  {
    id: 'birthday',
    tradition: 'Song · Western',
    title: 'Happy Birthday — Hill & Hill',
    description:
      'The pickup pairs are soft eighths, the phrase-ends hold for two beats, and the drums are a waltz — kick, hat, snare, a beat apart and folded into an L — since the tune is in three.',
    scales: ['Major'],
    piece: happyBirthdayPiece(),
  },
  {
    id: 'canon',
    tradition: 'Song · Western',
    title: 'Canon in D — Pachelbel',
    description:
      'Two loops at two speeds: the eight-note ground bass (D A B F♯ G D G A) as half notes on the bass voice, folded into its own loop, while the first violin\'s opening walks over it in quarters and closes its cadence in half notes. The 24-beat melody against the 16-beat bass realigns every third bass pass.',
    scales: ['Major'],
    piece: canonPiece(),
  },
  {
    id: 'lamma-bada',
    tradition: 'Song · Andalusian',
    title: 'Lamma Bada — Andalusian muwashshah',
    description:
      'The muwashshah every classical Arabic suite opens with, in maqam nahawand on D, played on a pluck: the pickup climbs to F, the phrase leans on the B♭, then rises to the G peak and sighs down the scale. Slow samai tempo, with a bass drone on the tonic the whole way.',
    scales: [NAHAWAND.name],
    piece: lammaBadaPiece(),
  },
  {
    id: 'symphony-5',
    tradition: 'Song · Western',
    title: 'Symphony No. 5 — Beethoven',
    description:
      'Fate knocking, folded around one long loop: three eighth-note strokes and a held answer, G G G E♭ then F F F D, over a tolling bass G. The held notes run "every 2: velocity 70%", so on alternate passes the fermata comes back as its own echo.',
    scales: [MINOR.name],
    piece: symphonyFivePiece(),
  },
];

export const EXAMPLES: Example[] = [
  {
    id: 'tour',
    tradition: 'Start here',
    title: 'The tour',
    description:
      'The patch you first open. A five-note melody folds around a rectangle and phases against a 2-beat drum line: hats along the line, a snare branching off the kick and rejoining on the backbeat. The melody sits in a Maqam Rast region, panned left with its own echo, so it plays quarter tones while the bass — its own voice — stays pentatonic. Code ghosts a hi-hat, walks the bass and pushes every 4th bass note late.',
    scales: ['Major pentatonic', 'Maqam Rast (24-TET approx.)'],
    piece: demoPiece(),
  },
  {
    id: 'western',
    tradition: 'Western',
    title: 'Major common practice',
    description:
      'A 12-TET major scale, the tuning everything else here is measured against. The melody folds around a rectangle and phases against a 2-beat drum line with a snare branch, and a bass voice hangs off the melody.',
    scales: ['Major'],
    piece: westernPiece(),
  },
  {
    id: 'arabic',
    tradition: 'Arabic',
    title: 'Maqam Rast',
    description:
      'Ozan Yarman\'s transcribed rast tuning: the 3rd and 7th degrees sit half-flat, and the octave stretches to 1203.9 cents as on a well-played oud. A pluck walks the neutral third and falls back to the tonic, over a bass drone and a snare that branches off the kick.',
    scales: [RAST.name],
    piece: arabicPiece(),
  },
  {
    id: 'persian',
    tradition: 'Persian',
    title: 'Dastgah Shur → Chahargah',
    description:
      'Two regions, two dastgah-ha: the melody starts in Shur\'s low neutral tetrachord (a 17-note thirdtone set), then a link carries it into a Chahargah region tuned in just 13-limit ratios — a modulation you can watch happen as pulses cross the border, and hear move from the left speaker to an echoing right.',
    scales: [SHUR.name, CHAHARGAH.name],
    piece: persianPiece(),
  },
  {
    id: 'mongolian',
    tradition: 'Mongolian',
    title: 'Khoomei harmonics',
    description:
      'Harmonics 8–16 of a drone, the segment throat singers whistle out in sygyt. A slow three-note bass loop keeps the fundamental, darkened and drenched in reverb by its own region, while the melody picks the 9th, 11th and 13th harmonics above it.',
    scales: [KHOOMEI.name],
    piece: mongolianPiece(),
  },
  ...SONGS,
];
