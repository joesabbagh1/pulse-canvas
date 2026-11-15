import { useEffect, useRef } from 'react';
import { Menu, type MenuItem } from './ui/Menu';
import { routeHref, type Route } from './ui/route';
import { useTheme } from './ui/theme';

const APP_TABS: { route: Route; label: string }[] = [
  { route: 'canvases', label: 'Canvases' },
  { route: 'examples', label: 'Examples' },
  { route: 'guide', label: 'Guide' },
  { route: 'instruments', label: 'Instruments' },
  { route: 'synth', label: 'Synth' },
  { route: 'graph', label: 'Graph' },
  { route: 'viz', label: 'Viz' },
];

const CANVAS_TABS: { route: Route; label: string }[] = [
  { route: 'canvas', label: 'Canvas' },
  { route: 'waves', label: 'Waves' },
  { route: 'viz', label: 'Viz' },
];

// Viz counts as inside: it is one of the views of the open canvas, so its bar
// keeps the canvas's name and links, and playback carries over.
const insideCanvas = (route: Route) => route === 'canvas' || route === 'waves' || route === 'viz';

/** m:ss */
export const clockTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

const ICONS = {
  play: 'M5 3.5v9l7.5-4.5z',
  stop: 'M4.5 4.5h7v7h-7z',
  undo: 'M6 3 3 6l3 3M3 6h6.5a3.5 3.5 0 0 1 0 7H7',
  redo: 'M10 3l3 3-3 3M13 6H6.5a3.5 3.5 0 0 0 0 7H9',
  sun: 'M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
  moon: 'M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6z',
};

function Icon({ name, solid }: { name: keyof typeof ICONS; solid?: boolean }) {
  return (
    <svg className={`icon-svg${solid ? ' is-solid' : ''}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

interface Props {
  route: Route;
  /** The open canvas, or null when the library is empty. */
  canvasId: string | null;
  canvasName: string;
  playing: boolean;
  recording: boolean;
  recordedSeconds: number;
  bpm: number;
  snap: boolean;
  canUndo: boolean;
  canRedo: boolean;
  fileMenu: MenuItem[];
  onTogglePlay: () => void;
  onToggleRecording: () => void;
  onBpm: (bpm: number) => void;
  onSnap: (snap: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onShare: () => void;
  onClear: () => void;
  /** Whether an AI deck is connected to this canvas. */
  deck: 'idle' | 'live';
}

// Outside a canvas this is the app nav. Inside, it is that canvas's bar:
// back to the list, which view (notes, waves or viz), and the controls for it.
export function TopBar(props: Props) {
  const { route, canvasId, canvasName, playing, recording, recordedSeconds, bpm, snap, canUndo, canRedo, fileMenu } = props;
  const inside = insideCanvas(route);
  // The graph page rides the piece's transport, so its play, tempo and
  // recording belong there too; the viz stage gets them by being inside.
  const hears = inside || route === 'graph';
  const [theme, setTheme] = useTheme();
  const tabs = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = tabs.current;
    const active = nav?.querySelector('.is-active');
    if (!nav || !(active instanceof HTMLElement)) return;
    const navBox = nav.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.right > navBox.right - 4) nav.scrollLeft += box.right - navBox.right + 12;
    else if (box.left < navBox.left + 4) nav.scrollLeft -= navBox.left - box.left + 12;
  }, [route]);
  return (
    <header className={`app-bar${inside ? ' is-canvas' : ''}`}>
      <div className="app-bar-group">
        {inside ? (
          <a className="tab back" href={routeHref('canvases')}>
            Canvases
          </a>
        ) : (
          <a className="brand" href={routeHref('canvases')} aria-label="Pulse Canvas">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">Pulse</span>
          </a>
        )}
        {inside && <span className="canvas-bar-name">{canvasName}</span>}
        <nav className="tabs" aria-label={inside ? 'Canvas' : 'Pages'} ref={tabs}>
          {(inside ? CANVAS_TABS : APP_TABS).map((t) => (
            <a key={t.route} href={routeHref(t.route, canvasId)} className={`tab${route === t.route ? ' is-active' : ''}`} aria-current={route === t.route ? 'page' : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
      </div>

      {hears && (
      <div className="app-bar-group transport" role="group" aria-label="Transport">
        <button className={`play${playing ? ' is-on' : ''}`} onClick={props.onTogglePlay} title={`${playing ? 'Stop' : 'Play'} (Space)`}>
          <Icon name={playing ? 'stop' : 'play'} solid />
          {playing ? 'Stop' : 'Play'}
        </button>
        <button
          className={`rec${recording ? ' is-on' : ''}`}
          onClick={props.onToggleRecording}
          title={recording ? 'Stop recording and save the WAV file' : 'Record what you hear to a WAV file'}
        >
          {recording ? (
            `■ ${clockTime(recordedSeconds)}`
          ) : (
            <>
              <span className="rec-dot">●</span> Rec
            </>
          )}
        </button>
        <label className="tempo" title="Tempo, in beats per minute">
          <input
            type="number"
            min={50}
            max={200}
            value={bpm}
            aria-label="Tempo in beats per minute"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 50 && n <= 200) props.onBpm(Math.round(n));
            }}
          />
          <span className="tempo-label">BPM</span>
          <input type="range" min={50} max={200} value={bpm} onChange={(e) => props.onBpm(Number(e.target.value))} aria-label="Tempo" />
        </label>
        <label className="toggle snap-toggle" title="Round every link to the nearest quarter beat">
          <input type="checkbox" checked={snap} onChange={(e) => props.onSnap(e.target.checked)} />
          <span>Snap ¼</span>
        </label>
        <span
          className={`deck-status${props.deck === 'live' ? ' is-live' : ''}`}
          title={props.deck === 'live' ? 'An AI can play this canvas.' : 'Start the deck server and an AI can play this canvas.'}
        >
          <span className="status-dot" />
          Deck
        </span>
      </div>
      )}

      <div className="app-bar-group actions">
        {inside && (
          <>
            <button className="icon" onClick={props.onUndo} disabled={!canUndo} title={`Undo (${MOD}Z)`} aria-label="Undo">
              <Icon name="undo" />
            </button>
            <button className="icon" onClick={props.onRedo} disabled={!canRedo} title={`Redo (${MOD}⇧Z)`} aria-label="Redo">
              <Icon name="redo" />
            </button>
            <button className="danger" onClick={props.onClear} title={`Clear the canvas (${MOD}Z brings it back)`}>
              Clear
            </button>
            <button className="share" onClick={props.onShare} title="Copy a link that opens a copy of this piece">
              Share
            </button>
            <Menu label={<>File ▾</>} title="File" items={fileMenu} />
          </>
        )}
        <button
          className="icon theme-toggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to white' : 'Switch to black'}
          aria-label={theme === 'dark' ? 'Use the white theme' : 'Use the black theme'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </header>
  );
}
