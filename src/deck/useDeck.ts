import { useEffect, useRef, useState } from 'react';
import type { XY } from '../engine/geometry';
import { connectDeck, type DeckStatus } from './client';
import { perform, type DeckEffect } from './plan';
import type { DeckFx, DeckGroove, DeckInput, DeckMix } from './scene';

const GESTURE = 'Press Play in the browser once so it can make sound. After that, the deck can start and stop on its own.';

export interface DeckHandlers {
  snapshot: () => DeckInput;
  play: () => Promise<void>;
  stop: () => void;
  playing: () => boolean;
  contextRunning: () => boolean;
  setBpm: (bpm: number) => void;
  fire: (id: string) => void;
  patchRegion: (id: string, patch: { mix?: Partial<DeckMix>; fx?: Partial<DeckFx>; groove?: Partial<DeckGroove> }) => void;
  moveBlock: (id: string, x: number, y: number) => void;
  setLinkBends: (id: string, bends: XY[]) => void;
}

async function apply(handlers: DeckHandlers, effects: DeckEffect[]): Promise<string | null> {
  for (const effect of effects) {
    if (effect.type === 'bpm') handlers.setBpm(effect.bpm);
    else if (effect.type === 'stop') handlers.stop();
    else if (effect.type === 'play') {
      try {
        await handlers.play();
      } catch (err) {
        if (!handlers.contextRunning()) return GESTURE;
        return err instanceof Error ? err.message : 'Play failed.';
      }
      if (!handlers.playing() || !handlers.contextRunning()) {
        handlers.stop();
        return GESTURE;
      }
    } else if (effect.type === 'fire') handlers.fire(effect.id);
    else if (effect.type === 'region') handlers.patchRegion(effect.id, { mix: effect.mix, fx: effect.fx, groove: effect.groove });
    else if (effect.type === 'move') handlers.moveBlock(effect.id, effect.x, effect.y);
    else handlers.setLinkBends(effect.id, effect.bends);
  }
  return null;
}

/** Connects this canvas to the local deck, if the server is running. */
export function useDeck(handlers: DeckHandlers): DeckStatus {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [status, setStatus] = useState<DeckStatus>('idle');

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    const deck = connectDeck(async (command) => {
      const planned = perform(ref.current.snapshot(), command);
      if ('error' in planned) return { ok: false, error: planned.error };
      const failed = await apply(ref.current, planned.effects);
      if (failed) return { ok: false, error: failed };
      return { ok: true, text: planned.text };
    }, setStatus);
    return () => deck.close();
  }, []);

  return status;
}
