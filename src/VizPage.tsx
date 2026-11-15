import { useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import type { Engine } from './engine/engine';
import { instrumentById } from './engine/instruments';
import { blockColor } from './settings';
import { VizEar } from './viz/features';
import { MODES, type ModeEnv, type PieceSnapshot } from './viz/modes';

// The viz stage: what the piece looks like while it plays. It reads the same
// side-taps the scope uses — a waveform and an FFT of everything heard — and
// the scheduler's public structure, and hands them to one of six drawing
// modes on a single full-screen canvas. Drawing never touches audio; like the
// pulse layer, it only shows what the clock already scheduled.

interface Props {
  engine: Engine;
  bpm: number;
  playing: boolean;
}

/** The piece's live structure as plain data, rebuilt each frame for the galaxy. */
function snapshotPiece(engine: Engine): PieceSnapshot {
  const scheduler = engine.scheduler;
  const blocks = scheduler.allBlocks();
  const index = new Map(blocks.map((block, i) => [block.id, i]));
  const beat = engine.playing ? engine.clock.beatAt(engine.heardNow()) : 0;
  const now = engine.heardNow();

  const comets: PieceSnapshot['comets'] = [];
  for (const pulse of scheduler.pulses) {
    if (beat < pulse.depart || beat > pulse.arrive) continue;
    const link = scheduler.link(pulse.link);
    if (!link) continue;
    const from = index.get(link.source);
    const to = index.get(link.target);
    if (from === undefined || to === undefined) continue;
    comets.push({ from, to, progress: (beat - pulse.depart) / Math.max(1e-6, pulse.arrive - pulse.depart) });
  }

  const blooms: PieceSnapshot['blooms'] = [];
  for (const flash of engine.flashes) {
    const age = now - flash.time;
    if (age < 0 || age > 0.5) continue;
    const block = scheduler.block(flash.block);
    if (!block) continue;
    const at = index.get(flash.block);
    if (at === undefined) continue;
    blooms.push({
      at,
      strength: Math.min(1, Math.max(0.2, flash.strength)),
      color: blockColor(flash.kind ?? block.kind, flash.degree ?? block.degree, block.scale),
      age,
    });
  }

  return {
    playing: engine.playing,
    beat,
    blocks: blocks.map((block) => ({
      color: blockColor(block.kind, block.degree, block.scale),
      isStart: block.kind === 'start',
      isDrum: block.kind !== 'start' && instrumentById(block.kind)?.pitched === false,
    })),
    links: scheduler
      .allLinks()
      .map((link) => ({ from: index.get(link.source), to: index.get(link.target) }))
      .filter((l): l is { from: number; to: number } => l.from !== undefined && l.to !== undefined),
    comets,
    blooms,
  };
}

export function VizPage({ engine, bpm, playing }: Props) {
  const [modeId, setModeId] = useState(MODES[0].id);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The loop reads the stage through refs, so switching modes (or a tempo
  // change) never tears the animation down — trails keep running across the cut.
  const selection = useRef({ id: MODES[0].id, bpm });
  selection.current = { id: modeId, bpm };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom has no canvas: nothing to draw on, nothing to do.
    const ear = new VizEar(Tone.getContext().sampleRate);
    let raf = 0;
    let last = performance.now() / 1000;
    const start = last;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const now = performance.now() / 1000;
      const dt = Math.min(0.1, Math.max(0, now - last));
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const mode = MODES.find((m) => m.id === selection.current.id) ?? MODES[0];
      // A trails stage keeps its last frame under a translucent veil; a clean
      // one is wiped. Switching stages therefore smears out of the old one.
      if (mode.trails > 0) {
        ctx.fillStyle = `rgb(0 0 0 / ${mode.trails})`;
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
      const frame = ear.update(engine.sample('wave'), engine.sample('bands'), dt);
      const env: ModeEnv = { ctx, w, h, dt, t: now - start, bpm: selection.current.bpm, frame, piece: null };
      if (mode.wantsPiece) env.piece = snapshotPiece(engine);
      try {
        mode.draw(env);
      } catch (err) {
        // One bad frame must not kill the show.
        console.warn('Viz frame failed', err);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // 1–6 pick a stage directly; arrows step through them. The app's own key
  // handler may have already used the key (performance keys, shortcuts) —
  // its preventDefault is respected here by this check.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return;
      const digit = Number(e.key);
      if (digit >= 1 && digit <= MODES.length) {
        setModeId(MODES[digit - 1].id);
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const at = MODES.findIndex((m) => m.id === selection.current.id);
        const next = (at + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length;
        setModeId(MODES[next].id);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const active = MODES.find((m) => m.id === modeId) ?? MODES[0];

  return (
    <div className="page is-viz">
      <canvas ref={canvasRef} className="viz-stage" />
      <div className="viz-status">
        <span className={`viz-live${playing ? ' is-on' : ''}`} aria-hidden="true" />
        <span>{playing ? 'listening' : 'idle'}</span>
        <span className="viz-status-sep">·</span>
        <span>{active.blurb}</span>
      </div>
      <div className="viz-chrome">
        <div className="viz-chips" role="group" aria-label="Visualization stages">
          {MODES.map((mode, i) => (
            <button
              key={mode.id}
              className={`viz-chip${mode.id === modeId ? ' is-active' : ''}`}
              onClick={() => setModeId(mode.id)}
              title={mode.blurb}
              aria-pressed={mode.id === modeId}
            >
              <span className="viz-chip-key">{i + 1}</span>
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
