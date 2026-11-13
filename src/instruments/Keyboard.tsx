import { isRaisedKey, type PlayNote } from '../engine/playing';
import { NoteControl, type SurfaceProps } from './note';

/** A piano only works when each crack holds at most one raised key. */
function pianoRows(notes: readonly PlayNote[]): { naturals: PlayNote[]; gaps: PlayNote[][] } | null {
  const naturals = notes.filter((note) => !isRaisedKey(note));
  if (naturals.length < 2) return null;
  const gaps: PlayNote[][] = Array.from({ length: naturals.length + 1 }, () => []);
  let index = -1;
  for (const note of notes) {
    if (!isRaisedKey(note)) index += 1;
    else gaps[Math.max(0, index + 1)].push(note);
  }
  if (gaps.some((gap) => gap.length > 1)) return null;
  return { naturals, gaps };
}

function octaves(notes: readonly PlayNote[]) {
  const groups: { octave: number; notes: PlayNote[] }[] = [];
  for (const note of notes) {
    const last = groups[groups.length - 1];
    if (last && last.octave === note.octave) last.notes.push(note);
    else groups.push({ octave: note.octave, notes: [note] });
  }
  return groups;
}

export function Keyboard({ notes, held, hints, variant, onPointerDown, onPointerEnd, onContextMenu }: SurfaceProps & { variant: string }) {
  const piano = pianoRows(notes);
  return (
    <div className={`kb kb-${variant}${piano ? '' : ' is-row'}`} onContextMenu={onContextMenu} role="group" aria-label="Keyboard">
      {variant === 'accordion' && <div className="kb-bellows" aria-hidden="true" />}
      {piano ? (
        <div className="kb-bed">
          <div className="kb-whites">
            {piano.naturals.map((note) => (
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
          {piano.gaps.flatMap((group, gap) =>
            group.map((note) => (
              <NoteControl
                key={note.degree}
                note={note}
                held={held.has(note.degree)}
                hint={hints.get(note.degree)}
                className={`kb-raised${note.offset !== 0 ? ' is-inflected' : ''}`}
                style={{ left: `${(gap / piano.naturals.length) * 100}%`, width: `${(0.62 / piano.naturals.length) * 100}%` }}
                onPointerDown={onPointerDown}
                onPointerEnd={onPointerEnd}
              />
            )),
          )}
        </div>
      ) : (
        <div className="kb-scale">
          {octaves(notes).map((group) => (
            <div key={group.octave} className="kb-octave">
              {group.notes.map((note) => (
                <NoteControl
                  key={note.degree}
                  note={note}
                  held={held.has(note.degree)}
                  hint={hints.get(note.degree)}
                  className={`kb-key${isRaisedKey(note) ? ' is-inflected' : ''}`}
                  onPointerDown={onPointerDown}
                  onPointerEnd={onPointerEnd}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
