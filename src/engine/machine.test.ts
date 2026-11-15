import { describe, expect, it } from 'vitest';
import { acidSlides, acidTone, kickBodyHz, kickStartHz } from './machine';
import { echoDelaySeconds, ECHO_MAX_SECONDS, pumpGain } from './mixer';

describe('club drums and acid', () => {
  it('drops a mid-range note down to a kick body, and starts the pitch above it', () => {
    expect(kickBodyHz(261.63)).toBeCloseTo(65.4075, 3);
    expect(kickBodyHz(55)).toBe(55);
    expect(kickBodyHz(20)).toBe(36);
    expect(kickBodyHz(0)).toBe(49);
    expect(kickStartHz(kickBodyHz(261.63))).toBeGreaterThan(kickBodyHz(261.63));
    expect(kickStartHz(65)).toBeLessThanOrEqual(240);
  });

  it('opens the acid filter on an accent and keeps an ordinary note darker', () => {
    const plain = acidTone(65, 1, false);
    const accent = acidTone(65, 1, true);
    expect(accent.cutoff).toBeGreaterThan(plain.cutoff * 1.5);
    expect(accent.q).toBeGreaterThan(plain.q);
    expect(acidTone(130, 1, true).cutoff).toBeGreaterThan(acidTone(65, 1, true).cutoff);
    expect(acidSlides(1.2, 1)).toBe(true);
    expect(acidSlides(1, 1)).toBe(false);
  });

  it('ducks toward silence as pump goes up, and stays put when pump is off', () => {
    expect(pumpGain(0)).toBe(1);
    expect(pumpGain(1)).toBeCloseTo(0.08, 5);
    expect(pumpGain(0.5)).toBeGreaterThan(pumpGain(1));
    expect(pumpGain(0.5)).toBeLessThan(1);
  });

  it('keeps a slow piece long echo inside the delay range', () => {
    // Rast at Dusk asked for 1.5 beats at 66 bpm: 1.364 s, past the 1 s a
    // FeedbackDelay defaults to. The ramp threw and took the app down.
    expect(echoDelaySeconds(1.5, 60 / 66)).toBeCloseTo(1.3636, 3);
    expect(echoDelaySeconds(4, 60 / 50)).toBeCloseTo(4.8, 5);
    expect(echoDelaySeconds(1 / 16, 60 / 200)).toBeGreaterThan(0);
    expect(echoDelaySeconds(-2, 0.5)).toBe(0);
    expect(echoDelaySeconds(9, 2)).toBe(ECHO_MAX_SECONDS);
  });
});
