import { describe, expect, it } from 'vitest';
import { clampPatch, cutoffHz, cutoffLabel, cutoffNorm, DEFAULT_PATCH, machineInstrument, machineShort, PRESETS, synthNoteSeconds } from './synth';

describe('synth machines', () => {
  it('clamps a patch from anywhere to safe defaults', () => {
    expect(clampPatch(null)).toEqual(DEFAULT_PATCH);
    expect(clampPatch('nonsense')).toEqual(DEFAULT_PATCH);
    const clamped = clampPatch({
      wave: 'flute',
      cutoff: 999999,
      q: 0,
      attack: -4,
      decay: 0,
      sustain: 7,
      release: -1,
      mode: 'duo',
      glide: 9,
      gain: 30,
    });
    expect(clamped).toEqual({ ...DEFAULT_PATCH, cutoff: 14000, q: 0.1, attack: 0, decay: 0.01, sustain: 1, release: 0.01, glide: 0.5, gain: 0 });
    expect(clamped.wave).toBe(DEFAULT_PATCH.wave);
    expect(clamped.mode).toBe('poly');
  });

  it('keeps every known wave and mono mode', () => {
    for (const wave of ['sine', 'triangle', 'square', 'sawtooth', 'fatsawtooth']) {
      expect(clampPatch({ wave }).wave).toBe(wave);
    }
    expect(clampPatch({ mode: 'mono' }).mode).toBe('mono');
    expect(clampPatch({ attack: 3 }).attack).toBe(3);
  });

  it('maps the cutoff slider logarithmically and back', () => {
    expect(cutoffHz(0)).toBeCloseTo(60);
    expect(cutoffHz(1)).toBeCloseTo(14000);
    expect(cutoffNorm(cutoffHz(0.42))).toBeCloseTo(0.42);
    expect(cutoffNorm(cutoffHz(-3))).toBe(0);
    expect(cutoffNorm(cutoffHz(2))).toBe(1);
    expect(cutoffLabel(870)).toBe('870 Hz');
    expect(cutoffLabel(2200)).toBe('2.20 kHz');
  });

  it('dresses a machine as a catalog entry', () => {
    const machine = { id: 'syn-1', name: 'Fog Lead', short: 'fog', hint: 'misty', patch: { ...DEFAULT_PATCH, mode: 'mono' as const } };
    const inst = machineInstrument(machine);
    expect(inst).toMatchObject({
      id: 'syn-1',
      name: 'Fog Lead',
      short: 'fog',
      category: 'synths',
      hint: 'misty',
      pitched: true,
      steps: true,
      voice: 'synth',
      ...machine.patch,
    });
  });

  it('defaults a pattern note length from the tempo', () => {
    expect(synthNoteSeconds(2, 0.5)).toBe(2);
    expect(synthNoteSeconds(null, 0.5)).toBe(0.5);
    expect(synthNoteSeconds(null, 4)).toBe(1.6);
    expect(synthNoteSeconds(null, 0.05)).toBe(0.25);
  });

  it('offers presets that are complete patches', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(5);
    const names = new Set(PRESETS.map((preset) => preset.name));
    expect(names.size).toBe(PRESETS.length);
    for (const preset of PRESETS) {
      expect(clampPatch(preset.patch)).toEqual(preset.patch);
      expect(preset.hint.length).toBeGreaterThan(0);
    }
  });

  it('shorts a name for the block label', () => {
    expect(machineShort('  Fog Lead ')).toBe('Fog Lea');
    expect(machineShort('Everything-at-once')).toBe('Everyth');
  });
});
