import type { CSSProperties } from 'react';
import { NoteControl, pitchT, type SurfaceProps } from './note';

export function OpenStrings({ notes, variant, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps & { variant: 'harp' | 'koto' | 'dulcimer' }) {
  return (
    <div className={`open-strings is-${variant}`} onContextMenu={onContextMenu} role="group" aria-label={variant}>
      {variant === 'dulcimer' && <div className="dulcimer-body" aria-hidden="true" />}
      <div className="open-string-row">
        {notes.map((note) => {
          const t = pitchT(note, notes);
          const course = note.offset === 0 && (note.name === 'C' || note.name === 'F');
          return (
            <NoteControl
              key={note.degree}
              note={note}
              held={held.has(note.degree)}
              hint={hints.get(note.degree)}
              className={`open-string${course ? ` is-${note.name.toLowerCase()}` : ''}`}
              style={{ '--reach': 1 - t } as CSSProperties}
              onPointerDown={onPointerDown}
              onPointerEnd={onPointerEnd}
            />
          );
        })}
      </div>
    </div>
  );
}
