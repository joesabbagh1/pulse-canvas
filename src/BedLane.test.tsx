// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BedLane } from './BedLane';
import { wholeClip, type Bed } from './bed';
import { Engine } from './engine/engine';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const bed: Bed = { sample: { id: 'smp-aa', name: 'loop.wav' }, duration: 4, level: 0.8, clips: [wholeClip(4, 'cut-a')] };

describe('background lane', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  afterEach(() => {
    act(() => root.unmount());
  });

  it('lists the cut on the timeline and splits it in half', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const edits: Bed[] = [];
    await act(async () => {
      root.render(
        <BedLane
          bed={bed}
          peaks={new Float32Array([0, 1, -1, 0])}
          missing={false}
          bpm={120}
          snap
          playing={false}
          engine={new Engine()}
          onChange={(next) => next && edits.push(next)}
          onLoad={() => {}}
        />,
      );
    });
    expect(host.querySelector('.bed-cuts')!.textContent).toContain('Cut 1');
    expect(host.querySelector('.bed-cuts')!.textContent).toContain('0:00');
    const item = host.querySelector<HTMLElement>('.bed-cuts [role="listitem"]')!;
    await act(async () => item.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const split = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Split')!;
    await act(async () => split.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(edits.at(-1)?.clips).toHaveLength(2);
    expect(edits.at(-1)?.clips[0].seconds).toBeCloseTo(2);
    expect(edits.at(-1)?.clips[1].offset).toBeCloseTo(2);
  });
});
