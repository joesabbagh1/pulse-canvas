// YouTube import for the Background lane. The dev server exposes two routes
// (see vite.config.ts) that shell out to yt-dlp and ffmpeg, both installed by
// `brew install yt-dlp ffmpeg`:
//
//   POST /yt-info   {url}              -> {title, seconds}   one quick lookup
//   POST /yt-audio  {url, seconds?}    -> audio/mpeg bytes
//
// The MP3 is capped to fit the page's sample store, which keeps files under
// 20 MB: the bitrate drops with the video's length until 64 kbps, and longer
// videos are refused.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const SAMPLE_BUDGET_BYTES = 19.5 * 1024 * 1024;
const MIN_BITRATE_KBPS = 64;
const MAX_BITRATE_KBPS = 160;
const INFO_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 8 * 60_000;
const NO_YTDLP = 'yt-dlp is not installed. Run: brew install yt-dlp ffmpeg';

const YT_HOSTS = ['youtube.com', 'youtu.be'];

/** Accepts the YouTube URLs a person actually pastes, and nothing else. */
export function isYouTubeUrl(raw: string): boolean {
  try {
    const candidate = raw.trim();
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return YT_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
  } catch {
    return false;
  }
}

/** A bitrate that keeps the MP3 under the page's sample cap; null when even the floor would not fit. */
export function pickBitrate(seconds: number | undefined): number | null {
  if (!(seconds && seconds > 0)) return MAX_BITRATE_KBPS;
  const kbps = Math.floor((SAMPLE_BUDGET_BYTES * 8) / seconds / 1000);
  if (kbps < MIN_BITRATE_KBPS) return null;
  return Math.min(MAX_BITRATE_KBPS, kbps);
}

/** A failure the page should show the person, rather than one of ours. */
class YtFail extends Error {}

/** yt-dlp reports failures as lines on stderr; the last readable one is the useful one. */
export function ytError(stderr: string, fallback: string): string {
  const line = stderr
    .split('\n')
    .filter((l) => l.trim())
    .pop();
  const text = (line ?? '').replace(/^ERROR:\s*/i, '').trim();
  return (text || fallback).slice(0, 300);
}

/** A 403 on the media is almost always YouTube having moved and yt-dlp being stale. */
export function withStaleHint(message: string): string {
  return /403|forbidden/i.test(message) ? `${message} — yt-dlp is probably out of date; run: brew upgrade yt-dlp` : message;
}

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], timeoutMs: number, cwd?: string): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 100_000) stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 100_000) stderr += chunk;
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new YtFail(NO_YTDLP) : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

interface Info {
  title: string;
  seconds?: number;
}

async function fetchInfo(url: string): Promise<Info> {
  const ran = await run('yt-dlp', ['-J', '--no-playlist', '--quiet', '--no-warnings', url], INFO_TIMEOUT_MS).catch((err: Error) => {
    throw err instanceof YtFail ? err : new YtFail("Couldn't look that video up.");
  });
  if (ran.code !== 0) throw new YtFail(withStaleHint(ytError(ran.stderr, 'YouTube refused the lookup.')));
  let meta: unknown;
  try {
    meta = JSON.parse(ran.stdout);
  } catch {
    throw new YtFail("Couldn't read that video's details.");
  }
  const entry = meta as { _type?: string; entries?: unknown; title?: unknown; duration?: unknown };
  if (entry._type === 'playlist' || Array.isArray(entry.entries)) throw new YtFail("That's a playlist. Paste a single video's URL.");
  return {
    title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : 'YouTube audio',
    seconds: typeof entry.duration === 'number' && entry.duration > 0 ? entry.duration : undefined,
  };
}

async function downloadMp3(url: string, seconds: number | undefined, dir: string): Promise<Buffer> {
  const kbps = pickBitrate(seconds);
  if (!kbps) throw new YtFail("This video is too long for a sample: the page keeps files under 20 MB.");
  const ran = await run(
    'yt-dlp',
    ['-x', '--audio-format', 'mp3', '--no-playlist', '--quiet', '--no-warnings', '--audio-quality', String(kbps), '-o', 'audio.%(ext)s', url],
    DOWNLOAD_TIMEOUT_MS,
    dir,
  );
  if (ran.code !== 0) throw new YtFail(withStaleHint(ytError(ran.stderr, 'The download failed.')));
  try {
    return await readFile(join(dir, 'audio.mp3'));
  } catch {
    throw new YtFail('The audio never landed. Try again.');
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req: IncomingMessage, limitBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new YtFail('The request was too big.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function ytRoute(pathname: string, req: IncomingMessage, res: ServerResponse) {
  let body: { url?: unknown; seconds?: unknown };
  try {
    body = JSON.parse(await readBody(req, 100_000));
  } catch {
    json(res, 400, { error: 'The request was not readable.' });
    return;
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!isYouTubeUrl(url)) {
    json(res, 400, { error: 'That is not a YouTube URL.' });
    return;
  }
  const seconds = typeof body.seconds === 'number' && body.seconds > 0 ? body.seconds : undefined;
  if (pathname === '/yt-info') {
    const info = await fetchInfo(url);
    json(res, 200, info);
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'pulse-yt-'));
  try {
    const bytes = await downloadMp3(url, seconds, dir);
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': bytes.byteLength });
    res.end(bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Dev-server middleware: the two POST routes, everything else passes on. */
export function ytAudioPlugin(): Plugin {
  return {
    name: 'yt-audio',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
        if (req.method !== 'POST' || (pathname !== '/yt-info' && pathname !== '/yt-audio')) {
          next();
          return;
        }
        ytRoute(pathname, req, res).catch((err: unknown) => {
          if (res.writableEnded) return;
          const error = err instanceof YtFail ? err.message : 'The YouTube converter failed.';
          json(res, err instanceof YtFail ? 400 : 500, { error });
        });
      });
    },
  };
}
