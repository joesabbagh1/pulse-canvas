import { useEffect, useState } from 'react';
import { MAX_CANVASES, type SavedCanvas } from './library';

interface Props {
  canvases: readonly SavedCanvas[];
  /** The canvas being edited, or null when there is none. */
  currentId: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function updatedLabel(time: number) {
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  return `Updated ${new Date(time).toLocaleDateString()}`;
}

function CanvasCard({
  canvas,
  current,
  onOpen,
  onRename,
  onDelete,
}: {
  canvas: SavedCanvas;
  current: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(canvas.name);
  useEffect(() => setName(canvas.name), [canvas.name]);
  const blocks = canvas.piece.blocks.length;
  const regions = canvas.piece.regions.length;
  return (
    <article className={`example-card canvas-card${current ? ' is-current' : ''}`}>
      <div className="example-body">
        <div className="example-tradition">{current ? 'Editing' : 'Canvas'}</div>
        <input
          className="canvas-name"
          aria-label="Canvas name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() !== canvas.name) onRename(name);
            else setName(canvas.name);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <p className="muted">{updatedLabel(canvas.updatedAt)}</p>
      </div>
      <footer className="example-footer">
        <span className="example-meta muted">
          {canvas.piece.bpm} BPM · {blocks} {blocks === 1 ? 'block' : 'blocks'}
          {regions > 0 && ` · ${regions} ${regions === 1 ? 'region' : 'regions'}`}
        </span>
        <span className="canvas-actions">
          <button type="button" className="danger" onClick={onDelete}>
            Delete
          </button>
          <button type="button" className="play" onClick={onOpen}>
            Open
          </button>
        </span>
      </footer>
    </article>
  );
}

/** Every canvas in this browser. Opening one loads it; the others stay. */
export function CanvasesPage({ canvases, currentId, onOpen, onCreate, onRename, onDelete }: Props) {
  const ordered = [...canvases].sort((a, b) => {
    if (a.id === currentId) return -1;
    if (b.id === currentId) return 1;
    return b.updatedAt - a.updatedAt;
  });
  return (
    <div className="page canvases-page">
      <div className="page-body">
        <header className="page-header canvases-header">
          <div>
            <h1>Canvases</h1>
            <p className="muted">Every piece in this browser. Each one keeps its own notes, waves, and takes.</p>
          </div>
          <button type="button" className="play" onClick={onCreate} disabled={canvases.length >= MAX_CANVASES}>
            New canvas
          </button>
        </header>
        {ordered.length ? (
          <div className="examples-grid">
            {ordered.map((canvas) => (
              <CanvasCard
                key={canvas.id}
                canvas={canvas}
                current={canvas.id === currentId}
                onOpen={() => onOpen(canvas.id)}
                onRename={(name) => onRename(canvas.id, name)}
                onDelete={() => onDelete(canvas.id)}
              />
            ))}
          </div>
        ) : (
          <div className="canvas-empty">
            <p>No canvases yet.</p>
            <p className="muted">A canvas holds one piece: its notes, waves, and takes.</p>
            <button type="button" className="play" onClick={onCreate}>
              New canvas
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
