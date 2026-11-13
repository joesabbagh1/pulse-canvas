import type { CSSProperties } from 'react';
import { stringStops } from '../engine/playing';
import { NoteControl, Pitch, type SurfaceProps } from './note';

/** A fingerboard stands up. A fretboard lies down, nut on the left, lowest string on top. */
export function Board({
  notes,
  strings,
  fretted,
  held,
  hints,
  onPointerDown,
  onPointerEnd,
  onContextMenu,
}: SurfaceProps & { strings: readonly number[]; fretted: boolean }) {
  const stops = stringStops(strings, notes);
  const byString = strings.map((_, index) => stops.filter((stop) => stop.string === index));
  const longest = Math.max(1, ...byString.map((row) => row.length));
  return (
    <div
      className={`board${fretted ? ' is-fretted' : ''}`}
      style={{ '--strings': strings.length, '--stops': longest } as CSSProperties}
      onContextMenu={onContextMenu}
      role="group"
      aria-label={fretted ? 'Fretboard' : 'Fingerboard'}
    >
      <div className="board-nut" aria-hidden="true" />
      <div className="board-strings">
        {byString.map((row, index) => (
          <div key={strings[index]} className="board-string">
            <span className="board-open" aria-hidden="true" />
            {row
              .slice()
              .sort((a, b) => a.along - b.along)
              .map((stop) => (
                <NoteControl
                  key={`${index}-${stop.note.degree}`}
                  note={stop.note}
                  held={held.has(stop.note.degree)}
                  hint={hints.get(stop.note.degree)}
                  className="board-stop"
                  style={fretted ? { left: `${8 + stop.along * 88}%` } : { top: `${8 + stop.along * 86}%` }}
                  onPointerDown={onPointerDown}
                  onPointerEnd={onPointerEnd}
                >
                  <Pitch note={stop.note} hint={hints.get(stop.note.degree)} />
                </NoteControl>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
