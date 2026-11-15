// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { BlockNodeView } from './BlockNode';
import { DEFAULT_BLOCK_GRAPH } from '../engine/graph';
import type { BlockNode } from '../piece';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// A graph box on the canvas: the curves drawn on the block, note marks for the
// flash rings to land on, and the polyline the pulse glides along.
const props = {
  id: 'g1',
  selected: false,
  data: { kind: 'tone', degree: 0, every: 0, graph: DEFAULT_BLOCK_GRAPH, beats: 4 },
} as unknown as NodeProps<BlockNode>;

async function renderBox() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ReactFlowProvider>
        <BlockNodeView {...props} />
      </ReactFlowProvider>,
    );
  });
  return { host, root };
}

describe('graph box node', () => {
  it('draws the curve, the pitch rows, and a mark on every step', async () => {
    const { host, root } = await renderBox();
    const box = host.querySelector('.graph-box')!;
    expect(box).toBeTruthy();
    const strip = host.querySelector('.graph-strip')!;
    expect(strip.getAttribute('data-w')).toBeTruthy();
    // The curve carries its own polyline, so the pulse can glide along it.
    const path = strip.querySelector('[data-pts]')!;
    expect(path.getAttribute('data-pts')).toContain(',');
    // 4 beats at the default ¼-beat step: 16 marks, data-at for the rings.
    const marks = strip.querySelectorAll('[data-at]');
    expect(marks).toHaveLength(16);
    // Pitch rows: the window is 16 degrees tall.
    expect(strip.querySelectorAll('.graph-row, .graph-axis').length).toBeGreaterThan(4);
    // The pulse enters and leaves through the same gates as a pattern box.
    expect(host.querySelector('.box-in')).toBeTruthy();
    expect(host.querySelector('.box-out')).toBeTruthy();
    expect(host.querySelector('.box-resize')).toBeTruthy();
    act(() => root.unmount());
  });

  it('says how long the sweep is', async () => {
    const { host, root } = await renderBox();
    expect(host.querySelector('.box-beats')!.textContent).toBe('4');
    act(() => root.unmount());
  });
});
