# Pulse Canvas

Make music by drawing. Blocks make sounds, links are paths, and pulses travel
along the links. **Distance is time**: a longer link means the pulse arrives
later, so moving a block changes the rhythm while it plays. A closed circle of
links is a loop, and its total length is the loop's duration.

## Run

```sh
npm install
npm run dev     # then open the printed localhost URL
npm run deck    # MCP server, so an AI can play the open canvas
npm test        # engine, geometry, Scala and save-format tests + render smoke tests
npm run build   # typecheck + production bundle
```

The deck listens on `127.0.0.1:4731`. Cursor starts it from `.cursor/mcp.json`. To run it yourself, use `npm run deck`, and only one of those at a time. Open the app, press Play once so the browser allows sound, and the Deck light in the bar comes on while the page is connected. Distance is time, so the deck plays by firing blocks, riding region mixes, and moving blocks.

## Play

- **Space** or **Play** starts. Each `start` block sends out a pulse.
- **Drag a block's disc** to move it. Every link shows its length in beats.
- **Drag a block's ring** to another block to link them. Let go on empty canvas
  to grow a new block there instead.
- **Drag a link** to bend it: this adds a bend point, and the pulse follows the
  longer path, so a link can get longer without either block moving. Drag a
  bend to move it, double-click it to remove it, or select the link and press
  **Straighten**. Moving one block leaves its links' bends where they are;
  moving a selection of blocks together carries their links' bends too.
- **Double-click** empty canvas to add a tone. Double-click a block to fire a
  pulse from it (or to hear it, when stopped).
- **Snap ¼** rounds links to quarter beats; turn it off for free, messy timing.
- The toolbar's key and scale menus tune the canvas. **Import .scl file…** in
  any scale menu loads a [Scala](https://www.huygens-fokker.org/scala/) tuning,
  which is then saved with the piece; **Remove** takes an imported one out
  again. The key is the pitch of degree 0: pick one of the twelve keys, or
  **Set from .kbm file…** to pin it to a Scala keyboard mapping's reference
  pitch (A = 432 Hz, say).
- **Add a region** to give part of the canvas its own key, scale, mix, effects
  and sample (below). It wraps the selected blocks, if any. A block belongs to
  the region its centre is in, so dragging it across a border retunes it and
  moves it to that region's sound; where regions overlap, the smaller one wins.
  Drag a region's name tab to move it with everything inside, and its edges to
  resize it.
- **Examples** opens ready-made patches in different traditions' tunings,
  starting with a tour of the features here.
- Select a block to change its sound, pitch, or how often a start block fires.
- Select a block or link to give it **code** (below).
- **Pattern** on the add bar drops a box as wide as its length. Type the pattern
  in the box; a pulse plays it while crossing.
- With nothing selected, the panel lists every **loop** with its length, and
  says when they all line up again (a 2-beat loop against a 3¾-beat one: every
  30 beats). That's when the whole piece repeats; while playing, the status
  shows which beat of that cycle you're on.
- **Performance keys:** give a start block or a region a letter or digit. While
  playing, a start block's key fires a pulse and a region's key mutes and
  unmutes it, so you can play the canvas live (and record it with **● Rec**).
- **⌘Z / Ctrl+Z** undoes and **⇧⌘Z / Ctrl+Shift+Z** (or Ctrl+Y) redoes, also from
  the ↶ ↷ buttons. Everything in the piece is undoable, including Clear and
  opening an example, file or link; selection isn't. A drag, a slider sweep or
  a burst of edits is one step. Inside a text box the shortcut undoes typing
  as usual. History lasts for the session, up to 200 steps.
- The canvas autosaves to this browser.

## Save, share, record

- **Save** downloads the piece as a `.json` file, samples included; **Open**
  loads one back.
- **Share** copies a link that opens a copy of the piece. The whole piece rides
  in the link's `#fragment`, which browsers never send to a server, so nothing
  is uploaded. Samples are too big for a link: whoever opens it hears the synth
  in their place, so send a saved file when samples matter. Opening a link on a
  first visit loads it straight away; if there's already work in this browser,
  it asks first.
- **● Rec** records everything you hear to a 16-bit stereo WAV file, which any
  audio editor or DAW opens. It starts playback if it isn't running; stopping
  playback keeps recording (so reverb and echo tails are caught) until you
  press it again, or for at most 10 minutes.

Links and files can come from anyone, so every piece that comes in is checked
first: unknown fields are dropped, numbers clamped, links to missing blocks
cut, sizes capped, and a link that would decompress past 5 MB is refused. Code
in a piece is only ever run by the small language below.

## Regions

Select a region (click its name tab) to set, for everything inside it:

- **Key and scale**: its tuning.
- **Mix**: level, pan and mute.
- **Groove**: *Swing* on 8ths or 16ths (up to a full triplet feel) and
  *Humanize* (small random shifts in timing and loudness). It moves when notes
  sound, never when pulses arrive, so loops never drift out of time.
- **Effects**: *Tone* (a low-pass filter, from dark to open), *Echo* (with its
  time in beats, so it follows the tempo) and *Reverb*. Double-click a slider to
  reset it.
- **Sample**: load an audio file, and the region's tones play it instead of the
  synth, pitched by scale degree as if it were recorded at C4. Every other
  instrument keeps its own voice. Samples are kept
  in this browser's storage (IndexedDB), not in the piece's saved JSON, so a
  piece opened elsewhere asks for the file again.

Blocks outside every region play through the canvas's own default sound.

## Waves

**Waves** is its own page. It draws the synth. The canvas still fires the notes.

- A **cycle** is one period of an oscillator. Left on the region, it replaces
  Tone. Aimed at an instrument, it replaces that instrument's tone. Up from the
  dashed line is the top of the wave. **Saw**, **square** and **sine** drop a
  shape; the **pencil** draws one. Drag a point to reshape it, drag the line to
  add a point, double-click a point to remove it, and drag the name to move the
  whole drawing. A region's sample still plays instead of Tone.
- A **cutoff** motion loops. Its width is the loop, in beats, by the same rule
  as a link. On the region, its height bends the Tone filter around the Tone
  slider. Aimed at one instrument, only that instrument's filter moves.
  **Decay** drops a two-beat sweep. Motions on the same target add together.
  A dot rides the line in time with the clock.
- Snap ¼ rounds a motion's loop to quarter beats. Turn the pencil off, or drag
  with the middle button, to pan. Drawings outside every region sound on the
  canvas, bending a filter that starts fully open.

## Patterns

A pattern block is a box whose width is its length in beats: a pulse enters at
the left edge, the pattern plays as the pulse crosses, and it leaves at the
right. Type the pattern in the box. Drag its right edge, or set the length in
the panel, to change how long that takes.

The instrument on the block is the one that plays. The text is
[Strudel mini-notation](https://strudel.cc/learn/mini-notation/), parsed by
Strudel and never run as JavaScript. Numbers are scale degrees above the
block's pitch, so `0 2 4` follows the region's scale on that instrument. A
word (`bd`, `sd`, `hh`, or an instrument's id) is only a hit of the same
instrument: it marks the step, and does not change the sound.
`[bd sd]` squeezes into one step, `hh*4` plays four times as fast, `bd(3,8)`
spreads 3 hits over 8 steps, and `<0 2 4>` plays one value per pulse. The next
pulse through the box plays the next pass.

`fast 2`, `slow 2` and `rev` in the block's code change that pass. A pattern
that doesn't parse plays nothing new; while you fix it, the last one that
parsed keeps going.

## Code

Each block and link can have a few lines of code that decide what happens to
every pulse passing through. It's a small language of its own, not JavaScript,
so a shared piece can't run anything else.

| Line | Does |
|---|---|
| `drop` | The pulse stops here: no sound, nothing sent on. |
| `mute` | *Blocks:* pass the pulse on without sounding. |
| `transpose +2` | Shift the pitch from here on, in scale degrees. The pulse carries it, so it adds up along a path. |
| `delay 1/2` | Wait this many beats first. A block holds its note and its pulses; a link holds the pulse at its start. |
| `route cycle` | *Blocks:* which outgoing links get a pulse: `all` (the default), `cycle` (one at a time, in turn) or `random`. |
| `fast 2` / `slow 2` | *Pattern blocks:* play the pattern this many times in its length, or stretch it over this many pulses. |
| `rev` | *Pattern blocks:* play the pattern backwards. |

Start a line with conditions to apply it only sometimes: `every 3:` (the 3rd,
6th, 9th… pulse through here) or `chance 50%:`. They combine, as in
`every 2: chance 50%: transpose +7`. Lines run top to bottom, `drop` ends the
run, and `#` starts a comment. Mistakes are shown line by line as you type, and
a block or link with code is marked `ƒ`.

## How it works

| File | Role |
|---|---|
| `src/engine/scheduler.ts` | The pulse model, in beats, running block and link code. No audio; unit-tested. |
| `src/engine/script.ts` | The code language: compiled once, then run for each pulse. |
| `src/engine/pattern.ts` | Mini-notation on a pattern block, parsed by Strudel and queried per pulse. |
| `src/engine/engine.ts` | Runs the scheduler on the audio clock, 0.2 s ahead. |
| `src/engine/mixer.ts` | One bus per region: its voices → filter → echo → reverb → level, pan, mute. |
| `src/engine/voices.ts` | Tone.js sounds. Tone can be a drawn cycle or a sample; the other instruments keep their own voices. |
| `src/engine/instruments.ts` | The instrument catalog, grouped into families. |
| `src/engine/catalogVoices.ts` | Shared synthesis for the catalog: sustained, plucked, bowed, blown, mallet, and drum. |
| `src/engine/wave.ts` | Drawn cycles and cutoff motions: a stroke becomes a waveform and a beat-synced filter curve. |
| `src/engine/samples.ts` | Stores sample files in IndexedDB, by a hash of their bytes. |
| `src/engine/tuning.ts` | Scales as cents, and the root (key) as Hz. Pitch is stored as a scale degree. |
| `src/engine/scala.ts` | Reads Scala `.scl` scales and `.kbm` reference pitches. |
| `src/regions.ts` | Which region a point is in, and what a dragged region carries. |
| `src/engine/geometry.ts` | Pixels → beats (240 px = 1 beat), and links as polylines through their bends. |
| `src/canvas/*` | React Flow blocks, links and regions, plus the pulse overlay. |
| `src/piece.ts` | The saved JSON format (with regions and imported scales) and the tour patch. |
| `src/cycle.ts` | When every loop lines up again: the whole piece's repeat length. |
| `src/engine/groove.ts` | Swing and humanize, applied when a note is scheduled. |
| `src/history.ts` | Undo and redo, over snapshots of the piece. |
| `src/readPiece.ts` | Checks and repairs every piece that comes in: storage, files, links. |
| `src/share.ts` | Share links (deflated JSON in the URL fragment) and saved files (with samples). |
| `src/engine/recorder.ts` | Taps the master output with an AudioWorklet and writes WAV. |
| `src/examples.ts` | The patches on the Examples page; `scales/` holds their source `.scl` files. |

## Roadmap

1. ~~The toy: blocks, links, pulses, one synth~~
2. ~~Bend points on links, so you can change a link's length without moving its blocks~~
3. ~~Tunings: per-region scales, Scala `.scl` import~~
4. ~~Code on blocks and links (route, delay, transpose, drop pulses)~~
5. ~~Regions with their own mix, effects and samples~~
6. ~~Save, share by link, record~~
7. ~~Waves: a drawn cycle for the tone, and cutoff motions whose width is the loop~~
8. ~~Pattern blocks: a box as long as its pattern, in Strudel mini-notation~~
