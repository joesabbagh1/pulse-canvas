import { useStoreApi } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import type { Engine } from '../engine/engine';
import { BLOCK_R, PX_PER_BEAT, inPort, slicePath, spanOf } from '../engine/geometry';
import { blockColor } from '../settings';

const TAIL_PX = 34;
const FLASH_SECONDS = 0.45;

function bumpBlock(id: string) {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"] .block-core`);
  el?.animate(
    [
      { transform: 'scale(1.2)', filter: 'brightness(1.8)' },
      { transform: 'scale(1)', filter: 'brightness(1)' },
    ],
    { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1)' },
  );
}

// Pulses are drawn on a canvas over the graph, every animation frame, at the
// position implied by the audio clock. Drawing never drives timing; it only
// shows where the scheduler says each pulse is.
export function PulseLayer({ engine }: { engine: Engine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const store = useStoreApi();

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!engine.playing) return;

      const [tx, ty, zoom] = store.getState().transform;
      const now = engine.heardNow();
      const beat = engine.clock.beatAt(now);
      const sx = (x: number) => x * zoom + tx;
      const sy = (y: number) => y * zoom + ty;
      const dot = (hx: number, hy: number, tail?: { x: number; y: number }[]) => {
        if (tail && tail.length > 1) {
          const grad = ctx.createLinearGradient(tail[0].x, tail[0].y, hx, hy);
          grad.addColorStop(0, 'rgba(255, 209, 102, 0)');
          grad.addColorStop(1, 'rgba(255, 209, 102, 0.85)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = 3 * zoom;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          for (const point of tail) ctx.lineTo(point.x, point.y);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255, 209, 102, 0.22)';
        ctx.beginPath();
        ctx.arc(hx, hy, 9 * zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff6dc';
        ctx.beginPath();
        ctx.arc(hx, hy, 3.6 * zoom, 0, Math.PI * 2);
        ctx.fill();
      };

      ctx.lineCap = 'round';
      for (const p of engine.scheduler.pulses) {
        if (beat < p.depart || beat > p.arrive) continue;
        const link = engine.scheduler.link(p.link);
        if (!link) continue;
        // Hidden while under either block, so pulses seem to leave and enter them.
        const d = ((beat - p.depart) / (p.arrive - p.depart)) * link.len;
        if (d < link.gapStart || d > link.len - link.gapEnd) continue;

        // The tail follows the path, round any bend the pulse just passed.
        const tail = slicePath(link, d - Math.min(TAIL_PX, d - link.gapStart), d);
        dot(sx(tail[tail.length - 1].x), sy(tail[tail.length - 1].y), tail.map((point) => ({ x: sx(point.x), y: sy(point.y) })));
      }

      // A pulse crossing a pattern block: left edge to right edge, for the box's length.
      for (const run of engine.scheduler.runs) {
        if (beat < run.start || beat >= run.end) continue;
        const block = engine.scheduler.block(run.block);
        const span = block && spanOf(block);
        if (!block || !span) continue;
        const t = (beat - run.start) / (run.end - run.start);
        const x = inPort(block, span).x + t * span * PX_PER_BEAT;
        dot(sx(x), sy(block.y));
      }

      for (const f of engine.flashes) {
        const age = now - f.time;
        if (age < 0 || age > FLASH_SECONDS) continue;
        if (!f.shown) {
          f.shown = true;
          if (!f.at) bumpBlock(f.block);
        }
        const block = engine.scheduler.block(f.block);
        if (!block) continue;
        const t = age / FLASH_SECONDS;
        const x = f.at?.x ?? block.x;
        const y = f.at?.y ?? block.y;
        ctx.globalAlpha = (1 - t) * 0.8 * (0.3 + 0.7 * f.strength);
        ctx.strokeStyle = blockColor(f.kind ?? block.kind, f.degree ?? block.degree, block.scale);
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), (f.at ? 5 + t * 14 : BLOCK_R + 2 + t * 22) * zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, store]);

  return <canvas ref={canvasRef} className="pulse-layer" />;
}
