import { describe, expect, it } from 'vitest';
import { CATEGORIES, INSTRUMENTS, instrumentById, instrumentsIn, isInstrumentId, isKick, machineById, setMachines } from './instruments';
import { DEFAULT_PATCH, machineInstrument } from './synth';

const builtIns = ['tone', 'pluck', 'bass', 'jawharp', 'khuur', 'kick', 'snare', 'hat'] as const;

const catalogIds = [
  'piano',
  'piano-bright',
  'piano-electric',
  'piano-honky',
  'epiano',
  'epiano-2',
  'harpsichord',
  'clavinet',
  'organ-drawbar',
  'organ-percussive',
  'organ-rock',
  'organ-church',
  'organ-reed',
  'violin',
  'viola',
  'cello',
  'contrabass',
  'strings-tremolo',
  'strings',
  'strings-2',
  'fiddle',
  'guitar-nylon',
  'guitar-steel',
  'guitar-jazz',
  'guitar-clean',
  'guitar-muted',
  'guitar-overdrive',
  'guitar-distortion',
  'guitar-harmonics',
  'bass-acoustic',
  'bass-finger',
  'bass-pick',
  'bass-fretless',
  'bass-slap',
  'bass-slap-2',
  'pizzicato',
  'harp',
  'dulcimer',
  'sitar',
  'banjo',
  'shamisen',
  'koto',
  'accordion',
  'harmonica',
  'accordion-tango',
  'sax-soprano',
  'sax-alto',
  'sax-tenor',
  'sax-baritone',
  'oboe',
  'english-horn',
  'bassoon',
  'clarinet',
  'piccolo',
  'flute',
  'recorder',
  'pan-flute',
  'bottle',
  'shakuhachi',
  'whistle',
  'ocarina',
  'bagpipe',
  'shanai',
  'trumpet',
  'trombone',
  'tuba',
  'trumpet-muted',
  'horn',
  'brass',
  'celesta',
  'glockenspiel',
  'music-box',
  'vibraphone',
  'marimba',
  'xylophone',
  'bells',
  'kalimba',
  'steel-drum',
  'bell',
  'agogo',
  'timpani',
  'tom-melodic',
  'woodblock',
  'taiko',
  'synth-drum',
  'cymbal-reverse',
  'orchestra-hit',
  'hat-open',
  'tom',
  'clap',
  'crash',
  'ride',
  'tambourine',
  'cowbell',
  'shaker',
  'sidestick',
  'choir',
  'voice-oohs',
  'synth-voice',
  'lead-voice',
  'bass-synth',
  'bass-synth-2',
  'synth-strings',
  'synth-strings-2',
  'brass-synth',
  'brass-synth-2',
  'lead-square',
  'lead-saw',
  'lead-calliope',
  'lead-chiff',
  'lead-charang',
  'lead-fifths',
  'lead-bass',
  'pad-new-age',
  'pad-warm',
  'pad-poly',
  'pad-choir',
  'pad-bowed',
  'pad-metal',
  'pad-halo',
  'pad-sweep',
  'fx-rain',
  'fx-soundtrack',
  'fx-crystal',
  'fx-atmosphere',
  'fx-brightness',
  'fx-goblins',
  'fx-echoes',
  'fx-scifi',
  'fret-noise',
  'breath',
  'seashore',
  'bird',
  'telephone',
  'helicopter',
  'applause',
  'gunshot',
  'kick-9',
  'hat-9',
  'open-9',
  'clap-9',
  'rim-9',
  'acid',
];

describe('instrument catalog', () => {
  it('lists the eight families in order', () => {
    expect(CATEGORIES.map((category) => category.id)).toEqual(['keys', 'bowed', 'plucked', 'winds', 'brass', 'percussion', 'voice', 'synths']);
  });

  it('keeps ids unique, shorts short, and categories known', () => {
    const ids = INSTRUMENTS.map((instrument) => instrument.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set<string>(CATEGORIES.map((category) => category.id));
    for (const instrument of INSTRUMENTS) {
      expect(instrument.short.length).toBeLessThanOrEqual(7);
      expect(categories.has(instrument.category)).toBe(true);
    }
  });

  it('does not step an unpitched instrument', () => {
    for (const instrument of INSTRUMENTS) {
      if (!instrument.pitched) expect(instrument.steps).toBe(false);
    }
  });

  it('plays the eight built-in voices as themselves', () => {
    for (const id of builtIns) expect(instrumentById(id)?.voice).toBe(id);
    expect(instrumentById('kick')).toMatchObject({ pitched: true, steps: false });
    expect(instrumentById('snare')).toMatchObject({ pitched: false });
    expect(instrumentById('hat')).toMatchObject({ pitched: false });
  });

  it('includes every general MIDI program and the extra kit', () => {
    const ids = new Set<string>(INSTRUMENTS.map((instrument) => instrument.id));
    expect(catalogIds.filter((id) => !ids.has(id))).toEqual([]);
    expect(INSTRUMENTS).toHaveLength(builtIns.length + catalogIds.length);
  });

  it('looks an instrument up by id and by family', () => {
    expect(instrumentById('violin')).toMatchObject({ id: 'violin', name: 'Violin' });
    expect(instrumentsIn('brass').map((instrument) => instrument.id)).toContain('trumpet');
    expect(isInstrumentId('piano')).toBe(true);
    expect(isInstrumentId('laser')).toBe(false);
    expect(isKick('kick')).toBe(true);
    expect(isKick('kick-9')).toBe(true);
    expect(isKick('hat-9')).toBe(false);
    expect(isKick('acid')).toBe(false);
  });

  it('resolves the piece’s machines through the registry', () => {
    const machine = { id: 'syn-fog', name: 'Fog Lead', short: 'fog', hint: 'misty', patch: DEFAULT_PATCH };
    expect(instrumentById('syn-fog')).toBeUndefined();
    setMachines([machineInstrument(machine)]);
    expect(instrumentById('syn-fog')).toMatchObject({ voice: 'synth', name: 'Fog Lead', pitched: true, steps: true });
    expect(machineById('syn-fog')?.id).toBe('syn-fog');
    expect(instrumentById('violin')).toMatchObject({ id: 'violin' });
    expect(isKick('syn-fog')).toBe(false);
    setMachines([]);
    expect(instrumentById('syn-fog')).toBeUndefined();
  });
});
