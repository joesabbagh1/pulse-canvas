import { isRaisedKey, type PlayNote } from '../engine/playing';
import { NoteControl, Pitch, type SurfaceProps } from './note';

function rows(notes: readonly PlayNote[]) {
  const naturals = notes.filter((note) => !isRaisedKey(note));
  if (!naturals.length) return { naturals: notes, gaps: [] as PlayNote[][] };
  const gaps: PlayNote[][] = Array.from({ length: naturals.length + 1 }, () => []);
  let index = -1;
  for (const note of notes) {
    if (!isRaisedKey(note)) index += 1;
    else gaps[Math.max(0, index + 1)].push(note);
  }
  return { naturals, gaps };
}

export function Keyboard({ notes, held, hints, variant, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps & { variant: string }) {
  const { naturals, gaps } = rows(notes);
  return (
    <div className={`kb kb-${variant}`} onContextMenu={onContextMenu} role="group" aria-label="Keyboard">
      {variant === 'accordion' && <div className="kb-bellows" aria-hidden="true" />}
      <div className="kb-bed">
        <div className="kb-whites">
          {naturals.map((note) => (
            <NoteControl
              key={note.degree}
              note={note}
              held={held.has(note.degree)}
              hint={hints.get(note.degree)}
              className="kb-white"
              onPointerDown={onPointerDown}
              onPointerEnd={onPointerEnd}
            />
          ))}
        </div>
        {gaps.flatMap((group, gap) =>
          group.map((note, index) => {
            const crack = gap / naturals.length;
            const spread = 0.62 / naturals.length;
            const shift = group.length === 1 ? 0 : (index / (group.length - 1) - 0.5) * spread;
            return (
              <NoteControl
                key={note.degree}
                note={note}
                held={held.has(note.degree)}
                hint={hints.get(note.degree)}
                className={`kb-raised${note.offset !== 0 ? ' is-inflected' : ''}`}
                style={{ left: `${(crack + shift) * 100}%` }}
                onPointerDown={onPointerDown}
                onPointerEnd={onPointerEnd}
              >
                <Pitch note={note} hint={hints.get(note.degree)} />
              </NoteControl>
            );
          }),
        )}
      </div>
    </div>
  );
}
