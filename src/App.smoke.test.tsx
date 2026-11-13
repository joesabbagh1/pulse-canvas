// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { Engine } from './engine/engine';
import { demoPiece } from './piece';
import { encodeShare } from './share';

// jsdom has no layout or canvas; these stand-ins follow React Flow's testing guide.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly = class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { get: () => 60 },
    offsetHeight: { get: () => 60 },
  });
  const noop = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  HTMLCanvasElement.prototype.getContext = (() => noop) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Recent Node versions ship their own localStorage global, which shadows jsdom's.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  // Route and share-link tests leave fragments behind; a stale one reroutes the next mount.
  history.replaceState(null, '', '/');
});

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<App />));
  await act(() => new Promise((r) => setTimeout(r, 50)));
  return { host, root };
}

const button = (host: Element, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;

/** Opens the instrument palette, picks a family, and drops that instrument. */
async function addInstrument(host: Element, category: string, name: string) {
  if (!document.querySelector('.instrument-palette')) await act(async () => button(host, 'Instruments').click());
  const tab = [...document.querySelectorAll('.palette-categories button')].find((b) => b.textContent?.trim() === category);
  if (!tab) throw new Error(`No category ${category}`);
  await act(async () => (tab as HTMLButtonElement).click());
  const item = [...document.querySelectorAll('.palette-item')].find((b) => b.textContent?.trim() === name);
  if (!item) throw new Error(`No instrument ${name} in ${category}`);
  await act(async () => (item as HTMLButtonElement).click());
}

/** Opens the File dropdown and picks the item labelled `label`. */
async function fileMenu(host: Element, label: string) {
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="File"]')!.click());
  const item = [...host.querySelectorAll('.menu-item')].find((i) => i.textContent!.startsWith(label))!;
  await act(async () => (item as HTMLElement).click());
}

/** Opens the custom Select labelled `label` and picks the option showing `option`. */
async function choose(host: Element, label: string, option: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  const row = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes(option));
  if (!row) throw new Error(`No option "${option}" in ${label}`);
  await act(async () => (row as HTMLElement).click());
}

describe('App', () => {
  it('renders the demo patch without errors', async () => {
    const errors = vi.spyOn(console, 'error');
    const { host, root } = await mount();

    expect(host.querySelectorAll('.react-flow__node-block')).toHaveLength(demoPiece().blocks.length);
    expect(host.querySelectorAll('.react-flow__edge')).toHaveLength(demoPiece().links.length);
    expect([...host.querySelectorAll('.block-note')].map((n) => n.textContent)).toContain('C4');
    expect([...host.querySelectorAll('.link-label')].map((n) => n.textContent)).toContain('¾');
    expect(errors).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('adds a block from the dock and autosaves it', async () => {
    const { host, root } = await mount();
    await addInstrument(host, 'Synths', 'Tone');
    expect(host.querySelectorAll('.react-flow__node-block')).toHaveLength(demoPiece().blocks.length + 1);

    await addInstrument(host, 'Percussion', 'Snare');
    expect(host.querySelector('.inspector .stepper')).toBeNull();
    await addInstrument(host, 'Synths', 'Bass');
    expect(host.querySelector('.inspector .stepper')).not.toBeNull();

    await act(() => new Promise((r) => setTimeout(r, 450)));
    const saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
    expect(saved.blocks).toHaveLength(demoPiece().blocks.length + 3);
    act(() => root.unmount());
  });

  it('adds a pattern block, edits it, and lengthens the box', async () => {
    const { host, root } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Add pattern"]')!.click());
    const input = host.querySelector<HTMLInputElement>('.box input[aria-label="Pattern"]')!;
    expect(input.value).toBe('0*2 [~ 2] 4');
    expect(host.querySelector('.box-beats')!.textContent).toBe('2');
    expect(host.querySelectorAll('.box-strip rect').length).toBeGreaterThan(0);

    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    await act(async () => {
      (input as HTMLInputElement & { _valueTracker?: { setValue: (v: string) => void } })._valueTracker?.setValue('');
      proto.set!.call(input, 'bd ]');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('.box')!.classList.contains('has-error')).toBe(true);
    expect(host.querySelector('.inspector .warn')!.textContent).toMatch(/\]/);

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Longer"]')!.click());
    expect(host.querySelector('.box-beats')!.textContent).toBe('2¼');
    act(() => root.unmount());
  });

  it('finds an instrument by typing in the block menu', async () => {
    vi.spyOn(Engine.prototype, 'audition').mockResolvedValue();
    const { host, root } = await mount();
    await addInstrument(host, 'Synths', 'Tone');
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Instrument"]')!.click());
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search instrument"]')!;
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    await act(async () => {
      proto.set!.call(search, 'khuur');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const options = [...host.querySelectorAll('[role="option"]')].map((option) => option.textContent);
    expect(options).toEqual(['Khuur']);
    await act(async () => host.querySelector<HTMLElement>('[role="option"]')!.click());
    expect(host.querySelector('.inspector .select-value')!.textContent).toBe('Khuur');
    act(() => root.unmount());
  });

  it('adds a jaw harp and a khuur, both pitched from the scale', async () => {
    const { host, root } = await mount();
    await addInstrument(host, 'Plucked strings', 'Jaw harp');
    expect(host.querySelector('.block.is-selected .block-sub')!.textContent).toBe('jaw');
    expect(host.querySelector('.inspector .stepper')).not.toBeNull();
    await addInstrument(host, 'Bowed strings', 'Khuur');
    expect(host.querySelector('.block.is-selected .block-sub')!.textContent).toBe('khuur');
    expect(host.querySelector('.inspector .select-value')!.textContent).toBe('Khuur');
    act(() => root.unmount());
  });

  it('drops a saw on the waves page and autosaves it', async () => {
    const { host, root } = await mount();
    await act(async () => void host.querySelector('a.tab[href="#/waves"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(host.querySelector('a.tab.is-active')!.textContent).toBe('Waves');
    await act(async () => button(host, 'Saw').click());
    expect(host.querySelectorAll('.wave-cycle')).toHaveLength(1);
    expect(host.querySelector('.inspector-title')!.textContent).toBe('Wave');

    await act(() => new Promise((r) => setTimeout(r, 450)));
    const saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
    expect(saved.waves).toHaveLength(1);
    expect(saved.waves[0].role).toBe('cycle');
    expect(saved.waves[0].points.length).toBeGreaterThan(1);
    act(() => root.unmount());
  });

  it('pulling a link out bends it, and the bend is saved', async () => {
    const { host, root } = await mount();
    const edge = () => host.querySelector('.react-flow__edge[data-id="mel-1>bass"]')!;
    const pointer = (type: string, x: number, y: number) =>
      new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
    const pull = async (from: Element, to: [number, number]) => {
      await act(async () => from.dispatchEvent(pointer('pointerdown', 100, 100)));
      await act(async () => window.dispatchEvent(pointer('pointermove', to[0] / 2, to[1] / 2)));
      await act(async () => window.dispatchEvent(pointer('pointermove', ...to)));
      await act(async () => window.dispatchEvent(pointer('pointerup', ...to)));
    };

    await act(async () => edge().querySelector('.react-flow__edge-interaction')!.dispatchEvent(pointer('pointerdown', 100, 100)));
    await act(async () => window.dispatchEvent(pointer('pointermove', 102, 101)));
    await act(async () => window.dispatchEvent(pointer('pointerup', 102, 101)));
    // Under the drag threshold: just a press, no bend on this link.
    expect(edge().querySelectorAll('.link-bend')).toHaveLength(0);

    await pull(edge().querySelector('.react-flow__edge-interaction')!, [180, 260]);
    expect(edge().querySelectorAll('.link-bend')).toHaveLength(1);
    // Dragging selected the link, so the inspector offers to straighten it.
    const straighten = [...host.querySelectorAll('.inspector button')].find((b) => b.textContent === 'Straighten');
    expect(straighten).toBeDefined();

    await act(() => new Promise((r) => setTimeout(r, 450)));
    const saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
    expect(saved.links.find((l: { id: string }) => l.id === 'mel-1>bass').bends).toHaveLength(1);
    const bentBefore = demoPiece().links.filter((l) => l.bends?.length).length;
    expect(saved.links.filter((l: { bends?: unknown }) => l.bends)).toHaveLength(bentBefore + 1);

    // A second pull adds another bend; double-clicking one removes it.
    await pull(edge().querySelector('.react-flow__edge-interaction')!, [300, 40]);
    expect(edge().querySelectorAll('.link-bend')).toHaveLength(2);
    await act(async () => edge().querySelector('.link-bend-hit')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(edge().querySelectorAll('.link-bend')).toHaveLength(1);

    await act(async () => straighten!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(edge().querySelectorAll('.link-bend')).toHaveLength(0);
    act(() => root.unmount());
  });
  it('a region wrapped around a block retunes it, by scale and by key', async () => {
    // Changing pitch while stopped plays the note, and jsdom has no audio.
    vi.spyOn(Engine.prototype, 'audition').mockResolvedValue();
    const { host, root } = await mount();
    const newest = (selector: string) => [...host.querySelectorAll(selector)].at(-1)!;
    const note = () => newest('.react-flow__node-block').querySelector('.block-note')!.textContent;

    await addInstrument(host, 'Synths', 'Tone');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Raise pitch"]')!.click());
    expect(note()).toBe('D4');

    // The new block is still selected, so the region wraps it. The demo has one already.
    await act(async () => button(host, 'Region').click());
    expect(host.querySelectorAll('.react-flow__node-region')).toHaveLength(2);
    expect(host.querySelector('.inspector-title')!.textContent).toContain('Region');

    await choose(host, 'Region scale', 'Minor pentatonic');
    expect(newest('.react-flow__node-region').querySelector('.region-scale')!.textContent).toBe('Minor pentatonic');
    expect(note()).toBe('E♭4');
    await choose(host, 'Region key', 'D');
    expect(note()).toBe('F4');

    await act(() => new Promise((r) => setTimeout(r, 450)));
    const saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
    expect(saved.regions.at(-1)).toMatchObject({ name: 'Region 2', scaleId: 'minor-penta' });
    expect(saved.regions.at(-1).rootHz).toBeCloseTo(293.66, 2);
    act(() => root.unmount());
  });

  it('imports a Scala file as the canvas scale, and removes it again', async () => {
    const { host, root } = await mount();
    // The piece sidebar (nothing selected) holds the canvas scale picker.
    const input = host.querySelector<HTMLInputElement>('.inspector input[accept=".scl"]')!;
    const file = new File(['! quarter.scl\nQuarter tones\n 2\n 150.0\n 2/1\n'], 'quarter.scl');
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(() => new Promise((r) => setTimeout(r, 20)));

    const shown = () => host.querySelector('[aria-label="Scale outside regions"] .select-value')!.textContent;
    const notes = () => [...host.querySelectorAll('.block-note')].map((n) => n.textContent);
    expect(shown()).toBe('Quarter tones');
    // The bass, outside the demo's region, is degree -5: two and a half periods below C4.
    expect(notes()).toContain('D1');

    await act(() => new Promise((r) => setTimeout(r, 450)));
    let saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
    expect(saved.scales).toMatchObject([{ name: 'Quarter tones', cents: [0, 150], period: 1200 }]);
    expect(saved.scaleId).toBe(saved.scales[0].id);

    await choose(host, 'Scale outside regions', 'Remove “Quarter tones”…');
    expect(host.querySelector('.confirm')!.textContent).toContain('The canvas will switch to Major pentatonic.');
    await act(async () => button(host, 'Remove').click());
    expect(shown()).toBe('Major pentatonic');
    expect(notes()).toContain('C3');

    await choose(host, 'Key outside regions', 'D');
    expect(notes()).toContain('D3');

    await act(() => new Promise((r) => setTimeout(r, 450)));
    saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
    expect(saved.scales).toEqual([]);
    act(() => root.unmount());
  });

  it('code typed on a block is checked, marked on the block, and saved', async () => {
    const { host, root } = await mount();
    await addInstrument(host, 'Synths', 'Tone');
    const block = [...host.querySelectorAll('.react-flow__node-block')].at(-1)!;
    const type = (text: string) =>
      act(async () => {
        const area = host.querySelector<HTMLTextAreaElement>('.inspector textarea.code')!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text);
        area.dispatchEvent(new Event('input', { bubbles: true }));
      });

    await type('every 2: transpose +7');
    expect(block.querySelector('.block-code')!.className).not.toContain('has-errors');
    expect(host.querySelector('.code-errors')).toBeNull();

    await type('every 2: transpose +7\ntranspse 2');
    expect(host.querySelector('.code-errors')!.textContent).toContain('Line 2: "transpse" isn\'t a command');
    expect(block.querySelector('.block-code')!.className).toContain('has-errors');

    await act(() => new Promise((r) => setTimeout(r, 450)));
    const saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
    expect(saved.blocks.at(-1).code).toBe('every 2: transpose +7\ntranspse 2');
    act(() => root.unmount());
  });

  it('loads code on links from a saved piece', async () => {
    const piece = demoPiece();
    piece.links[0].code = 'chance 50%: drop';
    localStorage.setItem('pulse-canvas:piece:v1', JSON.stringify(piece));
    const { host, root } = await mount();
    // The demo already has code on one link.
    expect(host.querySelectorAll('.link-code')).toHaveLength(2);
    expect(host.querySelector(`.react-flow__edge[data-id="${piece.links[0].id}"] .link-code`)).not.toBeNull();
    act(() => root.unmount());
  });

  describe('region mix, effects and samples', () => {
    const selectMaqam = async (host: Element) => {
      await act(async () => host.querySelector<HTMLElement>('.react-flow__node-region .region-tab')!.click());
      expect(host.querySelector('.inspector-title')!.textContent).toContain('Region');
    };
    const slide = (host: Element, label: string, value: number) =>
      act(async () => {
        const input = host.querySelector<HTMLInputElement>(`.inspector input[aria-label="${label}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const readout = (host: Element, label: string) =>
      host.querySelector(`.inspector input[aria-label="${label}"]`)!.parentElement!.querySelector('.value')!.textContent;
    const pickSample = (host: Element, file: File) =>
      act(async () => {
        const input = host.querySelector<HTMLInputElement>('.inspector input[aria-label="Sample file"]')!;
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
      });

    it('sets level, pan, mute and effects, and saves them', async () => {
      const { host, root } = await mount();
      await selectMaqam(host);

      await slide(host, 'Level', -6);
      await slide(host, 'Pan', 0.5);
      await slide(host, 'Tone', 0.5);
      await slide(host, 'Reverb', 0.6);
      expect([readout(host, 'Level'), readout(host, 'Pan'), readout(host, 'Tone'), readout(host, 'Reverb')]).toEqual([
        '−6 dB',
        'R 50',
        '2.0 kHz',
        '60%',
      ]);
      await act(async () => button(host, '½').click());
      await act(async () => host.querySelector<HTMLInputElement>('.inspector .field-head input[type="checkbox"]')!.click());
      expect(host.querySelector('.region')!.className).toContain('is-muted');
      expect(host.querySelector('.region-tab')!.textContent).toContain('muted');

      await act(() => new Promise((r) => setTimeout(r, 450)));
      const saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
      expect(saved.regions[0]).toMatchObject({
        mix: { level: -6, pan: 0.5, mute: true },
        fx: { tone: 0.5, echo: 0.3, echoBeats: 0.5, reverb: 0.6 },
      });
      act(() => root.unmount());
    });

    it('loads a sample into a region, and refuses a file that is not audio', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const decode = vi.spyOn(Engine.prototype, 'loadSample');
      const { host, root } = await mount();
      await selectMaqam(host);

      decode.mockRejectedValueOnce(new DOMException('Unable to decode', 'EncodingError'));
      await pickSample(host, new File(['not audio'], 'notes.txt'));
      expect(host.querySelector('.toast-error')!.textContent).toContain("isn't audio");
      expect(host.querySelector('.sample-name')!.textContent).toContain('None');

      decode.mockResolvedValueOnce();
      await pickSample(host, new File([new Uint8Array([1, 2, 3])], 'bell.wav'));
      expect(host.querySelector('.sample-name')!.textContent).toBe('bell.wav');
      expect(host.querySelector('.region-tab')!.textContent).toContain('♪');

      await act(() => new Promise((r) => setTimeout(r, 450)));
      const saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
      expect(saved.regions[0].sample).toMatchObject({ name: 'bell.wav' });
      expect(saved.regions[0].sample.id).toMatch(/^smp-/);

      await act(async () => button(host, 'Remove').click());
      expect(host.querySelector('.region-tab')!.textContent).not.toContain('♪');
      act(() => root.unmount());
    });

    it('offers the tour first on the examples page', async () => {
      const { host, root } = await mount();
      // Navigation is a tab link; jsdom follows its fragment and fires hashchange.
      await act(async () => host.querySelector<HTMLAnchorElement>('a.tab[href="#/canvases"]')!.click());
      await act(() => new Promise((r) => setTimeout(r, 20)));
      await act(async () => host.querySelector<HTMLAnchorElement>('nav.tabs a[href="#/examples"]')!.click());
      await act(() => new Promise((r) => setTimeout(r, 20)));
      const titles = [...host.querySelectorAll('.example-card h2')].map((h) => h.textContent);
      expect(titles[0]).toBe('The tour');
      expect(titles).toHaveLength(12);
      act(() => root.unmount());
    });
  });

  describe('saving, sharing and recording', () => {
    // jsdom can't make object URLs or follow downloads; keep what would be saved.
    const downloads: { name: string; blob: Blob }[] = [];
    const urls = new Map<string, Blob>();
    beforeAll(() => {
      URL.createObjectURL = (blob: Blob) => {
        const url = `blob:test/${urls.size}`;
        urls.set(url, blob as Blob);
        return url;
      };
      URL.revokeObjectURL = () => {};
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push({ name: this.download, blob: urls.get(this.href)! });
      });
    });
    afterEach(() => {
      downloads.length = 0;
      history.replaceState(null, '', '/');
    });

    const blockCount = (host: Element) => host.querySelectorAll('.react-flow__node-block').length;
    // Toasts outlive a test, so look at the newest.
    const lastToast = (host: Element, kind: string) => [...host.querySelectorAll(`.toast-${kind}`)].at(-1)?.textContent;
    const confirmButton = (host: Element, text: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('.confirm button')].find((b) => b.textContent === text)!;
    const smallPiece = () => ({ ...demoPiece(), blocks: demoPiece().blocks.slice(0, 3), links: [], regions: [] });

    it('Share copies a link that opens the piece on a first visit', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const first = await mount();
      await act(async () => button(first.host, 'Share').click());
      await act(() => new Promise((r) => setTimeout(r, 50)));
      const url = writeText.mock.calls[0][0] as string;
      expect(url).toMatch(/#piece=1\./);
      expect(lastToast(first.host, 'success')).toContain('Link copied');
      act(() => first.root.unmount());

      localStorage.clear();
      history.replaceState(null, '', `/${new URL(url).hash}`);
      const { host, root } = await mount();
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(blockCount(host)).toBe(11);
      expect(host.querySelector('.confirm')).toBeNull();
      expect(location.hash).toBe('');
      act(() => root.unmount());
    });

    it('asks before a shared link replaces saved work, and reports a broken one', async () => {
      localStorage.setItem('pulse-canvas:piece:v1', JSON.stringify(demoPiece()));
      history.replaceState(null, '', `/#piece=${await encodeShare(smallPiece())}`);
      const { host, root } = await mount();
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(host.querySelector('.confirm')!.textContent).toContain('Open the shared piece?');
      expect(blockCount(host)).toBe(11);
      await act(async () => confirmButton(host, 'Open').click());
      expect(blockCount(host)).toBe(3);
      act(() => root.unmount());

      history.replaceState(null, '', '/#piece=1.garbage');
      const broken = await mount();
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(lastToast(broken.host, 'error')).toContain("Couldn't open the shared link");
      act(() => broken.root.unmount());
    });

    it('Save downloads a file that Open loads back', async () => {
      localStorage.setItem('pulse-canvas:piece:v1', JSON.stringify(smallPiece()));
      const { host, root } = await mount();
      await fileMenu(host, 'Save file');
      await act(() => new Promise((r) => setTimeout(r, 20)));
      expect(downloads[0].name).toMatch(/^pulse-canvas-.*\.json$/);
      const saved = await downloads[0].blob.text();

      await addInstrument(host, 'Synths', 'Tone');
      expect(blockCount(host)).toBe(4);
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Piece file"]')!;
      Object.defineProperty(input, 'files', { value: [new File([saved], 'mine.json')], configurable: true });
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
      await act(() => new Promise((r) => setTimeout(r, 20)));
      await act(async () => confirmButton(host, 'Open').click());
      expect(blockCount(host)).toBe(3);
      act(() => root.unmount());
    });

    it('Rec starts playback, shows the time, and saves a WAV', async () => {
      let recording = false;
      vi.spyOn(Engine.prototype, 'recording', 'get').mockImplementation(() => recording);
      vi.spyOn(Engine.prototype, 'startRecording').mockImplementation(async () => {
        recording = true;
      });
      vi.spyOn(Engine.prototype, 'stopRecording').mockImplementation(async () => {
        recording = false;
        return new Blob(['RIFF'], { type: 'audio/wav' });
      });
      const play = vi.spyOn(Engine.prototype, 'play').mockResolvedValue();
      const { host, root } = await mount();

      await act(async () => button(host, '● Rec').click());
      expect(play).toHaveBeenCalled();
      expect(host.querySelector('button.rec')!.textContent).toBe('■ 0:00');
      await act(async () => host.querySelector<HTMLButtonElement>('button.rec')!.click());
      expect(downloads[0].name).toMatch(/^pulse-canvas-.*\.wav$/);
      expect(host.querySelector('button.rec')!.textContent).toBe('● Rec');
      act(() => root.unmount());
    });
  });

  describe('undo', () => {
    const settle = () => act(() => new Promise((r) => setTimeout(r, 450)));
    const blocks = (host: Element) => host.querySelectorAll('.react-flow__node-block').length;
    const key = (init: KeyboardEventInit, target: EventTarget = window) =>
      act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })));

    it('takes back an added block, and redo puts it back', async () => {
      const { host, root } = await mount();
      expect(host.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled).toBe(true);
      await addInstrument(host, 'Synths', 'Tone');
      await settle();
      expect(host.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled).toBe(false);

      await key({ key: 'z', metaKey: true });
      expect(blocks(host)).toBe(11);
      await key({ key: 'z', metaKey: true, shiftKey: true });
      expect(blocks(host)).toBe(12);
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
      expect(blocks(host)).toBe(11);
      act(() => root.unmount());
    });

    it('treats a quick burst of edits as one step, and catches one still settling', async () => {
      vi.spyOn(Engine.prototype, 'audition').mockResolvedValue();
      const { host, root } = await mount();
      const note = () => [...host.querySelectorAll('.react-flow__node-block')].at(-1)!.querySelector('.block-note')!.textContent;
      await addInstrument(host, 'Synths', 'Tone');
      await settle();
      const before = note();
      const raise = host.querySelector<HTMLButtonElement>('[aria-label="Raise pitch"]')!;
      for (let i = 0; i < 3; i++) await act(async () => raise.click());
      const raised = note();
      expect(raised).not.toBe(before);
      await settle();
      await key({ key: 'z', ctrlKey: true });
      expect(note()).toBe(before);

      // Undo straight after an edit takes back that edit, even before it settles.
      await act(async () => raise.click());
      await key({ key: 'z', ctrlKey: true });
      expect(note()).toBe(before);
      expect(blocks(host)).toBe(12);
      act(() => root.unmount());
    });

    it('brings back a cleared canvas', async () => {
      const { host, root } = await mount();
      await fileMenu(host, 'New piece');
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.confirm button')].find((b) => b.textContent === 'New piece')!.click());
      expect(blocks(host)).toBe(1);
      await key({ key: 'z', metaKey: true });
      expect(blocks(host)).toBe(11);
      expect(host.querySelectorAll('.react-flow__node-region')).toHaveLength(1);
      act(() => root.unmount());
    });

    it('leaves the shortcut to a text box being typed in', async () => {
      const { host, root } = await mount();
      await addInstrument(host, 'Synths', 'Tone');
      await settle();
      await key({ key: 'z', metaKey: true }, host.querySelector('.inspector textarea')!);
      expect(blocks(host)).toBe(12);
      act(() => root.unmount());
    });
  });

  describe('link lengths and pages', () => {
    const selectFirstLink = async (host: Element) => {
      const edge = host.querySelector<SVGGElement>('.react-flow__edge')!;
      await act(async () => edge.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(host.querySelector('.inspector-title')!.textContent).toBe('Link');
      return edge.getAttribute('data-id')!;
    };
    const typeLength = (host: Element, text: string) =>
      act(async () => {
        const input = host.querySelector<HTMLInputElement>('input[aria-label="Length in beats"]')!;
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.blur();
      });

    it('a typed length bends the link to fit, and a too-short one is explained', async () => {
      const { host, root } = await mount();
      const id = await selectFirstLink(host);
      const edge = () => [...host.querySelectorAll('.react-flow__edge')].find((e) => e.getAttribute('data-id') === id)!;
      const label = () => edge().querySelector('.link-label')!.textContent;

      await typeLength(host, '9 1/2');
      expect(label()).toBe('9½');
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Length in beats"]')!.value).toBe('9½');
      expect(edge().querySelectorAll('.link-bend').length).toBeGreaterThan(0);

      await typeLength(host, '1/16');
      expect(host.querySelector('.inspector .warn')!.textContent).toContain("can't be shorter than");
      expect(label()).toBe('9½');

      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Longer"]')!.click());
      expect(label()).toBe('9¾');
      act(() => root.unmount());
    });

    it('lists every canvas, and a new one is kept beside the current', async () => {
      const { host, root } = await mount();
      const tick = () => act(() => new Promise((r) => setTimeout(r, 10)));
      const openCanvases = () =>
        act(async () => void host.querySelector('a.tab[href="#/canvases"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
      await openCanvases();
      await tick();
      expect(host.querySelector('.transport')).toBeNull();
      expect(host.querySelector('button[aria-label="File"]')).toBeNull();
      expect(host.querySelector('.canvases-page h1')!.textContent).toBe('Canvases');
      expect(host.querySelectorAll('.canvas-card')).toHaveLength(1);

      await act(async () => button(host, 'New canvas').click());
      await tick();
      expect(host.querySelector('a.tab.is-active')!.textContent).toBe('Canvas');
      await openCanvases();
      await tick();
      expect(host.querySelectorAll('.canvas-card')).toHaveLength(2);
      expect(host.querySelector<HTMLInputElement>('.canvas-card.is-current .canvas-name')!.value).toBe('Canvas 2');
      act(() => root.unmount());
    });

    it('tabs move between pages in the URL, and Escape comes back to the canvas', async () => {
      const { host, root } = await mount();
      const tick = () => act(() => new Promise((r) => setTimeout(r, 10)));
      // A real click event: an earlier test stubs HTMLAnchorElement.click to catch downloads.
      await act(async () => void host.querySelector('a.tab[href="#/canvases"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
      await tick();
      await act(async () => void host.querySelector('a.tab[href="#/guide"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
      await tick();
      expect(location.hash).toBe('#/guide');
      expect(host.querySelector('.guide-page h1')!.textContent).toBe('Guide');
      expect(host.querySelector('a.tab.is-active')!.textContent).toBe('Guide');

      await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await tick();
      expect(host.querySelector('.page')).toBeNull();
      expect(host.querySelector('a.tab.is-active')!.textContent).toBe('Canvas');

      await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })));
      await tick();
      expect(host.querySelector('.guide-page')).not.toBeNull();
      history.replaceState(null, '', '/');
      act(() => root.unmount());
    });
  });

  describe('repeats, performance keys and groove', () => {
    const setText = (el: HTMLInputElement, text: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const clickNode = (host: Element, selector: string) =>
      act(async () => host.querySelector(selector)!.closest('.react-flow__node')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const press = (key: string) => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));

    it('says when the whole piece repeats', async () => {
      const { host, root } = await mount();
      expect(host.querySelector('.cycle')!.textContent).toMatch(/Everything lines up again every \S+ beats, about .* at \d+ BPM/);
      act(() => root.unmount());
    });

    it('a start block key fires it while playing, and a region key mutes the region', async () => {
      vi.spyOn(Engine.prototype, 'playing', 'get').mockReturnValue(true);
      const fire = vi.spyOn(Engine.prototype, 'fire').mockImplementation(() => {});
      const { host, root } = await mount();

      await clickNode(host, '.block-start');
      await setText(host.querySelector<HTMLInputElement>('input[aria-label="Performance key"]')!, 'k');
      expect(host.querySelector('.block-key')!.textContent).toBe('K');

      await clickNode(host, '.region-tab');
      // K is taken by the start block, so the region can't have it.
      await setText(host.querySelector<HTMLInputElement>('input[aria-label="Performance key"]')!, 'k');
      expect(host.querySelector('.inspector .warn')!.textContent).toBe('K already fires a start block.');
      await setText(host.querySelector<HTMLInputElement>('input[aria-label="Performance key"]')!, 'm');
      expect(host.querySelector('.region-key')!.textContent).toBe('M');

      (document.activeElement as HTMLElement | null)?.blur();
      await press('k');
      expect(fire).toHaveBeenCalledTimes(1);
      await press('m');
      expect(host.querySelector('.region')!.className).toContain('is-muted');
      await press('m');
      expect(host.querySelector('.region')!.className).not.toContain('is-muted');

      await act(() => new Promise((r) => setTimeout(r, 450)));
      const saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
      expect(saved.blocks.find((b: { kind: string }) => b.kind === 'start').key).toBe('k');
      expect(saved.regions[0].key).toBe('m');
      act(() => root.unmount());
    });

    it('sets a region groove and saves it', async () => {
      const { host, root } = await mount();
      await clickNode(host, '.region-tab');
      const swing = host.querySelector<HTMLInputElement>('.inspector input[aria-label="Swing"]')!;
      await setText(swing, '0.6');
      await act(async () => button(host, '16ths').click());
      await act(() => new Promise((r) => setTimeout(r, 450)));
      const saved = JSON.parse(localStorage.getItem('pulse-canvas:piece:v1')!);
      expect(saved.regions[0].groove).toEqual({ swing: 0.6, swingGrid: 0.25, humanize: 0 });
      act(() => root.unmount());
    });
  });
});

