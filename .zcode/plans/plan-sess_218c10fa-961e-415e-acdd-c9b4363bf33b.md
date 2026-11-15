# Graph boxes on the canvas — the plot as its own container, pulse gliding along the curve

## Context

The Graph page's "Send to canvas" currently bakes the pass into ~128 circular note blocks. The user wants the graph itself to live on the canvas: its own UI container that shows the same plot as the Graph page — axes, function curves, note marks — with the pulse gliding along the function line while it plays. The codebase already has the exact template: **pattern blocks**. A block becomes a box via a data field (`pattern`); a pulse arriving starts a `Run` that emits notes across the box's span and departs at its end. We mirror that with a `graph` field.

**Model in one line**: a graph box is `span` beats wide (distance-is-time); one pass = one sweep of the math window `[x0, x1]`; on each step grid point every curve's y becomes a note on that curve's own instrument; the pulse dot rides each curve at the sweep fraction.

## Engine (pure, testable)

1. **`src/engine/graph.ts`** — `export type BlockGraph = Omit<GraphSpec, 'loopBeats' | 'run'>` (curves/window/step/length/degrees live per block; the box's `beats` IS the sweep length). `DEFAULT_BLOCK_GRAPH`, `clampBlockGraph(v, kindOk)` (same clamps as `clampGraph`), and `blockGraphNotes(spec, curves, span, fromBeat, toBeat)` = `graphNotes({ ...spec, loopBeats: span }, ...)` — zero new sampling math.

2. **`src/engine/geometry.ts`** — box-ness becomes `isBox(block) = pattern !== undefined || graph !== undefined`; `spanOf`/`patternFrame` accept `{ pattern?, beats?, graph? }` so graph boxes size to `beats × BOX_HEIGHT` and every existing caller (link geometry, loops stat, deck `pointOf`) works unchanged. Box length caps at `MAX_SPAN` (32 beats).

3. **`src/engine/scheduler.ts`** — `GraphBlock` gains `graph?: BlockGraph`. Where patterns are compiled on `setGraph`, also store per-block compiled `CurveFn[]` (bad curves drop out silently until they read). `release()` needs no change (`spanOf` now returns the box span → Run + departure at `beat + span` for free). In `playRuns()`, a run on a graph block sources notes from `blockGraphNotes(spec, curves, span, run.cursor − run.start, until − run.start)` and assembles each hit like `patternHit` does: per-note `kind = curve.kind`, `degree = block.degree + note.degree` (block degree = transpose, block `code` transpose applies via run shift), `length = note.beats` for held voices, `velocity = run.velocity × curve.level`, `at = { x: inPort.x + (note.beat/span)·width, y: block.y }` so flash rings land on the box. `MAX_RUN_HITS` guards as usual.

4. **`src/engine/engine.ts`** — ear-ping and `setGraph`'s pattern set (ear + mixer private lanes) key on `isBox` instead of `pattern !== undefined`, so graph boxes get the oscilloscope strip and `tone` lanes. `audition()` gains a graph branch: stopped-state preview plays one full pass via `blockGraphNotes` + `mixer.play`.

5. **Persistence** — `src/piece.ts`: `BlockData.graph?: BlockGraph` (toGraph spreads data → scheduler gets it; toNodes sizes via `patternFrame`). `src/readPiece.ts`: block reader keeps `graph: clampBlockGraph(v.graph, kindOk)` (machines included), keeps `beats`/`level`/`tone` for graph blocks, `figure` stays pattern-only. Deck: `DeckBlock` + `blockFields` pass `graph` through so a deck edit of another field can't strip it (full deck editing out of scope).

## UI

6. **`src/canvas/BlockNode.tsx`** — third branch in `BlockView`: `data.graph ? <GraphBox/>`. Same skeleton as `PatternBox`: `.box.graph-box` sized `span·PX_PER_BEAT × BOX_HEIGHT`, head (name "Graph", level/tone sliders, beats label), `.box-in`/`.box-out` ports, `Resize` grip (resizes `beats` = sweep length). Body is an SVG `.graph-strip` (like `figures.tsx`): faint zero-axis + sparse degree rows (stride rule from the page), one `<path>` per curve with the page's `dashOf` stroke pattern in ink, and per-step note `<circle data-at data-span>` marks ON the curve (the same contract PulseLayer's flash-ring `noteAt` uses). Each curve path also carries a compact `data-pts` polyline (svg units) so the glide below needs no math evaluation at draw time.

7. **`src/canvas/PulseLayer.tsx`** — in the runs loop, when the node has a `.graph-strip`, replace the note-jumping `playhead()` placement with a **glide**: interpolate each curve's `data-pts` at x-fraction `t = (beat − run.start)/span`, map svg units → screen via the strip's rect, and draw the halo+core dot there (per curve, the page's playhead vocabulary). Departure after the run continues down the outgoing link as a normal pulse.

8. **Editing** — extract the Graph page's curve card + config atoms into `src/GraphFields.tsx` (`CurveCard`, `GraphConfig`, presets, `NumberField`, `CurveSwatch`, `dashOf` — GraphPage and Inspector both render them). `src/Inspector.tsx`: when `data.graph`, show the graph editor (curves with live expr validation + instrument Select + level/shift, window numbers + Fit y, step/length segmented, degree sliders) via the existing `onChange(id, patch)` → `App.updateBlock` path (which already re-frames on `beats` changes).

9. **Creation** — `src/canvas/CanvasControls.tsx` AddDock gets a **Graph** button (next to Pattern) → `App.addGraphBlock()` = `addBlock({ kind: 'tone', degree: 0, every: 0, graph: DEFAULT_BLOCK_GRAPH, beats: 8 }, viewCenter)`. **`App.placeGraph` rewritten**: "Send to canvas" now stamps ONE graph block (`graph: BlockGraph` from the page spec, `beats: clamp(loopBeats, MIN_SPAN, MAX_SPAN)`, wired to the start block) instead of 128 note blocks; toast says so. The Graph page stays the authoring surface + live transport layer.

10. **`src/styles.css`** — `.graph-box` chrome in the two-ink language (reuse `.box` base, distinct head treatment).

## Tests

- `src/engine/scheduler.test.ts` additions: pulse → graph run emits hits at `start + k·step` with expected degrees (`describePitch` assertions, the established idiom); departure at `beat + span`; per-curve instruments; broken expr = silence not crash; window paging between ticks (edit mid-pass only affects future notes); run velocity × curve level; MAX guards.
- `src/readPiece.test.ts` (or graph.test): `graph` round-trip + clamps, unknown curve kinds retargeted, machines allowed.
- `src/GraphPage.test.tsx`: Send now hands the spec to `onSend` (signature change) — assert one graph block data, not note rows.
- New jsdom test for `GraphBox` render: strip exists, `data-at` marks per step, `data-pts` per curve, resize/ports present.
- `App.smoke.test.tsx` stays green; full `npm test` + `npm run typecheck`.

## Verification

1. `npm run typecheck`, `npm test` — all green.
2. Browser (`npm run dev` on 5173, browser-use): add a Graph box from the dock → wire start → Play: pulse enters the box, **dot glides along the curve** across the box, notes fire on the step grid, oscilloscope strip animates, pulse exits and continues down the link. Select the box → Inspector edits expr live (mid-pass edits apply to future notes); resize the box → sweep stretches. Graph page → Send to canvas → one graph box appears (not note blocks), plays identically; undo removes it. Theme toggle legible.
   Note: the unfocused IAB pane throttles rAF — if the glide looks frozen during automation, use the rAF-shim + forced-frame technique from last session (memory: tek-pending-work).

## Out of scope (follow-ups)

Deck ops to create/edit graph boxes; multiple sweeps (polyphony > MAX_RUNS) tuning; graph "figure" variants.
