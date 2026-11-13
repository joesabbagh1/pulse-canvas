// Pulse Canvas deck. The AI talks MCP on stdin. The open page pulls commands
// from this process over localhost and applies them to the canvas.
//
//   npm run dev     the canvas
//   npm run deck    this server
//
// Sound needs a click: press Play in the page once. After that the deck can
// start and stop. Logs go to stderr; stdout is the MCP transport.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { DECK_PORT, DeckSession } from '../src/deck/session.ts';

const session = new DeckSession();

const INSTRUCTIONS = `You are the DJ of a Pulse Canvas. Distance is time: a link's length in beats is how long a pulse takes to travel it, so moving a block rewrites the rhythm while the piece plays. Look first, and use the ids look returns. Perform the open canvas: play and stop, fire blocks, ride each region's mix, nudge blocks, and stretch links. Pressing Play in the browser once is required before you can make sound.`;

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json),
    'access-control-allow-origin': '*',
    'access-control-allow-private-network': 'true',
  });
  res.end(json);
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('too big'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listen() {
  const http = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-private-network', 'true');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (req.method === 'GET' && path === '/pull') {
      const closed = new Promise<void>((resolve) => req.on('close', () => resolve()));
      void session.pull(20_000, closed).then((result) => {
        if (res.writableEnded || res.destroyed) return;
        if (result.status === 'job') send(res, 200, { id: result.id, command: result.command });
        else send(res, 200, result);
      });
      return;
    }
    if (req.method === 'POST' && path === '/reply') {
      void readBody(req)
        .then((raw) => {
          const body = JSON.parse(raw) as { id?: unknown; ok?: unknown; text?: unknown; error?: unknown };
          if (typeof body.id !== 'string' || typeof body.ok !== 'boolean') {
            send(res, 400, { error: 'A reply needs an id and ok.' });
            return;
          }
          const accepted = session.reply(body.id, {
            ok: body.ok,
            ...(typeof body.text === 'string' ? { text: body.text } : {}),
            ...(typeof body.error === 'string' ? { error: body.error } : {}),
          });
          send(res, accepted ? 200 : 404, { ok: accepted });
        })
        .catch(() => {
          if (!res.writableEnded) send(res, 400, { error: 'The reply was not readable.' });
        });
      return;
    }
    send(res, 404, { error: 'Not a deck route.' });
  });
  http.on('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${DECK_PORT} is already in use. Stop the other deck first.` : err.message);
    process.exit(1);
  });
  http.listen(DECK_PORT, '127.0.0.1');
  return http;
}

async function call(command: unknown) {
  try {
    const reply = await session.ask(command);
    if (!reply.ok) {
      return { content: [{ type: 'text' as const, text: reply.error ?? 'The canvas refused.' }], isError: true as const };
    }
    return { content: [{ type: 'text' as const, text: reply.text ?? 'Done.' }] };
  } catch (err) {
    const text = err instanceof Error ? err.message : 'The deck failed.';
    return { content: [{ type: 'text' as const, text }], isError: true as const };
  }
}

const server = new McpServer({ name: 'pulse-canvas', version: '0.1.0' }, { instructions: INSTRUCTIONS });

server.registerTool(
  'look',
  {
    title: 'Look at the canvas',
    description:
      'See the open Pulse Canvas: tempo, whether it is playing, regions (mixer channels), blocks, links and loops. A link length in beats is how long a pulse takes to travel it. Call this before changing anything, and use the ids it returns.',
    annotations: { readOnlyHint: true },
  },
  async () => call({ op: 'look' }),
);

server.registerTool(
  'transport',
  {
    title: 'Play, stop, or set the tempo',
    description:
      'Start or stop the canvas, or set the tempo from 50 to 200 bpm. Omit action to change only the tempo. Starting sends a pulse from every start block. The person has to press Play in the browser once before this can make sound; after that you can start and stop.',
    inputSchema: {
      action: z.enum(['play', 'stop']).optional().describe('Start or stop. Omit to leave playback as it is.'),
      bpm: z.number().optional().describe('Tempo in beats per minute, from 50 to 200.'),
    },
  },
  async ({ action, bpm }) => call({ op: 'transport', ...(action ? { action } : {}), ...(bpm !== undefined ? { bpm } : {}) }),
);

server.registerTool(
  'hit',
  {
    title: 'Fire a pulse from a block',
    description:
      'While the canvas is playing, fire a pulse from a block. Pass its id, its performance key (one letter or digit), or its instrument name when only one block has that name. A start block walks the links from there. Any other block sounds and sends the pulse on.',
    inputSchema: {
      block: z.string().describe('Block id, performance key, or instrument name.'),
    },
  },
  async ({ block }) => call({ op: 'hit', block }),
);

server.registerTool(
  'mix',
  {
    title: 'Ride a region mix',
    description:
      'Set a region\'s mixer channel. Pass its id, name, or performance key. Omit any field you are not changing. level is decibels (-40 is silent, 0 is unity, up to +6). pan is -1 (left) to 1 (right). tone is a low-pass, 0 (dark) to 1 (open). echo and reverb are wet amounts, 0 to 1. echoBeats is the echo time in beats (0.25 to 4). swing is 0 (straight) to 1 (triplet), on 8ths or 16ths. humanize is 0 to 1. Swing and humanize move when notes sound, not when pulses arrive, so loops stay in time.',
    inputSchema: {
      region: z.string().describe('Region id, name, or performance key.'),
      mute: z.boolean().optional().describe('True mutes the region, false unmutes it.'),
      level: z.number().optional().describe('Level in decibels, from -40 to +6.'),
      pan: z.number().optional().describe('Pan, -1 left to 1 right.'),
      tone: z.number().optional().describe('Filter, 0 dark to 1 open.'),
      echo: z.number().optional().describe('Echo wet amount, 0 to 1.'),
      echoBeats: z.number().optional().describe('Echo time in beats, 0.25 to 4.'),
      reverb: z.number().optional().describe('Reverb wet amount, 0 to 1.'),
      swing: z.number().optional().describe('Swing amount, 0 straight to 1 triplet.'),
      swingGrid: z.enum(['8ths', '16ths']).optional().describe('Which notes swing.'),
      humanize: z.number().optional().describe('Random timing and loudness, 0 to 1.'),
    },
  },
  async (args) => call({ op: 'mix', ...args }),
);

server.registerTool(
  'nudge',
  {
    title: 'Move a block',
    description:
      'Move one block by dx and dy beats. Right is +dx. Down the canvas is +dy, so a negative dy moves it up on screen. Bend points stay where they are. A link\'s travel time is its length, so moving a block toward another shortens that link and moving it away lengthens it. This changes the rhythm while the piece plays. With Snap ¼ on, the heard length rounds to a quarter beat, so a small move may not change it until the length crosses the next quarter. At most 32 beats at a time.',
    inputSchema: {
      block: z.string().describe('Block id, performance key, or instrument name.'),
      dx: z.number().describe('Beats to the right. Negative moves left.'),
      dy: z.number().describe('Beats down the canvas. Negative moves up.'),
    },
  },
  async ({ block, dx, dy }) => call({ op: 'nudge', block, dx, dy }),
);

server.registerTool(
  'stretch',
  {
    title: 'Set a link length',
    description:
      'Set one link\'s travel time in beats without moving its blocks, by bending the link. Pass the link id, or the two blocks, like "Start to Kick". It cannot be shorter than the straight line between the blocks; move a block closer for that. With Snap ¼ on, the length you hear rounds to a quarter beat. At most 64 beats.',
    inputSchema: {
      link: z.string().describe('Link id, or "From to To" naming the two blocks.'),
      beats: z.number().describe('How many beats a pulse takes to travel the link.'),
    },
  },
  async ({ link, beats }) => call({ op: 'stretch', link, beats }),
);

const http = listen();
console.error(`Pulse Canvas deck on http://127.0.0.1:${DECK_PORT}`);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stdin.on('end', () => {
  http.close();
  session.close();
});
