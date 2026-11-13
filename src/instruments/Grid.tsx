import type { Scale } from '../engine/tuning';
import { periodOf } from '../engine/playing';
import { NoteControl, Pitch, type SurfaceProps } from './note';

export function NoteGrid({
  notes,
  scale,
  round,
  held,
  hints,
  onPointerDown,
  onPointerEnd,
  onContextMenu,
}: SurfaceProps & { scale: Scale; round?: boolean }) {
  const steps = Math.max(1, scale.cents.length);
  const starts = [...new Set(notes.map((note) => periodOf(note.degree, scale)))].sort((a, b) => b - a);
  return (
    <div
      className={`note-grid${round ? ' is-round' : ''}`}
      style={{ gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))` }}
      onContextMenu={onContextMenu}
      role="group"
      aria-label={round ? 'Buttons' : 'Grid'}
    >
      {starts.map((start) =>
        Array.from({ length: steps }, (_, step) => {
          const note = notes.find((item) => item.degree === start + step);
          if (!note) return <span key={`${start}-${step}`} className="grid-gap" />;
          return (
            <NoteControl
              key={note.degree}
              note={note}
              held={held.has(note.degree)}
              hint={hints.get(note.degree)}
              className="grid-cell"
              onPointerDown={onPointerDown}
              onPointerEnd={onPointerEnd}
            >
              <Pitch note={note} hint={hints.get(note.degree)} />
            </NoteControl>
          );
        }),
      )}
    </div>
  );
}
