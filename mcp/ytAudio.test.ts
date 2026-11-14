import { describe, expect, it } from 'vitest';
import { isYouTubeUrl, pickBitrate, withStaleHint, ytError } from './ytAudio';

describe('isYouTubeUrl', () => {
  it('takes the pasteable YouTube forms', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw')).toBe(true);
    expect(isYouTubeUrl('https://youtu.be/jNQXAC9IVRw')).toBe(true);
    expect(isYouTubeUrl('https://music.youtube.com/watch?v=jNQXAC9IVRw')).toBe(true);
    expect(isYouTubeUrl('https://m.youtube.com/shorts/jNQXAC9IVRw')).toBe(true);
    expect(isYouTubeUrl('youtube.com/watch?v=jNQXAC9IVRw&t=30s')).toBe(true);
    expect(isYouTubeUrl('  https://youtu.be/jNQXAC9IVRw  ')).toBe(true);
  });

  it('refuses everything else', () => {
    expect(isYouTubeUrl('https://vimeo.com/12345')).toBe(false);
    expect(isYouTubeUrl('https://youtube.com.evil.com/watch')).toBe(false);
    expect(isYouTubeUrl('ftp://youtube.com/watch')).toBe(false);
    expect(isYouTubeUrl('https://example.com/https://youtube.com/')).toBe(false);
    expect(isYouTubeUrl('my favourite song')).toBe(false);
    expect(isYouTubeUrl('')).toBe(false);
  });
});

describe('pickBitrate', () => {
  it('caps at 160 kbps when there is room', () => {
    expect(pickBitrate(undefined)).toBe(160);
    expect(pickBitrate(30)).toBe(160);
    expect(pickBitrate(600)).toBe(160);
  });

  it('shrinks for long videos to stay under the sample cap', () => {
    // 19.5 MB budget: 1200 s -> ~136 kbps, 2400 s -> ~68 kbps.
    expect(pickBitrate(1200)).toBe(136);
    expect(pickBitrate(2400)).toBe(68);
  });

  it('refuses videos even 64 kbps cannot fit', () => {
    expect(pickBitrate(2556)).toBeNull();
    expect(pickBitrate(7200)).toBeNull();
  });

  it('treats a live stream or broken duration as unknown, not zero', () => {
    expect(pickBitrate(0)).toBe(160);
    expect(pickBitrate(-5)).toBe(160);
  });
});

describe('ytError', () => {
  it('takes the last stderr line and strips the ERROR prefix', () => {
    expect(ytError('WARNING: skipped\nERROR: [youtube] Video unavailable', 'fallback')).toBe('[youtube] Video unavailable');
  });

  it('falls back when stderr says nothing useful', () => {
    expect(ytError('', 'The download failed.')).toBe('The download failed.');
    expect(ytError('\n', 'The download failed.')).toBe('The download failed.');
  });

  it('truncates long errors', () => {
    expect(ytError(`ERROR: ${'x'.repeat(400)}`, 'fallback').length).toBeLessThanOrEqual(300);
  });
});

describe('withStaleHint', () => {
  it('adds the upgrade hint to a 403', () => {
    expect(withStaleHint('unable to download video data: HTTP Error 403: Forbidden')).toContain('brew upgrade yt-dlp');
    expect(withStaleHint('ERROR: Forbidden')).toContain('brew upgrade yt-dlp');
  });

  it('leaves other errors alone', () => {
    expect(withStaleHint('[youtube] Video unavailable')).toBe('[youtube] Video unavailable');
  });
});
