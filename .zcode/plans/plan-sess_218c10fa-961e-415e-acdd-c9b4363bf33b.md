# Bendable functions — drag the curve, the math and the music follow live

## Context

The graph surfaces are typed-math-only right now. The user wants to grab a curve and bend it with the mouse, with the function — and the sound — updating in real time. The honest way to do that in tek: **the bend is the expression**. We add one new math primitive, `curve(x, a, b, y0, …, yn)` — a smooth interpolation through knot values across `[a, b]` — and bending is nothing more than dragging knots and rewriting the expression text through the existing edit pipelines. The expression field, live re-compile mid-play, autosave, undo, and share links all keep working because a bent curve is just math text like `sin(x)` is.

**One design choice to be clear about**: bending converts the curve's expression into knot form — drag `sin(x)` and the field becomes `curve(x, 0, 16, .03, .41, …)` matching exactly what you drew. Typing/presets still work both ways; the text always mirrors reality.

## Engine (pure, tested)

1. **`src/engine/fexpr.ts`** — variadic function support (today `FnDef` is arity 1|2): `curve(x, a, b, y0…yn)` takes the x, both window ends, and 2–14 values; cosine-smoothed interpolation between knots (`t' = (1−cos(πt))/2`), clamped flat outside `[a, b]`. Arg-count/limit errors in the compiler's friendly voice. `EXPR_WORDS` picks it up automatically.

2. **`src/engine/graph.ts`** — bend helpers, pure:
   - `BEND_KNOTS = 12`; `knotXs(spec)` — evenly spaced x across the window.
   - `knotsOf(fn, spec): number[]` — sample any expression at the knot xs (so bending starts from the curve's current shape, whatever it is).
   - `dragKnot(ys, index, y): number[]` — sets the grabbed knot and blends neighbors with a gaussian falloff (σ ≈ 1.2 knots), so it feels like bending, not pushing a point.
   - `bendExpr(x0, x1, ys): string` — builds `curve(x, 0, 16, .32, −.11, …)` with compact numbers (strip leading/trailing zeros); guaranteed ≤ `MAX_EXPR_CHARS` at 12 knots.

## UI — bend on both surfaces

3. **`src/GraphPage.tsx` (the plot)** — pointer interactions on the plot canvas:
   - Pointer-down hit-tests every compiled curve (evaluate `fn` at the pointer's x; within ~10px vertically) → picks the nearest curve + nearest knot; the selected curve wins ties.
   - While dragging: knot y ← pointer y (math units), `dragKnot` falloff, `onCurve({ expr: bendExpr(...) })` on every move — the existing pipeline re-renders, re-schedules windows, autosaves; mid-sweep edits apply to future windows only, exactly like typing.
   - The rAF draw adds small knot handles (hollow circles) on the selected curve, filled on the one being dragged, so the affordance is visible; cursor changes to `grab`/`grabbing` over a curve.
   - Rail hint gains: "Drag a curve to bend it — the function follows."

4. **`src/canvas/BlockNode.tsx` (the GraphBox strip)** — same bend on the canvas: pointer-down on the strip (`nodrag`, the `Resize` grip's pointer-capture pattern) near a curve → drag → `updateNodeData(id, { graph: { …, curves: […expr] } })` → `App.updateBlock` → `engine.setGraph` recompiles mid-run, so a playing box bends audibly within a window. No persistent handles on the box (it's small); a hover cursor + the curve-following drag is enough. `spanOf`/layout untouched — the box doesn't resize.

## Tests

- `fexpr.test.ts`: `curve()` interpolation at knots and midpoints, clamping outside `[a, b]`, odd arg counts / too few values / too many knots errors, survives the 200-char cap.
- `graph.test.ts` (or a bend block): `knotsOf` samples faithfully, `dragKnot` moves the grabbed knot fully and neighbors partially, `bendExpr` round-trips through `compileExpr` to the same shape (knots ± 0.01) and stays ≤ 200 chars for typical windows.
- Existing suites stay green (the bent curve is ordinary spec text — scheduler/box/page tests untouched).

## Verification

1. `npm run typecheck`, `npm test` — all green.
2. Browser (5173, browser-use): Graph page — press near `sin(x)`'s crest and drag down; the expression field rewrites itself live into `curve(…)`, the plot follows the pointer, and while running, upcoming notes retune (oscillator/pitch shift audible in the note stream; no console errors). Canvas — select a graph box, drag its curve mid-play, sweep retunes without the box moving; ⌘Z steps back through the drag history; reload keeps the bent curve (autosave), undo restores.

## Out of scope (follow-ups)

Bend-preserving blends (keeping `sin(x) + curve(…)` composites editable); knot handles on the canvas box; multi-touch bends.
