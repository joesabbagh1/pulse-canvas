import { useEffect, useRef, useState } from 'react';
import type { XY } from '../engine/geometry';
import { connectDeck, type DeckStatus } from './client';
import type { DeckEffect } from './effects';
import type { Bed } from '../bed';
import type { SampleRef } from '../engine/samples';
import { perform } from './plan';
import { renderScene, type DeckBlock, type DeckFx, type DeckGroove, type DeckInput, type DeckLink, type DeckMachine, type DeckMix, type DeckRegion, type DeckWave } from './scene';
import type { Take } from '../takes';

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
  addBlock: (block: DeckBlock) => void;
  putBlock: (block: DeckBlock) => void;
  addLink: (link: DeckLink) => void;
  putLink: (link: DeckLink) => void;
  addRegion: (region: DeckRegion) => void;
  placeRegion: (region: Extract<DeckEffect, { type: 'placeRegion' }>) => void;
  drop: (gone: { blockIds: string[]; linkIds: string[]; regionIds: string[]; waveIds: string[] }) => void;
  tune: (tuning: { scaleId?: string; rootHz?: number; snap?: boolean }) => void;
  addWave: (wave: DeckWave) => void;
  putWave: (wave: DeckWave) => void;
  /** Upserts a synth machine into the piece. */
  putMachine: (machine: DeckMachine) => void;
  dropMachine: (id: string) => void;
  playNotes: (phrase: { instrument: string; notes: { degree: number; beats: number; at: number; velocity: number }[] }) => Promise<string | null>;
  recordStart: () => Promise<string | null>;
  recordStop: () => Promise<void>;
  saveTake: (take: Take) => void;
  placeTake: (take: Take) => void;
  /** Saves the open canvas and opens a new empty one. Returns an error, or null. */
  newCanvas: (name: string) => string | null;
  openCanvas: (id: string) => string | null;
  renameCanvas: (id: string, name: string) => void;
  deleteCanvas: (id: string) => string | null;
  openExample: (id: string) => string | null;
  undo: () => string | null;
  redo: () => string | null;
  setBed: (bed: Bed | null) => void;
  /** Null clears the region's sample. */
  regionSample: (id: string, sample: SampleRef | null) => Promise<string | null>;
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
    else if (effect.type === 'bends') handlers.setLinkBends(effect.id, effect.bends);
    else if (effect.type === 'addBlock') handlers.addBlock(effect.block);
    else if (effect.type === 'putBlock') handlers.putBlock(effect.block);
    else if (effect.type === 'addLink') handlers.addLink(effect.link);
    else if (effect.type === 'putLink') handlers.putLink(effect.link);
    else if (effect.type === 'addRegion') handlers.addRegion(effect.region);
    else if (effect.type === 'placeRegion') handlers.placeRegion(effect);
    else if (effect.type === 'drop') handlers.drop(effect);
    else if (effect.type === 'tune') handlers.tune(effect);
    else if (effect.type === 'addWave') handlers.addWave(effect.wave);
    else if (effect.type === 'putWave') handlers.putWave(effect.wave);
    else if (effect.type === 'putMachine') handlers.putMachine(effect.machine);
    else if (effect.type === 'dropMachine') handlers.dropMachine(effect.id);
    else if (effect.type === 'playNotes') {
      const failed = await handlers.playNotes(effect);
      if (failed) return failed;
    } else if (effect.type === 'recordStart') {
      const failed = await handlers.recordStart();
      if (failed) return failed;
    } else if (effect.type === 'recordStop') await handlers.recordStop();
    else if (effect.type === 'saveTake') handlers.saveTake(effect.take);
    else if (effect.type === 'placeTake') handlers.placeTake(effect.take);
    else if (effect.type === 'newCanvas') {
      const failed = handlers.newCanvas(effect.name);
      if (failed) return failed;
    } else if (effect.type === 'openCanvas') {
      const failed = handlers.openCanvas(effect.id);
      if (failed) return failed;
    } else if (effect.type === 'renameCanvas') handlers.renameCanvas(effect.id, effect.name);
    else if (effect.type === 'deleteCanvas') {
      const failed = handlers.deleteCanvas(effect.id);
      if (failed) return failed;
    } else if (effect.type === 'openExample') {
      const failed = handlers.openExample(effect.id);
      if (failed) return failed;
    } else if (effect.type === 'undo') {
      const failed = handlers.undo();
      if (failed) return failed;
    } else if (effect.type === 'redo') {
      const failed = handlers.redo();
      if (failed) return failed;
    } else if (effect.type === 'setBed') handlers.setBed(effect.bed);
    else if (effect.type === 'regionSample') {
      const failed = await handlers.regionSample(effect.id, effect.sample);
      if (failed) return failed;
    } else {
      const unreachable: never = effect;
      return `The canvas cannot apply ${unreachable}.`;
    }
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
      const text = planned.reread ? `${planned.text}\n\n${renderScene(ref.current.snapshot())}` : planned.text;
      return { ok: true, text };
    }, setStatus);
    return () => deck.close();
  }, []);

  return status;
}
