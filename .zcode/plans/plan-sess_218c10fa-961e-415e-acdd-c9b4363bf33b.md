# Graph page — type math functions, watch the pulse sweep x, hear the y as music

## Context

The Instagram reference (a "function sonification" reel, login-walled — same concept as Desmos audio-trace) shows: you type math functions, they plot on x/y axes, a pulse sweeps the x-axis, and each y-value becomes a note. The ask: build that surface in tek, with everything configurable (functions, instruments, ranges, timing) — and let the result feed the rest of the app.

Design in one line: **the graph is a live note source on the piece's transport.** x is time (the beat clock), the sweep is the playhead, y maps to a scale degree, and each curve sounds on its own instrument through the existing mixer. "Send to canvas" bakes one pass into blocks/links so a graph becomes an editable, shareable part of the piece.

Everything reuses proven paths:
- `engine.phrase()` (src/engine/engine.ts:167) — the deck already schedules arbitrary note lists on the audio clock via a synthetic `GraphBlock`; we add a beat-anchored variant.
- `phraseLoop()` (src/melody.ts:37) — bakes notes into canvas geometry.
- `PulseLayer` (src/canvas/PulseLayer.tsx) — rAF drawing that reads `engine.heardNow()`; "drawing never drives timing".
- The SynthPage recipe (route → TopBar tab → App branch → readPiece gate), documented in `.zcode/plans/plan-sess_2622780c….md`.
- `script.ts` — precedent for a pure, interpreted mini-language (never `eval`), with typed errors.

## New files

### 1. `src/engine/fexpr.ts` — pure expression compiler (+ `fexpr.test.ts`)
Recursive-descent parser/evaluator, interpreted (a shared piece can't run code — same stance as block/link script):
- Numbers, `x`, `pi`, `e`, `+ - * / %`, `^` (right-assoc), unary minus, parentheses.
- Calls: `sin cos tan asin acos atan atan2 abs sqrt floor ceil round exp ln log2 sign min max pow mod`.
- `compileExpr(src): { fn: (x: number) => number; error: null } | { fn: null; error: string }` with the offending token named. Cap source at 200 chars. NaN/±Inf flow through (rests, handled downstream).

### 2. `src/engine/graph.ts` — data model + sampling (+ `graph.test.ts`)
```ts
interface GraphCurve { id: string; expr: string; kind: string; level: number; shift: number } // instrument/machine id, 0..1, degree offset
interface GraphSpec { curves: GraphCurve[]; x0: number; x1: number; y0: number; y1: number;
  loopBeats: number; stepBeats: number; lengthBeats: number | null; baseDegree: number; spanDegrees: number; run: boolean }
DEFAULT_GRAPH + clampGraph()
```
- `graphWindow(spec, fns, scale, fromBeat, toBeat)` → per-curve `{ at, degree, velocity }[]`: step k at beat `k * stepBeats`, x = `x0 + (beat mod loopBeats)/loopBeats * (x1-x0)`; y → degree by linear map of the y-window onto `baseDegree … baseDegree+spanDegrees`, rounded to an integer scale degree (pitch stays tek-native: degrees, any tuning) + curve `shift`; NaN/out-of-range → rest.
- Pure and beat-based → headless vitest with `describePitch` assertions (the established scheduler-test idiom).

### 3. `src/GraphPage.tsx` — the page (+ `GraphPage.test.tsx`, jsdom like `BedLane.test.tsx`)
Layout like SynthPage (`.page` chrome):
- **Left rail — curves** (up to 4): color swatch, expression field (CodeField-style live validation against `compileExpr`), instrument `Select` (catalog groups + this piece's machines), level `Slider`, remove button. Preset chips: `sin(x)`, `sin(x)+sin(3x)/3`, `floor(x)`, `abs(sin(x))-0.5`, `sign(sin(x))`, `tan(x)/4`.
- **Center — the plot**: HTML canvas 2D, dpr-aware, colors from `token('--ink')`/`token('--ink-rgb')` (PulseLayer idioms; tolerate jsdom's no-op context). Axes + ticks, faint degree gridlines (pitch rows), curves sampled per ~2px, sweeping playhead line with a dot on each curve, fired-note flashes that fade.
- **Config**: x window (x0/x1), y window (y0/y1 + Auto-fit from sampled y), loop length (beats), step (segmented 1, 1/2, 1/4, 1/8), note length, base degree + span, Run toggle.
- **Playback**: the graph layer rides the piece transport — TopBar Play + per-page Run toggle. A pager (`window.setInterval` ~50 ms, lookahead ~0.25 s in beats via `engine.clock.beatAt(engine.heardNow() + 0.25)`) materializes `graphWindow` chunks and calls the new `engine.phraseAt`. Scheduled-window map so live edits (function, range, bpm) reshape only future windows. Functions are evaluated in React-land only, never inside a Tone timer (per `engine/timers.ts`). On a fresh/empty canvas you hear just the graph; over a playing piece it layers.
- **Send to canvas**: one loop pass → `phraseLoop()` geometry placed at a free spot, linked to the start block (add `songStart` if none) — rides autosave/undo/share for free. Cap ~200 notes per bake, toast confirms.

## Modified files

- **`src/engine/engine.ts`** — add `phraseAt(startBeat, block, notes)` beside `phrase()`: identical attack/release-on-audio-clock path but anchored to `clock.timeAt(startBeat + note.at)`, clamped to `audioNow() + 0.01`.
- **`src/piece.ts`** — `graph?: GraphSpec` on `Piece`; default in `emptyPiece()`.
- **`src/readPiece.ts`** — `readGraph()` gate: clamp numbers, curves ≤ 4, expr ≤ 200 chars, kinds validated like block kinds (unknown → `tone`); `LIMITS.graphCurves = 4`, `LIMITS.expr = 200`.
- **`src/ui/route.ts`** — `'graph'` route + `PAGES`.
- **`src/TopBar.tsx`** — `APP_TABS` entry `{ route: 'graph', label: 'Graph' }`.
- **`src/App.tsx`** — `graph` state from the piece (machines pattern): render branch `{route === 'graph' && <GraphPage …/>}`, included in autosave deps, `pieceJson`, `currentPiece()`, `restore()`, `replaceWith()`; add `'graph'` to the stop-guard exemption (App.tsx:859) so the transport survives navigating to the page.
- **`src/styles.css`** — `.graph-page` styles in the two-ink design language.

## Verification

1. `npm run typecheck` and `npm test` — all green (284 existing + new fexpr/graph/GraphPage tests).
2. `npm run dev` + browser-use: open `#/graph`, press Play — pulse sweeps, notes flash on the plot, `sin(x)` audibly climbs and falls; type a bad expression → inline error, playback of future windows unaffected; switch instrument/scale, add a second curve; Send to canvas → blocks appear and the canvas plays them; dark/light theme both legible.

## Out of scope (follow-ups)

MCP deck `graph` op; continuous-pitch glide (mono-machine portamento) mode; a graph figure inside pattern boxes.
