import { describe, expect, it } from 'vitest';
import { jawTongueHz, khuurDroneHz } from './voices';

describe('jaw harp and morin khuur', () => {
  it('keeps the jaw harp tongue in range and on a harmonic of the note', () => {
    expect(jawTongueHz(100)).toBe(100);
    const mid = jawTongueHz(261.63);
    expect(mid).toBeGreaterThan(70);
    expect(mid).toBeLessThanOrEqual(130);
    expect(261.63 / mid).toBeCloseTo(Math.round(261.63 / mid), 5);
    const high = jawTongueHz(1760);
    expect(high).toBeGreaterThan(70);
    expect(high).toBeLessThanOrEqual(130);
    expect(1760 / high).toBeCloseTo(Math.round(1760 / high), 5);
  });

  it('drones the khuur a fifth below, or above when that would leave its range', () => {
    expect(khuurDroneHz(440)).toBeCloseTo((440 * 2) / 3, 5);
    expect(khuurDroneHz(60)).toBeCloseTo(90, 5);
  });
});
