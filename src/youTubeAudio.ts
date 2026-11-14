// The Background lane's YouTube import. The dev server (see mcp/ytAudio.ts)
// converts the video to an MP3 with yt-dlp; this turns the reply into the same
// File the "Load a file…" button hands over, so one path loads both.

export interface YouTubeInfo {
  title: string;
  seconds?: number;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (data && typeof data.error === 'string' && data.error) return data.error;
  } catch {
    // A body that isn't JSON says nothing; use the fallback.
  }
  return fallback;
}

function sampleName(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${clean || 'YouTube audio'}.mp3`;
}

/** The quick lookup, so the page can say what it is about to download. */
export async function youtubeInfo(url: string): Promise<YouTubeInfo> {
  const res = await post('/yt-info', { url });
  if (!res.ok) throw new Error(await errorOf(res, "Couldn't look that video up."));
  const data = (await res.json()) as { title?: unknown; seconds?: unknown };
  return {
    title: typeof data.title === 'string' && data.title ? data.title : 'YouTube audio',
    seconds: typeof data.seconds === 'number' && data.seconds > 0 ? data.seconds : undefined,
  };
}

/** The MP3 as a File named after the video. Throws with a message a person can read. */
export async function youtubeAudio(url: string, info: YouTubeInfo): Promise<File> {
  const res = await post('/yt-audio', { url, ...(info.seconds ? { seconds: info.seconds } : {}) });
  if (!res.ok) throw new Error(await errorOf(res, "Couldn't download the audio."));
  const bytes = await res.arrayBuffer();
  return new File([bytes], sampleName(info.title), { type: 'audio/mpeg' });
}
