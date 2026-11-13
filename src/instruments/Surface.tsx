import type { HitVariant, Playing } from '../engine/playing';
import type { Scale } from '../engine/tuning';
import { Board } from './Board';
import { Brass } from './Brass';
import { NoteGrid } from './Grid';
import { Hit } from './Hit';
import { Bars, Heads, Kalimba, Kettles, Stabs, SteelPan } from './Idiophones';
import { Keyboard } from './Keyboard';
import { Staff } from './Staff';
import { OpenStrings } from './Strings';
import { Pipes, Tongue, WindBody } from './Wind';
import type { SurfaceProps } from './note';

export function InstrumentSurface({
  playing,
  scale,
  name,
  padHeld,
  ...play
}: SurfaceProps & { playing: Playing; scale: Scale; name: string; padHeld: boolean }) {
  switch (playing.layout) {
    case 'keyboard':
      return <Keyboard {...play} variant={playing.variant} />;
    case 'fingerboard':
      return <Board {...play} strings={playing.strings} fretted={false} />;
    case 'fretboard':
      return <Board {...play} strings={playing.strings} fretted />;
    case 'strings':
      return <OpenStrings {...play} variant={playing.variant} />;
    case 'tongue':
      return <Tongue {...play} />;
    case 'pipes':
      return <Pipes {...play} variant={playing.variant} />;
    case 'wind':
      return <WindBody {...play} variant={playing.variant} />;
    case 'brass':
      return <Brass {...play} variant={playing.variant} />;
    case 'bars':
      return <Bars {...play} variant={playing.variant} />;
    case 'kalimba':
      return <Kalimba {...play} />;
    case 'pan':
      return <SteelPan {...play} />;
    case 'kettles':
      return <Kettles {...play} />;
    case 'heads':
      return <Heads {...play} variant={playing.variant} />;
    case 'stabs':
      return <Stabs {...play} />;
    case 'grid':
      return <NoteGrid {...play} scale={scale} />;
    case 'buttons':
      return <NoteGrid {...play} scale={scale} round />;
    case 'staff':
      return <Staff {...play} syllable={playing.syllable} />;
    case 'hit':
      return (
        <Hit
          variant={playing.variant as HitVariant}
          name={name}
          held={padHeld}
          onPointerDown={play.onPointerDown}
          onPointerEnd={play.onPointerEnd}
          onContextMenu={play.onContextMenu}
        />
      );
  }
}
