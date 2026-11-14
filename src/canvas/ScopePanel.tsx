import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/engine';
import { token } from '../ui/theme';

type View = 'wave' | 'bands' | 'scroll';

/** The whole mix, as a waveform or as frequency bars. It listens after the limiter. */
export function ScopePanel({ engine }: { engine: Engine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>('wave');
  const viewRef = useRef(view);
  viewRef.current = view;
  const history = useRef<Float32Array[]>([]);

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
      const kind = viewRef.current;
      const data = engine.sample(kind === 'wave' ? 'wave' : 'bands');
      ctx.strokeStyle = token('--ink');
      ctx.fillStyle = token('--ink');
      if (!data) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        return;
      }
      if (kind === 'wave') drawWave(ctx, data, w, h);
      else if (kind === 'bands') drawBands(ctx, data, w, h);
      else {
        const column = new Float32Array(data);
        history.current.push(column);
        if (history.current.length > 96) history.current.shift();
        drawScroll(ctx, history.current, w, h);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <div className="scope-panel nopan">
      <div className="segmented" role="group" aria-label="Mix drawing">
        <button className={view === 'wave' ? 'is-on' : ''} aria-pressed={view === 'wave'} onClick={() => setView('wave')}>
          Wave
        </button>
        <button className={view === 'bands' ? 'is-on' : ''} aria-pressed={view === 'bands'} onClick={() => setView('bands')}>
          Bands
        </button>
        <button className={view === 'scroll' ? 'is-on' : ''} aria-pressed={view === 'scroll'} onClick={() => setView('scroll')}>
          Scroll
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="scope-canvas"
        aria-label={view === 'wave' ? 'Waveform of the mix' : view === 'bands' ? 'Frequency of the mix' : 'Spectrogram of the mix'}
      />
    </div>
  );
}

function drawWave(ctx: CanvasRenderingContext2D, data: Float32Array, w: number, h: number) {
  let start = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1] > 0 && data[i] <= 0) {
      start = i;
      break;
    }
  }
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const n = data.length;
  for (let i = 0; i < n; i++) {
    const v = data[(start + i) % n];
    const x = (i / (n - 1)) * w;
    const y = h / 2 - v * (h * 0.42);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawScroll(ctx: CanvasRenderingContext2D, columns: Float32Array[], w: number, h: number) {
  const rows = 28;
  const colW = w / Math.max(1, columns.length);
  columns.forEach((column, x) => {
    const bins = column.length;
    for (let row = 0; row < rows; row++) {
      const i = Math.min(bins - 1, Math.floor((row / rows) * bins));
      const level = Math.max(0, Math.min(1, (column[i] + 100) / 100));
      ctx.globalAlpha = 0.12 + 0.88 * level;
      ctx.fillRect(x * colW, h - ((row + 1) * h) / rows, Math.ceil(colW), h / rows + 0.5);
    }
  });
  ctx.globalAlpha = 1;
}

function drawBands(ctx: CanvasRenderingContext2D, data: Float32Array, w: number, h: number) {
  const n = data.length;
  const gap = 1;
  const bar = Math.max(1, w / n - gap);
  for (let i = 0; i < n; i++) {
    const level = Math.max(0, Math.min(1, (data[i] + 100) / 100));
    const bh = level * (h - 2);
    ctx.globalAlpha = 0.35 + 0.65 * level;
    ctx.fillRect((i / n) * w, h - bh, bar, bh);
  }
  ctx.globalAlpha = 1;
}
