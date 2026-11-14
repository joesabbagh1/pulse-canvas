import { afterEach, describe, expect, it, vi } from 'vitest';
import { youtubeAudio, youtubeInfo } from './youTubeAudio';

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function failJson(error: string) {
  return new Response(JSON.stringify({ error }), { status: 400, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('youtubeInfo', () => {
  it('reads the title and length the server found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ title: 'Me at the zoo', seconds: 19 })));
    const info = await youtubeInfo('https://youtu.be/jNQXAC9IVRw');
    expect(info).toEqual({ title: 'Me at the zoo', seconds: 19 });
    expect(fetch).toHaveBeenCalledWith('/yt-info', expect.objectContaining({ method: 'POST' }));
  });

  it(`shows the server's message when the lookup fails`, async () => {
    vi.stubGlobal('fetch', vi.fn(async () => failJson("That's a playlist. Paste a single video's URL.")));
    await expect(youtubeInfo('https://youtube.com/playlist?list=x')).rejects.toThrow("That's a playlist. Paste a single video's URL.");
  });

  it('uses its own words when the server says nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway timeout', { status: 502 })));
    await expect(youtubeInfo('https://youtu.be/jNQXAC9IVRw')).rejects.toThrow("Couldn't look that video up.");
  });
});

describe('youtubeAudio', () => {
  it('names the File after the video, without characters a file name may not have', async () => {
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(mp3, { status: 200, headers: { 'content-type': 'audio/mpeg' } })));
    const file = await youtubeAudio('https://youtu.be/jNQXAC9IVRw', { title: 'AC/DC: Back In Black?', seconds: 19 });
    expect(file.name).toBe('AC DC Back In Black.mp3');
    expect(file.type).toBe('audio/mpeg');
    expect(file.size).toBe(mp3.byteLength);
    expect(fetch).toHaveBeenCalledWith('/yt-audio', expect.objectContaining({ method: 'POST' }));
  });

  it('passes the length along when it is known', async () => {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        calls.push([path, init]);
        return new Response(new Uint8Array(4), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
      }),
    );
    await youtubeAudio('https://youtu.be/jNQXAC9IVRw', { title: 'x', seconds: 19 });
    await youtubeAudio('https://youtu.be/jNQXAC9IVRw', { title: 'x' });
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ url: 'https://youtu.be/jNQXAC9IVRw', seconds: 19 });
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ url: 'https://youtu.be/jNQXAC9IVRw' });
  });

  it('falls back to a plain name when the title is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(4), { status: 200, headers: { 'content-type': 'audio/mpeg' } })));
    const file = await youtubeAudio('https://youtu.be/jNQXAC9IVRw', { title: '  ' });
    expect(file.name).toBe('YouTube audio.mp3');
  });

  it(`shows the server's message when the download fails`, async () => {
    vi.stubGlobal('fetch', vi.fn(async () => failJson('yt-dlp is not installed. Run: brew install yt-dlp ffmpeg')));
    await expect(youtubeAudio('https://youtu.be/jNQXAC9IVRw', { title: 'x' })).rejects.toThrow('brew install yt-dlp ffmpeg');
  });
});
