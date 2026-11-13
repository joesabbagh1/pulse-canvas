import type { CSSProperties } from 'react';
import { NoteControl, Pitch, pitchT, type SurfaceProps } from './note';

export function Staff({ notes, syllable, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps & { syllable: string }) {
  return (
    <div className="staff" onContextMenu={onContextMenu} role="group" aria-label="Voice">
      <span className="staff-word">{syllable}</span>
      <div className="staff-lines" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="staff-notes">
        {notes.map((note) => (
          <NoteControl
            key={note.degree}
            note={note}
            held={held.has(note.degree)}
            hint={hints.get(note.degree)}
            className="staff-note"
            style={{ '--pitch': `${16 + (1 - pitchT(note, notes)) * 58}%` } as CSSProperties}
            onPointerDown={onPointerDown}
            onPointerEnd={onPointerEnd}
          >
            <span className="staff-head" />
            <Pitch note={note} hint={hints.get(note.degree)} />
          </NoteControl>
        ))}
      </div>
    </div>
  );
}
