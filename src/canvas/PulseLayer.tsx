import { useStoreApi } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import type { Engine } from '../engine/engine';
import { compilePattern } from '../engine/pattern';
import { setLivePasses } from './livePass';
import { playhead } from './playhead';
import { BLOCK_R, PX_PER_BEAT, inPort, slicePath, spanOf } from '../engine/geometry';
import { blockColor } from '../settings';

const TAIL_PX = 34;
const FLASH_SECONDS = 0.45;

/** The drawn note closest to this fraction of the pass, in canvas pixels. */
function noteAt(blockId: string, fraction: number, centerOf: (el: Element) => { x: number; y: number }) {
  const node = document.querySelector(`.react-flow__node[data-id="${CSS.escape(blockId)}"]`);
  let best: Element | null = null;
  let bestDist = Infinity;
  for (const el of node?.querySelectorAll('.box-strip [data-at]') ?? []) {
    const at = Number((el as SVGCircleElement).dataset.at);
    if (!Number.isFinite(at)) continue;
    const dist = Math.abs(at - fraction);
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  return best ? centerOf(best) : null;
}

function lightPattern(node: Element, source: string, t: number, shape: { fast: number; rev: boolean }, cycle: number) {
  const line = node.querySelector('.box-line');
  const input = line?.querySelector('input');
  if (!line || !(input instanceof HTMLInputElement)) return;
  const clear = () => line.classList.remove('is-live');
  if (document.activeElement === input) {
    clear();
    return;
  }
  const notes = compilePattern(source).notes(cycle, 0, 1, shape);
  let on: { at: number; span: number; from?: number; to?: number } | null = null;
  for (const note of notes) if (note.at <= t + 1e-6) on = note;
  if (!on || on.from == null || on.to == null || t > on.at + Math.max(on.span, 0) + 1e-4) {
    clear();
    return;
  }
  const before = line.querySelector('.box-before');
  const hit = line.querySelector('.box-hit');
  const after = line.querySelector('.box-after');
  if (!before || !hit || !after) return;
  before.textContent = source.slice(0, on.from);
  hit.textContent = source.slice(on.from, on.to);
  after.textContent = source.slice(on.to);
  line.classList.add('is-live');
  const mirror = line.querySelector('.box-mirror');
  if (mirror instanceof HTMLElement) mirror.scrollLeft = input.scrollLeft;
}

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
      if (!engine.playing) {
        setLivePasses([]);
        return;
      }

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

      // A pulse crossing a pattern block jumps onto each drawn note, then leaves.
      const canvasBox = canvas.getBoundingClientRect();
      const centerOf = (el: Element) => {
        const box = el.getBoundingClientRect();
        return { x: box.left + box.width / 2 - canvasBox.left, y: box.top + box.height / 2 - canvasBox.top };
      };
      const mix = (a: { x: number; y: number }, b: { x: number; y: number }, u: number) => ({
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
      });
      const lit = new Set<string>();
      const active: { id: string; fast: number; rev: boolean; cycle: number; shift: number; start: number }[] = [];
      for (const run of engine.scheduler.runs) {
        if (beat < run.start || beat >= run.end) continue;
        const block = engine.scheduler.block(run.block);
        const span = block && spanOf(block);
        if (!block || !span) continue;
        const t = (beat - run.start) / (run.end - run.start);
        const node = document.querySelector(`.react-flow__node[data-id="${CSS.escape(run.block)}"]`);
        const marks = [...(node?.querySelectorAll('.box-strip [data-at]') ?? [])];
        const inlet = node?.querySelector('.box-in');
        const outlet = node?.querySelector('.box-out');
        if (!node || !marks.length || !inlet || !outlet) {
          const x = inPort(block, span).x + t * span * PX_PER_BEAT;
          dot(sx(x), sy(block.y));
          continue;
        }
        const ordered = marks
          .map((el) => {
            const dot = el as SVGCircleElement;
            return { at: Number(dot.dataset.at), span: Number(dot.dataset.span), ...centerOf(el) };
          })
          .filter((mark) => Number.isFinite(mark.at) && Number.isFinite(mark.span))
          .sort((a, b) => a.at - b.at);
        const place = playhead(t, ordered);
        const gate = { in: centerOf(inlet), out: centerOf(outlet) };
        const at =
          place.kind === 'across'
            ? mix(gate.in, gate.out, place.u)
            : place.kind === 'toward'
              ? mix(gate.in, ordered[place.index], place.u)
              : place.kind === 'on'
                ? ordered[place.index]
                : mix(ordered[place.index], gate.out, place.u);
        dot(at.x, at.y);
        if (block.pattern !== undefined) {
          lightPattern(node, block.pattern, t, { fast: run.fast, rev: run.rev }, run.cycle);
          lit.add(run.block);
          const previous = active.find((pass) => pass.id === run.block);
          if (!previous || run.start >= previous.start) {
            const next = { id: run.block, fast: run.fast, rev: run.rev, cycle: run.cycle, shift: run.shift, start: run.start };
            if (previous) active.splice(active.indexOf(previous), 1, next);
            else active.push(next);
          }
        }
      }
      setLivePasses(active);
      for (const line of document.querySelectorAll('.box-line.is-live')) {
        const id = line.closest('.react-flow__node')?.getAttribute('data-id');
        if (!id || !lit.has(id)) line.classList.remove('is-live');
      }

      for (const node of document.querySelectorAll('.react-flow__node')) {
        const id = node.getAttribute('data-id');
        if (!id) continue;
        const wave = engine.boxWave(id);
        if (!wave) continue;
        let peak = 0;
        for (let i = 0; i < wave.length; i++) peak = Math.max(peak, Math.abs(wave[i]));
        if (peak < 0.02) continue;
        const rect = node.getBoundingClientRect();
        const left = rect.left - canvasBox.left + 10;
        const width = Math.max(8, rect.width - 20);
        const mid = rect.bottom - canvasBox.top - 10;
        ctx.strokeStyle = 'rgba(255, 246, 220, 0.9)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        const step = 2;
        for (let i = 0; i < wave.length; i += step) {
          const x = left + (i / (wave.length - 1)) * width;
          const y = mid - wave[i] * 6;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
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
        // A note's ring lands on the drawn note, the same place the pulse jumps to.
        const span = f.at && spanOf(block);
        const fraction = span ? (f.at!.x - inPort(block, span).x) / (span * PX_PER_BEAT) : null;
        const landed = fraction === null ? null : noteAt(block.id, fraction, centerOf);
        const hx = landed ? landed.x : sx(f.at?.x ?? block.x);
        const hy = landed ? landed.y : sy(f.at?.y ?? block.y);
        ctx.globalAlpha = (1 - t) * 0.8 * (0.3 + 0.7 * f.strength);
        ctx.strokeStyle = blockColor(f.kind ?? block.kind, f.degree ?? block.degree, block.scale);
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath();
        ctx.arc(hx, hy, (f.at ? 5 + t * 14 : BLOCK_R + 2 + t * 22) * zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, store]);

  return <canvas ref={canvasRef} className="pulse-layer" />;
}
