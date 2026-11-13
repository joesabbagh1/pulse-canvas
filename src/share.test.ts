import { describe, expect, it, vi } from 'vitest';
import { EXAMPLES } from './examples';
import { loadSampleBytes, storeSampleBytes } from './engine/samples';
import { demoPiece } from './piece';
import { readPiece } from './readPiece';
import { datedName, decodeShare, encodeShare, pieceFromFile, pieceToFile, sharedCode, shareUrl } from './share';

vi.spyOn(console, 'warn').mockImplementation(() => {});

async function deflate(bytes: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('share links', () => {
  it('carry every example there and back', async () => {
    for (const { piece } of EXAMPLES) expect(await decodeShare(await encodeShare(piece))).toEqual(readPiece(piece));
  });

  it('stay short enough to paste anywhere', async () => {
    expect(shareUrl(await encodeShare(demoPiece()), 'https://example.com/').length).toBeLessThan(2500);
  });

  it('live in the fragment, so no server ever sees the piece', () => {
    const url = shareUrl('1.abc', 'https://example.com/app?x=1#old');
    expect(url).toBe('https://example.com/app?x=1#piece=1.abc');
    expect(sharedCode(new URL(url).hash)).toBe('1.abc');
    expect(sharedCode('#other=1')).toBeNull();
  });

  it('say what is wrong with a broken link', async () => {
    const code = await encodeShare(demoPiece());
    await expect(decodeShare(code.slice(0, code.length / 2))).rejects.toThrow('damaged');
    await expect(decodeShare('9.abc')).rejects.toThrow('newer version');
    await expect(decodeShare(`0.${base64url(new TextEncoder().encode('{"hello":1}'))}`)).rejects.toThrow("isn't a Pulse Canvas piece");
  });

  it('refuse a tiny link that inflates to something huge', async () => {
    const bomb = await deflate(new Uint8Array(50 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(100_000);
    await expect(decodeShare(`1.${base64url(bomb)}`)).rejects.toThrow('too big');
  });
});

describe('files', () => {
  const withSample = async (bytes: number[]) => {
    const id = await storeSampleBytes(new Uint8Array(bytes).buffer);
    const piece = demoPiece();
    piece.regions[0] = { ...piece.regions[0], sample: { id, name: 'bell.wav' } };
    return { id, piece };
  };

  it('carry the piece and its samples', async () => {
    const { id, piece } = await withSample([1, 2, 3, 4]);
    const opened = await pieceFromFile(await (await pieceToFile(piece)).text());
    expect(opened).toEqual(readPiece(piece));
    expect(new Uint8Array((await loadSampleBytes(id))!)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('store each sample under the id its bytes hash to, whatever the file claims', async () => {
    const { id, piece } = await withSample([9, 9, 9]);
    const file = JSON.parse(await (await pieceToFile(piece)).text());
    const claimed = 'smp-0000000000000000';
    file.piece.regions[0].sample.id = claimed;
    file.samples = { [claimed]: file.samples[id] };
    const opened = await pieceFromFile(JSON.stringify(file));
    expect(opened.regions[0].sample?.id).toBe(id);
  });

  it('open a bare piece too, and refuse anything else', async () => {
    expect(await pieceFromFile(JSON.stringify(demoPiece()))).toEqual(readPiece(demoPiece()));
    await expect(pieceFromFile('not json')).rejects.toThrow("isn't a Pulse Canvas file");
  });

  it('are named by date and time', () => {
    expect(datedName('wav', new Date(2026, 10, 13, 0, 45))).toBe('pulse-canvas-2026-11-13-0045.wav');
  });
});
