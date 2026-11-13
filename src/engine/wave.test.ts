import { describe, expect, it } from 'vitest';
import { PX_PER_BEAT } from './geometry';
import {
  compileWaves,
  heardCycleIds,
  motionBeats,
  motionSum,
  movedTone,
  sampleWave,
  simplifyStroke,
  stampOf,
  wavePartials,
} from './wave';

describe('waves', () => {
  it('reads a saw as a ramp from high to low', () => {
    const samples = sampleWave(stampOf('saw', { x: 0, y: 0 }).points)!;
    expect(samples[0]).toBeCloseTo(0.92, 1);
    expect(samples[Math.floor(samples.length / 2)]).toBeCloseTo(0, 1);
    expect(samples[samples.length - 1]).toBeLessThan(-0.85);
  });

  it('turns a sine into a single harmonic', () => {
    const { real, imag } = wavePartials(sampleWave(stampOf('sine', { x: 0, y: 0 }).points)!);
    expect(imag[1]).toBeGreaterThan(0.85);
    expect(Math.abs(real[1])).toBeLessThan(0.05);
    expect(Math.abs(imag[2])).toBeLessThan(0.05);
    expect(Math.abs(imag[3])).toBeLessThan(0.08);
  });

  it('keeps a square on its odd harmonics', () => {
    const { imag } = wavePartials(sampleWave(stampOf('square', { x: 0, y: 0 }).points)!);
    expect(imag[1]).toBeGreaterThan(0.9);
    expect(Math.abs(imag[2])).toBeLessThan(0.08);
    expect(imag[3]).toBeGreaterThan(0.2);
  });

  it('makes a decay that opens and then stays shut', () => {
    const { role, points } = stampOf('decay', { x: 0, y: 0 });
    const samples = sampleWave(points)!;
    expect(role).toBe('motion');
    expect(motionBeats(points, true)).toBe(2);
    expect(samples[0]).toBeGreaterThan(0.8);
    expect(samples[samples.length - 1]).toBeLessThan(-0.8);
    expect(samples.filter((s) => s < 0).length).toBeGreaterThan(samples.length * 0.6);
  });

  it('snaps a motion loop the way a link snaps', () => {
    const points = [
      { x: 0, y: 0 },
      { x: PX_PER_BEAT + 20, y: 0 },
    ];
    // 260px is 1.083 beats, which snap rounds to the nearest quarter: 1.
    expect(motionBeats(points, false)).toBeCloseTo((PX_PER_BEAT + 20) / PX_PER_BEAT, 5);
    expect(motionBeats(points, true)).toBe(1);
  });

  it('adds motions and wraps the phase', () => {
    const motions = [
      { samples: [0, 1], beats: 2 },
      { samples: [0.25, 0.25], beats: 1 },
    ];
    expect(motionSum(motions, 0)).toBeCloseTo(0.25);
    expect(motionSum(motions, 2)).toBeCloseTo(motionSum(motions, 0));
    expect(movedTone(0.5, 0)).toBe(0.5);
    expect(movedTone(0.2, 3)).toBe(1);
    expect(movedTone(0.2, -3)).toBe(0);
  });

  it('gives a region its last cycle and every motion', () => {
    const saw = { id: 'saw', ...stampOf('saw', { x: 0, y: 0 }) };
    const sine = { id: 'sine', ...stampOf('sine', { x: 10, y: 0 }) };
    const decay = { id: 'decay', ...stampOf('decay', { x: 0, y: 40 }) };
    const outside = { id: 'out', ...stampOf('square', { x: 800, y: 0 }) };
    const regionOf = (at: { x: number; y: number }) => (at.x < 400 ? 'lead' : undefined);
    const program = compileWaves([saw, sine, decay, outside], regionOf, true);
    expect(program.get('lead')!.motions).toHaveLength(1);
    expect(program.get('lead')!.motions[0].beats).toBe(2);
    expect(program.get('lead')!.cycle!.imag[1]).toBeGreaterThan(0.85);
    expect(program.get('')!.cycle).toBeTruthy();
    expect(heardCycleIds([saw, sine, outside], regionOf)).toEqual(new Set(['sine', 'out']));
  });

  it('keeps an instrument drawing off the shared tone and filter', () => {
    const tone = { id: 'tone', ...stampOf('saw', { x: 0, y: 0 }) };
    const violin = { id: 'violin', ...stampOf('sine', { x: 20, y: 0 }), instrument: 'violin' };
    const violinCutoff = { id: 'violin-cut', ...stampOf('decay', { x: 20, y: 30 }), instrument: 'violin' };
    const regionOf = () => 'lead';
    const program = compileWaves([tone, violin, violinCutoff], regionOf, true);
    const bus = program.get('lead')!;
    expect(bus.motions).toHaveLength(0);
    expect(bus.cycle).toBeTruthy();
    expect(bus.instruments.get('violin')!.cycle!.imag[1]).toBeGreaterThan(0.85);
    expect(bus.instruments.get('violin')!.motions).toHaveLength(1);
    expect(heardCycleIds([tone, violin], regionOf)).toEqual(new Set(['tone', 'violin']));
  });

  it('thins a pencil stroke', () => {
    const raw = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyStroke(raw).length).toBeLessThan(raw.length);
    expect(simplifyStroke(raw)[0]).toEqual({ x: 0, y: 0 });
    expect(simplifyStroke([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 400, y: 10 }])).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 10 },
    ]);
  });
});
