// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Engine } from './engine/engine';
import { VizPage } from './VizPage';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<VizPage engine={new Engine()} bpm={112} playing={false} />);
  });
  return { host, root };
}

const click = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const press = (key: string) => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key })));

describe('viz page', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  const activeChip = () => host.querySelector('.viz-chip.is-active')?.textContent;

  it('opens on the first of the six stages, with a status line', async () => {
    ({ host, root } = await mount());
    expect(host.querySelector('.viz-stage')).toBeTruthy();
    const chips = [...host.querySelectorAll('.viz-chip')];
    expect(chips.length).toBe(6);
    expect(chips[0].classList.contains('is-active')).toBe(true);
    expect(activeChip()).toContain('Mandala');
    expect(host.querySelector('.viz-status')!.textContent).toContain('idle');
  });

  it('switches stages by chip and by number key', async () => {
    ({ host, root } = await mount());
    await click(host.querySelectorAll('.viz-chip')[2]);
    expect(activeChip()).toContain('Tunnel');

    await press('6');
    expect(activeChip()).toContain('Phosphor');

    // Out of range and modified keys leave the stage alone.
    await press('9');
    expect(activeChip()).toContain('Phosphor');
  });

  it('steps stages with the arrow keys, wrapping around', async () => {
    ({ host, root } = await mount());
    await press('1');
    await press('ArrowLeft');
    expect(activeChip()).toContain('Phosphor');
    await press('ArrowRight');
    expect(activeChip()).toContain('Mandala');
  });
});
