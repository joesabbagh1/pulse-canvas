import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { toNodes } from '../piece';
import { regionAt } from '../regions';
import { MAX_PATTERN_NOTES, compilePattern, soundNamed, starterPattern } from './pattern';
import { waveCenter } from './wave';

const sounds = (source: string, cycle = 0) => compilePattern(source).notes(cycle).map((n) => [Number(n.at.toFixed(4)), n.kind ?? n.degree]);

describe('patterns', () => {
  it('spreads a line of sounds evenly across the block, and squeezes brackets into one step', () => {
    expect(sounds('bd sd')).toEqual([
      [0, 0],
      [0.5, 0],
    ]);
    expect(sounds('bd*2 [~ sd] hh(3,8)')).toEqual([
      [0, 0],
      [0.1667, 0],
      [0.5, 0],
      [0.6667, 0],
      [0.7917, 0],
      [0.9167, 0],
    ]);
  });

  it('reads numbers as scale degrees, and a word as a hit of the block at a degree', () => {
    const notes = compilePattern('0 -3 [2,4] piano:5 cello').notes(0);
    expect(notes.map((n) => [n.kind, n.degree])).toEqual([
      [null, 0],
      [null, -3],
      [null, 2],
      [null, 4],
      [null, 5],
      [null, 0],
    ]);
    expect(notes[0].span).toBeCloseTo(0.2);
  });

  it('reads a scale, an octave and an instrument in front of the notes, and remembers where each note is written', () => {
    const pattern = compilePattern('scale minor octave -1 sound piano 0 2');
    const notes = pattern.notes(0);
    expect(pattern.error).toBeNull();
    expect(notes.map((n) => [n.degree, n.kind, n.scaleId, n.octave])).toEqual([
      [0, 'piano', 'minor-penta', -1],
      [2, 'piano', 'minor-penta', -1],
    ]);
    expect(pattern.source.slice(notes[0].from, notes[0].to)).toBe('0');
    expect(pattern.source.slice(notes[1].from, notes[1].to)).toBe('2');
    expect(compilePattern('scale nope 0').error).toMatch(/scale/);
  });

  it('starts an instrument on its own pattern', () => {
    expect(starterPattern('kick')).toBe('0*2 ~ 0');
    expect(starterPattern('piano')).toBe('0*2 [~ 2] 4');
    expect(starterPattern('shaker')).toBe('0*2 ~ 0');
  });

  it('a stacked note can still be sounding when a later one starts', () => {
    const notes = compilePattern('[0, ~ 3]').notes(0);
    const first = notes.find((n) => n.degree === 0)!;
    const next = notes.find((n) => n.degree === 3)!;
    expect(first.at + first.span).toBeGreaterThan(next.at + 0.01);
  });

  it('a kit plays the drum each word names, and a caret accents that note', () => {
    expect(compilePattern('kit bd sd hh').notes(0).map((n) => n.kind)).toEqual(['kick', 'snare', 'hat']);
    expect(compilePattern('bd sd hh').notes(0).map((n) => n.kind)).toEqual([null, null, null]);
    const line = compilePattern('octave -2 0 ^2 4');
    expect(line.error).toBeNull();
    expect(line.notes(0).map((n) => [n.degree, n.octave, n.accent ?? false])).toEqual([
      [0, -2, false],
      [2, -2, true],
      [4, -2, false],
    ]);
    expect(line.source.slice(line.notes(0)[1].from, line.notes(0)[1].to)).toBe('^2');
    expect(compilePattern('sound piano kit 0 bd').notes(0).map((n) => [n.kind, n.degree])).toEqual([
      ['piano', 0],
      ['kick', 0],
    ]);
    expect(compilePattern('kit').error).toMatch(/notes/);
  });

  it('knows the drum names Tidal uses, any instrument id, and nothing else', () => {
    expect(soundNamed('bd')).toBe('kick');
    expect(soundNamed('HH')).toBe('hat');
    expect(soundNamed('hat-open')).toBe('hat-open');
    expect(soundNamed('start')).toBeNull();
    expect(soundNamed('c4')).toBeNull();
  });

  it('plays the next cycle on each pass, so <a b> alternates', () => {
    expect([0, 1, 2, 3].map((cycle) => sounds('<0 2 4>', cycle)[0][1])).toEqual([0, 2, 4, 0]);
  });

  it('gives each note to exactly one window, however a pass is sliced', () => {
    const pattern = compilePattern('0 1 2 3 4 5 6 7');
    const whole = pattern.notes(3).map((n) => n.degree);
    const cuts = [0, 0.125, 0.3, 0.5, 0.5, 0.875, 1];
    const sliced = cuts.slice(1).flatMap((to, i) => pattern.notes(3, cuts[i], to).map((n) => n.degree));
    expect(sliced).toEqual(whole);
    expect(whole).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('plays faster, slower and backwards when the block asks', () => {
    const pattern = compilePattern('0 1 2 3');
    const degrees = (cycle: number, fast: number, rev: boolean) => pattern.notes(cycle, 0, 1, { fast, rev }).map((n) => n.degree);
    expect(degrees(0, 2, false)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(degrees(0, 0.5, false)).toEqual([0, 1]);
    expect(degrees(1, 0.5, false)).toEqual([2, 3]);
    expect(degrees(0, 1, true)).toEqual([3, 2, 1, 0]);
  });

  it('an empty pattern is silent, not a mistake', () => {
    expect(compilePattern('   ')).toMatchObject({ error: null });
    expect(compilePattern('').notes(0)).toEqual([]);
  });

  it('says what is wrong in words, and plays nothing', () => {
    expect(compilePattern('bd [sd').error).toMatch(/stops short/);
    expect(compilePattern('bd ] sd').error).toMatch(/"\]" at character 4/);
    expect(compilePattern('bd c4').error).toMatch(/"c4" isn't a sound/);
    expect(compilePattern('bd" + alert(1) + "').error).toMatch(/quotes/);
    expect(compilePattern('bd*x').error).toMatch(/"x" isn't a sound/);
    expect(compilePattern('bd [sd').notes(0)).toEqual([]);
  });

  it('refuses a pattern too dense to play before asking for its notes', () => {
    const started = Date.now();
    for (const source of ['hh*100000000', '[[hh*64]*64]*64', '0 .. 99999999', 'hh!9999999', 'hh(3,1000000)', '{bd sd}%1000000', '<bd sd>*100000', 'bd*<2 99999>']) {
      expect(compilePattern(source).error, source).toMatch(/too dense/);
    }
    expect(Date.now() - started).toBeLessThan(500);
    expect(compilePattern('hh*16 [bd*4, hh*16, ~ cp] <bd sd>*8').error).toBeNull();
  });

  it('never plays more notes than the bound it was checked against', () => {
    const sources = [
      'bd*2 [~ sd] hh(3,8)',
      'bd(<3 5>,8,2) [bd|sd|hh]*4',
      '{bd sd hh}%8 {bd sd, hh hh hh}',
      '<bd sd>!3 hh!4 0 .. 7',
      'bd . sd sd . hh hh hh',
      '[0,2,4]*4 <[0 1] [2 3 4]>*3',
      'bd? sd*8? hh:3*4',
      'bd/2 [sd hh]/1.5 cp@3 _ _',
    ];
    for (const source of sources) {
      const pattern = compilePattern(source);
      expect(pattern.error, source).toBeNull();
      for (let cycle = 0; cycle < 6; cycle++) expect(pattern.notes(cycle).length, source).toBeLessThanOrEqual(MAX_PATTERN_NOTES);
    }
  });

  it('the techno example is one bar of the club kit, an acid line and a pumping pad', () => {
    const piece = EXAMPLES.find((example) => example.id === 'techno')!.piece;
    expect(piece.bpm).toBe(132);
    const kit = compilePattern(piece.blocks.find((block) => block.id === 'kit')!.pattern!);
    expect(kit.error).toBeNull();
    const kinds = kit.notes(0).map((note) => note.kind);
    expect(kinds.filter((kind) => kind === 'kick-9')).toHaveLength(4);
    expect(kinds.filter((kind) => kind === 'clap-9')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'open-9').length).toBeGreaterThan(0);
    expect(kinds.filter((kind) => kind === 'hat-9').length).toBeGreaterThan(kinds.filter((kind) => kind === 'open-9').length);
    const acid = compilePattern(piece.blocks.find((block) => block.id === 'acid')!.pattern!);
    expect(acid.notes(0).filter((note) => note.accent).map((note) => note.degree)).toEqual([2, 4, 2]);
    const nodes = toNodes(piece);
    for (const [id, region] of [
      ['kit', 'r-drums'],
      ['acid', 'r-acid'],
      ['pad', 'r-pad'],
    ] as const) {
      const block = piece.blocks.find((item) => item.id === id)!;
      expect(regionAt(nodes, { x: block.x, y: block.y })?.id).toBe(region);
    }
    const sweep = piece.waves?.[0];
    expect(sweep && regionAt(nodes, waveCenter(sweep.points))?.id).toBe('r-pad');
    expect(piece.regions.find((region) => region.id === 'r-drums')?.fx?.pump ?? 0).toBe(0);
    expect(piece.regions.find((region) => region.id === 'r-acid')?.fx?.pump).toBeGreaterThan(0);
    expect(piece.regions.find((region) => region.id === 'r-pad')?.fx?.pump).toBeGreaterThan(0);
  });
});
