# Pulse Canvas

Make music by drawing. Blocks make sounds, links are paths, and pulses travel
along the links. **Distance is time**: a longer link means the pulse arrives
later, so moving a block changes the rhythm while it plays. A closed circle of
links is a loop, and its total length is the loop's duration.

## Run

```sh
npm install
npm run dev     # then open the printed localhost URL
npm test        # engine, geometry, Scala and save-format tests + render smoke tests
npm run build   # typecheck + production bundle
```

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
- **Effects**: *Tone* (a low-pass filter, from dark to open), *Echo* (with its
  time in beats, so it follows the tempo) and *Reverb*. Double-click a slider to
  reset it.
- **Sample**: load an audio file, and the region's tones play it instead of the
  synth, pitched by scale degree as if it were recorded at C4. Pluck and bass
  keep their own voices. Samples are kept
  in this browser's storage (IndexedDB), not in the piece's saved JSON, so a
  piece opened elsewhere asks for the file again.

Blocks outside every region play through the canvas's own default sound.

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
| `src/engine/engine.ts` | Runs the scheduler on the audio clock, 0.2 s ahead. |
| `src/engine/mixer.ts` | One bus per region: its voices → filter → echo → reverb → level, pan, mute. |
| `src/engine/voices.ts` | Tone.js sounds: tone (synth or sample), pluck, bass, kick, snare, hat. |
| `src/engine/samples.ts` | Stores sample files in IndexedDB, by a hash of their bytes. |
| `src/engine/tuning.ts` | Scales as cents, and the root (key) as Hz. Pitch is stored as a scale degree. |
| `src/engine/scala.ts` | Reads Scala `.scl` scales and `.kbm` reference pitches. |
| `src/regions.ts` | Which region a point is in, and what a dragged region carries. |
| `src/engine/geometry.ts` | Pixels → beats (240 px = 1 beat), and links as polylines through their bends. |
| `src/canvas/*` | React Flow blocks, links and regions, plus the pulse overlay. |
| `src/piece.ts` | The saved JSON format (with regions and imported scales) and the tour patch. |
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
