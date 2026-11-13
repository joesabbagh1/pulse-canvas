import { useEffect, useRef } from 'react';
import { Menu, type MenuItem } from './ui/Menu';
import { routeHref, type Route } from './ui/route';

const APP_TABS: { route: Route; label: string }[] = [
  { route: 'canvases', label: 'Canvases' },
  { route: 'examples', label: 'Examples' },
  { route: 'guide', label: 'Guide' },
  { route: 'instruments', label: 'Instruments' },
];

const CANVAS_TABS: { route: Route; label: string }[] = [
  { route: 'canvas', label: 'Canvas' },
  { route: 'waves', label: 'Waves' },
];

const insideCanvas = (route: Route) => route === 'canvas' || route === 'waves';

/** m:ss */
export const clockTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

interface Props {
  route: Route;
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
}

// Outside a canvas this is the app nav. Inside, it is that canvas's bar:
// back to the list, which view (notes or waves), and the controls for it.
export function TopBar(props: Props) {
  const { route, canvasName, playing, recording, recordedSeconds, bpm, snap, canUndo, canRedo, fileMenu } = props;
  const inside = insideCanvas(route);
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
            <span className="brand-index">00</span>
            <span className="brand-name">Pulse</span>
          </a>
        )}
        {inside && <span className="canvas-bar-name">{canvasName}</span>}
        <nav className="tabs" aria-label={inside ? 'Canvas' : 'Pages'} ref={tabs}>
          {(inside ? CANVAS_TABS : APP_TABS).map((t, index) => (
            <a
              key={t.route}
              href={routeHref(t.route)}
              data-n={String(index + 1).padStart(2, '0')}
              className={`tab${route === t.route ? ' is-active' : ''}`}
              aria-current={route === t.route ? 'page' : undefined}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </div>

      {inside && (
      <div className="app-bar-group transport" role="group" aria-label="Transport">
        <button className={`play${playing ? ' is-on' : ''}`} onClick={props.onTogglePlay} title={`${playing ? 'Stop' : 'Play'} (Space)`}>
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        <button
          className={`rec${recording ? ' is-on' : ''}`}
          onClick={props.onToggleRecording}
          title={recording ? 'Stop recording and save the WAV file' : 'Record what you hear to a WAV file'}
        >
          {recording ? `■ ${clockTime(recordedSeconds)}` : '● Rec'}
        </button>
        <label className="tempo" title="Tempo, in beats per minute">
          <span className="tempo-label">BPM</span>
          <input type="range" min={50} max={200} value={bpm} onChange={(e) => props.onBpm(Number(e.target.value))} aria-label="Tempo" />
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
        </label>
        <label className="toggle snap-toggle" title="Round every link to the nearest quarter beat">
          <input type="checkbox" checked={snap} onChange={(e) => props.onSnap(e.target.checked)} />
          <span>Snap ¼</span>
        </label>
      </div>
      )}

      {inside && (
      <div className="app-bar-group actions">
        <button className="icon" onClick={props.onUndo} disabled={!canUndo} title={`Undo (${MOD}Z)`} aria-label="Undo">
          ↶
        </button>
        <button className="icon" onClick={props.onRedo} disabled={!canRedo} title={`Redo (${MOD}⇧Z)`} aria-label="Redo">
          ↷
        </button>
        <button className="danger" onClick={props.onClear} title={`Clear the canvas (${MOD}Z brings it back)`}>
          Clear
        </button>
        <button className="share" onClick={props.onShare} title="Copy a link that opens a copy of this piece">
          Share
        </button>
        <Menu label={<>File ▾</>} title="File" items={fileMenu} />
      </div>
      )}
    </header>
  );
}
