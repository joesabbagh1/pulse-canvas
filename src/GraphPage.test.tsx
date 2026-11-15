// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GraphPage } from './GraphPage';
import { Engine } from './engine/engine';
import { clampGraph, DEFAULT_GRAPH, type BlockGraph, type GraphCurve, type GraphSpec } from './engine/graph';
import { compileExpr } from './engine/fexpr';
import { SCALES } from './engine/tuning';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

interface Calls {
  graphs: Partial<GraphSpec>[];
  curveEdits: [string, Partial<GraphCurve>][];
  adds: number;
  removes: string[];
  plays: number;
  sends: { kind: string; degree: number; graph: BlockGraph; beats: number }[];
}

/** The page's callbacks, applied the way App does, so the page sees its edits. */
function Harness({ graph, playing, engine, calls }: { graph: GraphSpec; playing: boolean; engine: Engine; calls: Calls }) {
  const [current, setCurrent] = useState(graph);
  const edit = (next: GraphSpec) => setCurrent(clampGraph(next));
  return (
    <GraphPage
      bpm={112}
      playing={playing}
      scale={SCALES[0]}
      rootHz={261.6256}
      machines={[]}
      graph={current}
      engine={engine}
      onGraph={(patch) => {
        calls.graphs.push(patch);
        edit({ ...current, ...patch });
      }}
      onCurve={(id, patch) => {
        calls.curveEdits.push([id, patch]);
        edit({ ...current, curves: current.curves.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
      }}
      onAddCurve={() => (calls.adds += 1)}
      onRemoveCurve={(id) => calls.removes.push(id)}
      onPlay={() => (calls.plays += 1)}
      onSend={(seed) => calls.sends.push(seed)}
    />
  );
}

async function mountPage(graph: GraphSpec, playing: boolean, engine: Engine) {
  const calls: Calls = { graphs: [], curveEdits: [], adds: 0, removes: [], plays: 0, sends: [] };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness graph={graph} playing={playing} engine={engine} calls={calls} />);
  });
  return { host, root, calls };
}

const typeInto = (area: HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });

const setNumber = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('graph page', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows each curve, and its expression errors as they are typed', async () => {
    const engine = new Engine();
    ({ host, root } = await mountPage(DEFAULT_GRAPH, false, engine));
    const area = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Function for y1"]')!;
    expect(area.value).toBe('sin(x)');
    await typeInto(area, 'sin(');
    expect(host.querySelector('.code-errors')!.textContent).toContain('ends early');
    await typeInto(area, 'cos(x)');
    expect(host.querySelector('.code-errors')).toBeNull();
    // A curve on its own can't be removed; there'd be nothing to sweep.
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Remove y1"]')!.disabled).toBe(true);
  });

  it('schedules windows of notes on the clock while running, once per window', async () => {
    vi.useFakeTimers();
    const engine = new Engine();
    const phraseAt = vi.spyOn(engine, 'phraseAt');
    vi.spyOn(engine, 'currentBeat').mockReturnValue(0);
    vi.spyOn(engine, 'heardNow').mockReturnValue(0);
    vi.spyOn(engine.clock, 'beatAt').mockReturnValue(0.1);
    ({ host, root } = await mountPage({ ...DEFAULT_GRAPH, run: true }, true, engine));
    await act(async () => vi.advanceTimersByTime(60));
    expect(phraseAt).toHaveBeenCalledTimes(1);
    const [startBeat, block, notes] = phraseAt.mock.calls[0];
    expect(startBeat).toBe(0);
    expect(block.kind).toBe('tone');
    // The window [0, 0.5) holds steps 0 and 1/4: sin at 0 and at 1/4. The
    // 16-wide window sweeps over the default 8-beat loop: x = beat × 2.
    expect(notes.map((n: { at: number; degree: number }) => [n.at, n.degree])).toEqual([
      [0, 4],
      [0.25, 7],
    ]);
    // A later tick doesn't schedule the same window twice.
    await act(async () => vi.advanceTimersByTime(120));
    expect(phraseAt).toHaveBeenCalledTimes(1);
  });

  it('turns the sweep off without touching the transport', async () => {
    const engine = new Engine();
    const page = await mountPage({ ...DEFAULT_GRAPH, run: true }, true, engine);
    ({ host, root } = page);
    await click(host.querySelector('.graph-run')!);
    expect(page.calls.graphs.at(-1)).toEqual({ run: false });
    expect(page.calls.plays).toBe(0);
  });

  it('sends the graph as one box seed: curves, window, and the loop as its length', async () => {
    const engine = new Engine();
    const page = await mountPage(DEFAULT_GRAPH, false, engine);
    ({ host, root } = page);
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Send to canvas')!);
    const seed = page.calls.sends[0]!;
    expect(seed.kind).toBe('tone');
    expect(seed.beats).toBe(8);
    expect(seed.graph.curves.map((c) => c.expr)).toEqual(['sin(x)']);
    // The box's share of the spec: no loop length of its own, no Run switch.
    expect('loopBeats' in seed.graph).toBe(false);
    expect('run' in seed.graph).toBe(false);
  });

  it('applies presets to the selected curve and edits the window', async () => {
    const engine = new Engine();
    const page = await mountPage(DEFAULT_GRAPH, false, engine);
    ({ host, root } = page);
    await click([...host.querySelectorAll('.chip')].find((b) => b.textContent === 'floor(x)')!);
    expect(page.calls.curveEdits.at(-1)).toEqual(['graph-1', { expr: 'floor(x)' }]);
    const field = host.querySelector<HTMLInputElement>('input[aria-label="x to"]')!;
    await setNumber(field, '24');
    expect(page.calls.graphs.at(-1)).toEqual({ x1: 24 });
  });

  it('bends where you press, writing a gaussian term into the expression', async () => {
    const engine = new Engine();
    const page = await mountPage(DEFAULT_GRAPH, false, engine);
    ({ host, root } = page);
    const canvas = host.querySelector('canvas')!;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    canvas.setPointerCapture = () => {};
    canvas.hasPointerCapture = () => false;
    canvas.releasePointerCapture = () => {};
    // The plot maps x∈[0,16], y∈[-1.2,1.2] with the page's pads 44/52/12/24.
    const px = (x: number) => 44 + (x / 16) * (800 - 44 - 52);
    const py = (y: number) => 12 + ((1.2 - y) / 2.4) * (400 - 12 - 24);
    const gesture = (type: string, x: number, y: number) =>
      act(async () => {
        canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: px(x), clientY: py(y) }));
      });
    // Press on sin(x) at x=8 (sin 8 ≈ .989) and pull it down to about -0.04.
    await gesture('pointerdown', 8, Math.sin(8));
    await gesture('pointermove', 8, -0.03956);
    await gesture('pointerup', 8, -0.03956);
    const patch = page.calls.curveEdits.at(-1)![1];
    // The expression gains one gaussian term; the function itself stands.
    expect(patch.expr).toBe('sin(x)-1.03exp(-((x-8)/1)^2)');
    const f = compileExpr(patch.expr!).fn!;
    expect(f(0)).toBeCloseTo(0, 6);
    expect(f(8)).toBeCloseTo(-0.03956, 2);
    expect(f(16)).toBeCloseTo(Math.sin(16), 6);
  });

  it('adds and removes curves through the callbacks', async () => {
    const engine = new Engine();
    const page = await mountPage(
      {
        ...DEFAULT_GRAPH,
        curves: [
          { id: 'a', expr: 'sin(x)', kind: 'tone', level: 0.9, shift: 0 },
          { id: 'b', expr: 'cos(x)', kind: 'bass', level: 0.9, shift: 0 },
        ],
      },
      false,
      engine,
    );
    ({ host, root } = page);
    await click(host.querySelector('[aria-label="Remove y2"]')!);
    expect(page.calls.removes).toEqual(['b']);
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Add curve')!);
    expect(page.calls.adds).toBe(1);
  });

  it('starts the transport when Run is pressed on a stopped page', async () => {
    const engine = new Engine();
    const page = await mountPage(DEFAULT_GRAPH, false, engine);
    ({ host, root } = page);
    await click(host.querySelector('.graph-run')!);
    expect(page.calls.plays).toBe(1);
    expect(page.calls.graphs.at(-1)).toEqual({ run: true });
  });
});
