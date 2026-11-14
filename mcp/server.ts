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

const INSTRUCTIONS = `You are playing a Pulse Canvas, and you can also build it. Distance is time: a link's length in beats is how long a pulse takes to travel it. Look first and use the ids it returns. catalog lists instruments and scales. add_block, edit_block, link, edit_link, remove, add_region, edit_region, tune and wave change the piece. wave points redraw a cycle or a cutoff. new_canvas, open_canvas, rename_canvas and delete_canvas change which canvas is open. examples and open_example load a ready-made piece into the open canvas. undo and redo step through edits. bed edits the background once a file is loaded in the browser, and sample copies or clears a region's audio file. play_instrument plays notes on an instrument, outside the pulse graph. record starts and stops a WAV of everything heard. take stores a performance and can place it on the canvas as linked blocks. transport, hit, mix, nudge and stretch perform the canvas. Pressing Play in the browser once is required before you can make sound.`;

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
      'See the open Pulse Canvas: tempo, whether it is playing, the other canvases, regions (mixer channels), blocks, links, loops, waves, and the background. A link length in beats is how long a pulse takes to travel it. Call this before changing anything, and use the ids it returns.',
    annotations: { readOnlyHint: true },
  },
  async () => call({ op: 'look' }),
);

server.registerTool(
  'new_canvas',
  {
    title: 'Create a new canvas',
    description:
      'Save the open canvas and open a new empty one. The piece you had stays in the list. Pass a name, or leave it and the canvas is named Canvas, Canvas 2, and so on. The new canvas keeps the current tempo, snap and tuning, and has one start block. At most 40 canvases.',
    inputSchema: {
      name: z.string().optional().describe('Name for the new canvas. Omit to pick the next Canvas name.'),
    },
  },
  async ({ name }) => call({ op: 'new_canvas', ...(name !== undefined ? { name } : {}) }),
);

server.registerTool(
  'open_canvas',
  {
    title: 'Open a canvas',
    description: 'Open a canvas from this browser by its name or id. The one you leave stays in the list. Look lists them.',
    inputSchema: {
      canvas: z.string().describe('Canvas name or id.'),
    },
  },
  async ({ canvas }) => call({ op: 'open_canvas', canvas }),
);

server.registerTool(
  'rename_canvas',
  {
    title: 'Rename a canvas',
    description: 'Rename a canvas. Omit canvas to rename the one that is open.',
    inputSchema: {
      name: z.string().describe('The new name.'),
      canvas: z.string().optional().describe('Canvas name or id. Omit for the open canvas.'),
    },
  },
  async ({ name, canvas }) => call({ op: 'rename_canvas', name, ...(canvas !== undefined ? { canvas } : {}) }),
);

server.registerTool(
  'delete_canvas',
  {
    title: 'Delete a canvas',
    description:
      'Delete a canvas from this browser. Omit canvas to delete the one that is open. The last canvas is replaced by a blank one, so the list is never empty. This is not undo.',
    annotations: { destructiveHint: true },
    inputSchema: {
      canvas: z.string().optional().describe('Canvas name or id. Omit for the open canvas.'),
    },
  },
  async ({ canvas }) => call({ op: 'delete_canvas', ...(canvas !== undefined ? { canvas } : {}) }),
);

server.registerTool(
  'examples',
  {
    title: 'List examples',
    description: 'List the ready-made pieces. open_example loads one into the canvas that is open.',
    annotations: { readOnlyHint: true },
  },
  async () => call({ op: 'examples' }),
);

server.registerTool(
  'open_example',
  {
    title: 'Open an example',
    description: 'Load an example into the canvas that is open, replacing what is there. Undo brings the piece back. Pass a title or an id from examples.',
    inputSchema: {
      example: z.string().describe('Example title or id, such as The tour or techno.'),
    },
  },
  async ({ example }) => call({ op: 'open_example', example }),
);

server.registerTool(
  'undo',
  {
    title: 'Undo',
    description: 'Undo the last edit on the open canvas. Nothing to undo when the piece has not changed.',
  },
  async () => call({ op: 'undo' }),
);

server.registerTool(
  'redo',
  {
    title: 'Redo',
    description: 'Redo an edit that was just undone.',
  },
  async () => call({ op: 'redo' }),
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
      'Set a region\'s mixer channel. Pass its id, name, or performance key. Omit any field you are not changing. level is decibels (-40 is silent, 0 is unity, up to +6). pan is -1 (left) to 1 (right). tone is a low-pass, 0 (dark) to 1 (open). echo and reverb are wet amounts, 0 to 1. echoBeats is the echo time in beats (0.25 to 4). drive is a soft clip, 0 to 1. pump is how far the level dips when a kick plays in another region, 0 to 1, coming back over pumpBeats beats (0.25 to 2). The kick\'s own region is not dipped. swing is 0 (straight) to 1 (triplet), on 8ths or 16ths. humanize is 0 to 1. Swing and humanize move when notes sound, not when pulses arrive, so loops stay in time.',
    inputSchema: {
      region: z.string().describe('Region id, name, or performance key.'),
      mute: z.boolean().optional().describe('True mutes the region, false unmutes it.'),
      level: z.number().optional().describe('Level in decibels, from -40 to +6.'),
      pan: z.number().optional().describe('Pan, -1 left to 1 right.'),
      tone: z.number().optional().describe('Filter, 0 dark to 1 open.'),
      echo: z.number().optional().describe('Echo wet amount, 0 to 1.'),
      echoBeats: z.number().optional().describe('Echo time in beats, 0.25 to 4.'),
      reverb: z.number().optional().describe('Reverb wet amount, 0 to 1.'),
      drive: z.number().optional().describe('Soft clip, 0 clean to 1.'),
      pump: z.number().optional().describe('How far the level dips when a kick plays elsewhere, 0 to 1.'),
      pumpBeats: z.number().optional().describe('How many beats the dip takes to come back, 0.25 to 2.'),
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

server.registerTool(
  'catalog',
  {
    title: 'List instruments and scales',
    description: 'List the scales on this piece, and the instruments whose name or id matches a query. With no query, only the scales are listed. kind start sends pulses. kind pattern adds a tone box with a starter pattern.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().optional().describe('Part of an instrument name or id, such as piano, kick or flute.'),
    },
  },
  async ({ query }) => call({ op: 'catalog', ...(query ? { query } : {}) }),
);

server.registerTool(
  'add_block',
  {
    title: 'Add a block',
    description:
      'Add a block. kind is start, pattern, or an instrument id or name from catalog. x and y are beats; right is +x and down the canvas is +y. Omit them and it sits to the right of the piece, or 1.5 beats right of from. from also links the new block to that one. degree is a scale degree. every, in beats, is only for a start block (0 fires once when play starts). pattern is Strudel mini-notation and makes a box that many beats wide. figure is roll, fall, spiral or wheel. level and tone are 0 to 1 on a pattern box. key is one letter or digit and fires a start block. code is the pulse language.',
    inputSchema: {
      kind: z.string().describe('start, pattern, or an instrument id or name.'),
      x: z.number().optional().describe('Beats from the origin, to the right.'),
      y: z.number().optional().describe('Beats from the origin, down the canvas.'),
      from: z.string().optional().describe('Block to link from.'),
      degree: z.number().optional().describe('Scale degree. Default 0, or one above a melodic from block.'),
      every: z.number().optional().describe('Start blocks: beats between pulses. 0 fires once.'),
      pattern: z.string().optional().describe('Mini-notation. Setting it makes a pattern box.'),
      beats: z.number().optional().describe('How long a pattern box is, in beats.'),
      figure: z.enum(['roll', 'fall', 'spiral', 'wheel']).optional().describe('How a pattern box draws.'),
      level: z.number().optional().describe('Pattern loudness, 0 to 1.'),
      tone: z.number().optional().describe('Pattern filter, 0 dark to 1 open.'),
      key: z.string().optional().describe('One letter or digit. Fires a start block.'),
      code: z.string().optional().describe('Pulse code for this block.'),
    },
  },
  async (args) => call({ op: 'add_block', ...args }),
);

server.registerTool(
  'edit_block',
  {
    title: 'Edit a block',
    description:
      'Change a block. Pass only the fields you want. x and y are its new position in beats. clearPattern turns a box back into a disc. clearCode and clearKey remove those. every is only for start blocks. A pattern figure is roll, fall, spiral or wheel.',
    inputSchema: {
      block: z.string().describe('Block id, performance key, or instrument name.'),
      kind: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      degree: z.number().optional(),
      every: z.number().optional(),
      pattern: z.string().optional(),
      beats: z.number().optional(),
      figure: z.enum(['roll', 'fall', 'spiral', 'wheel']).optional(),
      level: z.number().optional(),
      tone: z.number().optional(),
      key: z.string().optional(),
      code: z.string().optional(),
      clearPattern: z.boolean().optional(),
      clearCode: z.boolean().optional(),
      clearKey: z.boolean().optional(),
    },
  },
  async (args) => call({ op: 'edit_block', ...args }),
);

server.registerTool(
  'link',
  {
    title: 'Link two blocks',
    description: 'Draw a link from one block to another. A pulse travels it, and the length in beats is how long that takes. One link per direction.',
    inputSchema: {
      from: z.string().describe('Block the pulse leaves.'),
      to: z.string().describe('Block the pulse arrives at.'),
      code: z.string().optional().describe('Pulse code for this link.'),
    },
  },
  async ({ from, to, code }) => call({ op: 'link', from, to, ...(code !== undefined ? { code } : {}) }),
);

server.registerTool(
  'edit_link',
  {
    title: 'Edit a link',
    description: 'Set a link\'s code, or straighten it so the pulse takes the straight line. stretch changes its length.',
    inputSchema: {
      link: z.string().describe('Link id, or "From to To".'),
      code: z.string().optional(),
      clearCode: z.boolean().optional(),
      straighten: z.boolean().optional(),
    },
  },
  async (args) => call({ op: 'edit_link', ...args }),
);

server.registerTool(
  'remove',
  {
    title: 'Remove a block, link, region, or wave',
    description: 'Remove one thing by id or name. Removing a block also removes its links. Removing a region leaves the blocks.',
    inputSchema: {
      target: z.string().describe('Id or name of a block, link, region, or wave.'),
    },
  },
  async ({ target }) => call({ op: 'remove', target }),
);

server.registerTool(
  'add_region',
  {
    title: 'Add a region',
    description:
      'Add a mixer channel, which also has its own key and scale. x and y are the top-left in beats, w and h the size. around names blocks to wrap, separated by commas. Omit the box and it sits to the right of the piece. root is a note name or a frequency.',
    inputSchema: {
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
      around: z.string().optional().describe('Block ids or names to wrap, separated by commas.'),
      scale: z.string().optional(),
      root: z.union([z.string(), z.number()]).optional(),
      key: z.string().optional().describe('One letter or digit. Mutes the region.'),
    },
  },
  async (args) => call({ op: 'add_region', ...args }),
);

server.registerTool(
  'edit_region',
  {
    title: 'Edit a region',
    description: 'Rename a region, retune it, move or resize it, or set its mute key. x and y are the top-left in beats. Moving a region carries what is inside it. mix changes the fader.',
    inputSchema: {
      region: z.string(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
      scale: z.string().optional(),
      root: z.union([z.string(), z.number()]).optional(),
      key: z.string().optional(),
      clearKey: z.boolean().optional(),
    },
  },
  async (args) => call({ op: 'edit_region', ...args }),
);

server.registerTool(
  'tune',
  {
    title: 'Tune the canvas',
    description: 'Set the scale and root of everything outside a region, or turn snap on and off. Snap rounds a link\'s heard length to a quarter beat. root is a note name, like D, or a frequency in Hz.',
    inputSchema: {
      scale: z.string().optional(),
      root: z.union([z.string(), z.number()]).optional(),
      snap: z.boolean().optional(),
    },
  },
  async (args) => call({ op: 'tune', ...args }),
);

server.registerTool(
  'wave',
  {
    title: 'Draw or change a wave',
    description:
      'Add a saw, square, sine or decay stamp. A cycle replaces a tone. Decay is a cutoff motion whose width is the loop, in beats. Aim it at an instrument, or leave it for the region. Pass wave to move one (dx, dy in beats), redraw it, retarget it, or remove it. points are the drawing in beats, the same axes as blocks: right is +x and down is +y. About 0.3 beats above and below the line is full scale. At least 2 points, at most 64. role is cycle or motion. instrument region clears the aim.',
    inputSchema: {
      stamp: z.enum(['saw', 'square', 'sine', 'decay']).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      instrument: z.string().optional(),
      wave: z.string().optional().describe('Id of a wave to change.'),
      role: z.enum(['cycle', 'motion']).optional(),
      points: z
        .array(z.object({ x: z.number().describe('Beats to the right.'), y: z.number().describe('Beats down the canvas. Up is negative.') }))
        .optional()
        .describe('Replace the drawing. At least 2 points.'),
      dx: z.number().optional(),
      dy: z.number().optional(),
      remove: z.boolean().optional(),
      clearInstrument: z.boolean().optional(),
    },
  },
  async (args) => call({ op: 'wave', ...args }),
);

server.registerTool(
  'synth',
  {
    title: 'Manage synth machines',
    description:
      "Create, edit, list or remove the canvas's synth machines: user-designed instruments (a wave through a resonant filter and an envelope) that blocks play like any instrument. add takes a name, optionally a preset (acid, pad, bass, pluck, keys) and any patch fields. edit and remove take a machine by name or id. Patch fields: wave (sine, triangle, square, sawtooth, fatsawtooth), cutoff (Hz, 60 to 14000), q (resonance, 0.1 to 18), attack, decay, release (seconds), sustain (0 to 1), mode (poly or mono; mono folds chords into the last note), glide (mono slide, seconds), gain (-30 to 0 dB). Point blocks at a machine with add_block or edit_block kind set to its id.",
    inputSchema: {
      action: z.enum(['list', 'add', 'edit', 'remove']).optional(),
      name: z.string().optional().describe("add: the machine's name. edit or remove: which machine (name, label or id)."),
      preset: z.string().optional().describe('Starting patch for add: acid, pad, bass, pluck or keys.'),
      machine: z.string().optional().describe('Machine to edit or remove, by name or id.'),
      wave: z.enum(['sine', 'triangle', 'square', 'sawtooth', 'fatsawtooth']).optional(),
      cutoff: z.number().optional().describe('Low-pass cutoff, 60 to 14000 Hz.'),
      q: z.number().optional().describe('Resonance, 0.1 to 18.'),
      attack: z.number().optional().describe('Seconds, 0 to 4.'),
      decay: z.number().optional().describe('Seconds, 0.01 to 4.'),
      sustain: z.number().optional().describe('0 to 1.'),
      release: z.number().optional().describe('Seconds, 0.01 to 6.'),
      mode: z.enum(['poly', 'mono']).optional(),
      glide: z.number().optional().describe('Mono slide between notes, seconds, 0 to 0.5.'),
      gain: z.number().optional().describe('Level in dB, -30 to 0.'),
    },
  },
  async (args) => call({ op: 'synth', ...args }),
);

const note = z.object({
  degree: z.number().describe('Scale degree. 0 is the root.'),
  beats: z.number().describe('How long the note is held, in beats.'),
  at: z.number().optional().describe('When it starts, in beats from now. Omit to play notes in a row.'),
  velocity: z.number().optional().describe('Loudness, 0 to 1.'),
});

server.registerTool(
  'bed',
  {
    title: 'Edit the background',
    description:
      'Change the background file that plays behind the piece. A file has to be loaded in the browser first; this cannot pick one. level is 0 to 1 for the whole file. clear removes it. whole plays the file from beat 0 as one cut. clip is a cut id from look; with one cut you can omit it. beat moves a cut, in beats. trim is start or end, and delta is how far that edge moves, in beats. split cuts it at the playhead while playing, or in half when stopped. duplicate copies it. remove deletes that cut. mute, gain (0 to 1), fadeIn and fadeOut (seconds) shape a cut. Split, duplicate, remove and whole are one at a time.',
    inputSchema: {
      level: z.number().optional().describe('Level of the whole file, 0 to 1.'),
      clear: z.boolean().optional().describe('Remove the background.'),
      whole: z.boolean().optional().describe('One cut of the whole file from beat 0.'),
      clip: z.string().optional().describe('Cut id. Omit when there is only one.'),
      beat: z.number().optional().describe('Move the cut to this beat.'),
      trim: z.enum(['start', 'end']).optional(),
      delta: z.number().optional().describe('How far the trimmed edge moves, in beats.'),
      split: z.boolean().optional(),
      duplicate: z.boolean().optional(),
      remove: z.boolean().optional().describe('Remove this cut.'),
      mute: z.boolean().optional(),
      gain: z.number().optional().describe('Cut gain, 0 to 1.'),
      fadeIn: z.number().optional().describe('Fade in, in seconds.'),
      fadeOut: z.number().optional().describe('Fade out, in seconds.'),
    },
  },
  async (args) => call({ op: 'bed', ...args }),
);

server.registerTool(
  'sample',
  {
    title: 'Set a region sample',
    description:
      'Make a region\'s tones play an audio file that is already in this browser, or clear it so they play the synth again. from is another region\'s name or id, or bed for the background. A new file is loaded from the page, not from here.',
    inputSchema: {
      region: z.string().describe('Region id, name, or performance key.'),
      from: z.string().optional().describe('Region to copy from, or bed.'),
      clear: z.boolean().optional().describe('Remove the region\'s sample.'),
    },
  },
  async (args) => call({ op: 'sample', ...args }),
);

server.registerTool(
  'play_instrument',
  {
    title: 'Play an instrument',
    description:
      'Play notes on an instrument right now, the way the Instruments page does, not by sending a pulse. Pass one degree and beats, or notes. Each note is a scale degree held for some beats. Omit at and the notes play one after another. A phrase stays inside 32 beats and 64 notes. Press Play in the browser once before this can make sound. A recording that is already running catches it.',
    inputSchema: {
      instrument: z.string().describe('Instrument id or name.'),
      degree: z.number().optional().describe('One note: its scale degree.'),
      beats: z.number().optional().describe('One note: how long to hold it.'),
      at: z.number().optional(),
      velocity: z.number().optional(),
      notes: z.array(note).optional().describe('Several notes. Omit at to play them in a row.'),
    },
  },
  async (args) => call({ op: 'play_instrument', ...args }),
);

server.registerTool(
  'record',
  {
    title: 'Record what is heard',
    description:
      'Start or stop a recording of everything heard, including the canvas and any instrument you play. Starting also starts playback. Stopping downloads a WAV file in the browser. At most 10 minutes.',
    inputSchema: {
      action: z.enum(['start', 'stop']).describe('Start the recording, or stop it and download the WAV.'),
    },
  },
  async ({ action }) => call({ op: 'record', action }),
);

server.registerTool(
  'take',
  {
    title: 'Save or place a performance',
    description:
      'Store a performance as a take: an instrument and notes, each with beat (when it starts), degree, and beats (how long). Snap rounds them to the grid. place true also lays the new take on the canvas as linked blocks, one per note, spaced so each link lasts the gap between notes. To lay down a take you already saved, pass its name or id as place and omit notes.',
    inputSchema: {
      instrument: z.string().optional().describe('Instrument id or name, when saving notes.'),
      name: z.string().optional(),
      notes: z
        .array(
          z.object({
            beat: z.number().describe('When the note starts, in beats from the start of the take.'),
            degree: z.number(),
            beats: z.number().describe('How long it is held.'),
            velocity: z.number().optional(),
          }),
        )
        .optional(),
      place: z.union([z.boolean(), z.string()]).optional().describe('True lays the new take on the canvas. A name or id lays that saved take down.'),
    },
  },
  async (args) => call({ op: 'take', ...args }),
);

const http = listen();
console.error(`Pulse Canvas deck on http://127.0.0.1:${DECK_PORT}`);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stdin.on('end', () => {
  http.close();
  session.close();
});
