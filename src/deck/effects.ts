import type { DeckBlock, DeckFx, DeckGroove, DeckLink, DeckMix, DeckRegion, DeckWave } from './scene';
import type { Take } from '../takes';

/** A change the open canvas applies. Ids are already chosen, so the reply can name them. */
export type DeckEffect =
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'bpm'; bpm: number }
  | { type: 'fire'; id: string }
  | { type: 'region'; id: string; mix?: Partial<DeckMix>; fx?: Partial<DeckFx>; groove?: Partial<DeckGroove> }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'bends'; id: string; bends: { x: number; y: number }[] }
  | { type: 'addBlock'; block: DeckBlock }
  | { type: 'putBlock'; block: DeckBlock }
  | { type: 'addLink'; link: DeckLink }
  | { type: 'putLink'; link: DeckLink }
  | { type: 'addRegion'; region: DeckRegion }
  | {
      type: 'placeRegion';
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      name?: string;
      scaleId?: string;
      rootHz?: number;
      /** Null clears the performance key. */
      key?: string | null;
    }
  | { type: 'drop'; blockIds: string[]; linkIds: string[]; regionIds: string[]; waveIds: string[] }
  | { type: 'tune'; scaleId?: string; rootHz?: number; snap?: boolean }
  | { type: 'addWave'; wave: DeckWave }
  | { type: 'putWave'; wave: DeckWave }
  | { type: 'playNotes'; instrument: string; notes: { degree: number; beats: number; at: number; velocity: number }[] }
  | { type: 'recordStart' }
  | { type: 'recordStop' }
  | { type: 'saveTake'; take: Take }
  | { type: 'placeTake'; take: Take };

export type DeckPlan = { error: string } | { effects: DeckEffect[]; text: string };
