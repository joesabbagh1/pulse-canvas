import { NoteControl, Pitch, type SurfaceProps } from './note';

export function Brass({ notes, variant, held, hints, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps & { variant: string }) {
  const ordered = variant === 'trombone' ? [...notes].reverse() : notes;
  if (variant === 'horn') {
    return (
      <div className="brass is-horn" onContextMenu={onContextMenu} role="group" aria-label="Horn">
        <div className="horn-coil" aria-hidden="true" />
        {ordered.map((note, index) => {
          const angle = (index / Math.max(1, ordered.length)) * Math.PI * 2 - Math.PI / 2;
          return (
            <NoteControl
              key={note.degree}
              note={note}
              held={held.has(note.degree)}
              hint={hints.get(note.degree)}
              className="brass-note"
              style={{ left: `${50 + Math.cos(angle) * 38}%`, top: `${50 + Math.sin(angle) * 38}%` }}
              onPointerDown={onPointerDown}
              onPointerEnd={onPointerEnd}
            >
              <Pitch note={note} hint={hints.get(note.degree)} />
            </NoteControl>
          );
        })}
      </div>
    );
  }
  return (
    <div className={`brass is-${variant}`} onContextMenu={onContextMenu} role="group" aria-label="Brass">
      <div className="brass-body" aria-hidden="true">
        {variant === 'section' ? (
          <>
            <span />
            <span />
            <span />
          </>
        ) : (
          <span className="brass-bell" />
        )}
        {variant === 'muted' && <span className="brass-mute" />}
      </div>
      <div className={`brass-notes${variant === 'trombone' ? ' is-slide' : ''}`}>
        {ordered.map((note) => (
          <NoteControl
            key={note.degree}
            note={note}
            held={held.has(note.degree)}
            hint={hints.get(note.degree)}
            className="brass-note"
            onPointerDown={onPointerDown}
            onPointerEnd={onPointerEnd}
          >
            <Pitch note={note} hint={hints.get(note.degree)} />
          </NoteControl>
        ))}
      </div>
    </div>
  );
}
