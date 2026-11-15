// The six stages the viz page can project. Each is a self-contained drawing
// routine over one canvas: it gets the analysed frame (see features.ts), the
// clock, and — if it asks for it — the piece's live structure as plain data,
// so the drawing code never touches the engine directly. Everything renders
// on black; `trails` says how much of the last frame survives into this one
// (0 clears fully, higher numbers smear motion like phosphor or long exposure).

import type { VizFrame } from './features';

const TAU = Math.PI * 2;
const GOLDEN = 2.39996;

export interface PieceSnapshot {
  playing: boolean;
  /** The clock's beat right now, for the centre ring. */
  beat: number;
  blocks: { color: string; isStart: boolean; isDrum: boolean }[];
  /** Connected blocks, as indices into `blocks`. */
  links: { from: number; to: number }[];
  /** Pulses in flight, as a position along a link. */
  comets: { from: number; to: number; progress: number }[];
  /** Fresh note hits, blooming where they played. */
  blooms: { at: number; strength: number; color: string; age: number }[];
}

export interface ModeEnv {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** Seconds since the stage opened. */
  t: number;
  bpm: number;
  frame: VizFrame;
  piece: PieceSnapshot | null;
}

export interface VizMode {
  id: string;
  label: string;
  /** One line under the chip, saying what the stage does. */
  blurb: string;
  /** Alpha of the black veil drawn over the last frame; 0 clears it instead. */
  trails: number;
  /** Reads `env.piece`; the page then pays to build it every frame. */
  wantsPiece?: boolean;
  draw(env: ModeEnv): void;
}

const hsl = (h: number, s: number, l: number, a = 1) =>
  `hsl(${((h % 360) + 360) % 360} ${s}% ${l}% / ${a})`;

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** One point along the quadratic arc a link is drawn as, u in 0..1. */
function arcPoint(ax: number, ay: number, bx: number, by: number, bow: number, u: number) {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx - (dy / len) * len * bow;
  const cy = my + (dx / len) * len * bow;
  const v = 1 - u;
  return {
    x: v * v * ax + 2 * v * u * cx + u * u * bx,
    y: v * v * ay + 2 * v * u * cy + u * u * by,
  };
}

/* ---------- Mandala: the spectrum folded into a mirrored rosette ---------- */

function mandala(): VizMode {
  let rot = 0;
  const SPOKES = 96;
  const SYMMETRY = 7;
  const values = new Float32Array(SPOKES);
  const sampleAt = (frame: VizFrame, i: number) => {
    const bands = frame.bands;
    if (!bands.length) return 0.06 + 0.05 * Math.sin(i * 0.35);
    // Log-ish walk down the bins so bass doesn't hog the whole rosette.
    const bin = Math.floor((i / SPOKES) ** 1.6 * bands.length * 0.72);
    return Math.sqrt(bands[bin]);
  };
  return {
    id: 'mandala',
    label: 'Mandala',
    blurb: 'The spectrum folded seven ways, turning with the beat.',
    trails: 0.3,
    draw({ ctx, w, h, dt, t, bpm, frame }) {
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.16;
      const reach = Math.min(w, h) * 0.37;
      rot += dt * (bpm / 60) * 0.45 * (0.25 + frame.rms * 1.3 + frame.onset * 0.6);
      for (let i = 0; i < SPOKES; i++) values[i] = lerp(values[i], sampleAt(frame, i), Math.min(1, dt * 14));

      const hue0 = 190 + frame.centroid * 150 + t * 9;
      for (let s = 0; s < SYMMETRY; s++) {
        const sector = (TAU / SYMMETRY) * s;
        for (const mirror of [1, -1]) {
          ctx.beginPath();
          for (let i = 0; i <= SPOKES; i++) {
            const j = i % SPOKES;
            const ang = rot + sector + (mirror === 1 ? (i / SPOKES) * (TAU / SYMMETRY) : (1 - i / SPOKES) * (TAU / SYMMETRY));
            const r = base + values[j] * reach;
            const x = cx + Math.cos(ang) * r;
            const y = cy + Math.sin(ang) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          const bright = (values[0] + values[24] + values[48] + values[72]) / 4;
          ctx.strokeStyle = hsl(hue0 + s * 9, 85, 45 + bright * 30, 0.25 + bright * 0.65);
          ctx.lineWidth = 1.4 + bright * 2.4;
          ctx.stroke();
        }
      }

      // The heart: a disc that breathes with loudness, a ring that flies out on hits.
      ctx.fillStyle = hsl(hue0, 80, 70, 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, 5 + frame.rms * 30, 0, TAU);
      ctx.fill();
      ctx.fillStyle = hsl(hue0 + 40, 90, 88, 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 + frame.rms * 12, 0, TAU);
      ctx.fill();
      if (frame.onset > 0.03) {
        ctx.strokeStyle = hsl(hue0 + 120, 90, 65, frame.onset * 0.55);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, base + (1 - frame.onset) * reach * 0.9, 0, TAU);
        ctx.stroke();
      }
    },
  };
}

/* ---------- Creature: a blob that listens, looks and sings ---------- */

function creature(): VizMode {
  const POINTS = 72;
  const contour = new Float32Array(POINTS);
  let silence = 0;
  return {
    id: 'creature',
    label: 'Creature',
    blurb: 'A blob wearing the waveform, watching the loudest note.',
    trails: 0,
    draw({ ctx, w, h, dt, t, frame }) {
      const cx = w / 2;
      const cy = h / 2;
      silence = frame.silent ? silence + dt : 0;
      const awake = Math.min(1, silence / 1.2);
      const R = Math.min(w, h) * 0.19 * (1 + frame.rms * 0.22 - awake * 0.14);
      const hue = 185 + frame.centroid * 150 + (frame.pitchClass ?? 0) * 3;
      for (let i = 0; i < POINTS; i++) {
        const wave = frame.wave.length ? frame.wave[Math.floor((i / POINTS) * frame.wave.length)] : 0;
        const band = frame.bands.length ? Math.sqrt(frame.bands[Math.floor((i / POINTS) ** 1.4 * frame.bands.length * 0.6)]) : 0;
        const wobble = 0.035 * Math.sin(t * 1.9 + i * 0.9) + 0.02 * Math.sin(t * 3.1 - i * 1.7);
        const target = 1 + wave * (0.16 + frame.rms * 0.3) + band * 0.22 + wobble;
        contour[i] = lerp(contour[i], target, Math.min(1, dt * 12));
      }

      // Body: a closed curve through the contour, filled with a soft radial light.
      const skin = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R * 1.5);
      skin.addColorStop(0, hsl(hue, 75, 64, 0.98));
      skin.addColorStop(1, hsl(hue + 26, 80, 38, 0.96));
      ctx.beginPath();
      for (let i = 0; i <= POINTS; i++) {
        const j = i % POINTS;
        const ang = -Math.PI / 2 + (i / POINTS) * TAU;
        const x = cx + Math.cos(ang) * R * contour[j];
        const y = cy + Math.sin(ang) * R * contour[j];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = skin;
      ctx.fill();

      if (frame.onset > 0.04) {
        ctx.strokeStyle = hsl(hue + 60, 90, 68, frame.onset * 0.5);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.12 + (1 - frame.onset) * 0.5), 0, TAU);
        ctx.stroke();
      }

      // Eyes: pupils wander toward the loudest pitch class and dilate on hits.
      const pcAngle = ((frame.pitchClass ?? 7) / 12) * TAU;
      const gazeX = (Math.cos(pcAngle) * 0.5 + Math.sin(t * 0.7) * 0.2) * R * 0.07;
      const gazeY = (Math.sin(pcAngle) * 0.5 + Math.cos(t * 0.53) * 0.2) * R * 0.07;
      const eyeR = R * 0.17;
      const blink = silence > 0.4 ? Math.max(0, Math.sin(t * 2.1)) > 0.86 ? 0.08 : 1 - awake * 0.45 : 1;
      for (const side of [-1, 1]) {
        const ex = cx + side * R * 0.38;
        const ey = cy - R * 0.24;
        ctx.fillStyle = 'rgb(248 248 244)';
        ctx.beginPath();
        ctx.ellipse(ex, ey, eyeR, eyeR * blink, 0, 0, TAU);
        ctx.fill();
        if (blink > 0.15) {
          ctx.fillStyle = 'rgb(16 14 20)';
          ctx.beginPath();
          ctx.arc(ex + gazeX, ey + gazeY, eyeR * (0.42 + frame.onset * 0.22) * blink, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgb(255 255 255 / 0.9)';
          ctx.beginPath();
          ctx.arc(ex + gazeX - eyeR * 0.15, ey + gazeY - eyeR * 0.18, eyeR * 0.1, 0, TAU);
          ctx.fill();
        }
      }

      // Mouth: opens with the bass, rests as a small smile.
      const open = frame.bass * (0.5 + frame.onset * 0.8);
      const mx = cx;
      const my = cy + R * 0.44;
      if (open > 0.03) {
        ctx.fillStyle = hsl(hue, 65, 14, 0.95);
        ctx.beginPath();
        ctx.ellipse(mx, my, R * 0.2, R * 0.05 + open * R * 0.3, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = hsl(hue + 340, 80, 55, 0.8);
        ctx.beginPath();
        ctx.ellipse(mx, my + open * R * 0.18, R * 0.07, open * R * 0.1, 0, 0, TAU);
        ctx.fill();
      } else {
        ctx.strokeStyle = hsl(hue, 60, 16, 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mx, my - R * 0.08, R * 0.16, 0.35, Math.PI - 0.35);
        ctx.stroke();
      }

      // Antennae with tips that flutter on the treble.
      for (const side of [-1, 1]) {
        const baseX = cx + side * R * 0.42;
        const baseY = cy - R * 0.86;
        const sway = Math.sin(t * 3.2 + side) * R * 0.1 + frame.treble * R * 0.28 * Math.sin(t * 22 + side * 2);
        const tipX = baseX + sway;
        const tipY = baseY - R * (0.3 + frame.treble * 0.2);
        ctx.strokeStyle = hsl(hue + 30, 60, 30, 0.85);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.quadraticCurveTo(baseX + sway * 0.4, baseY - R * 0.18, tipX, tipY);
        ctx.stroke();
        ctx.fillStyle = hsl(hue + 80, 90, 62, 0.9);
        ctx.beginPath();
        ctx.arc(tipX, tipY, 2.4 + frame.treble * 3.4, 0, TAU);
        ctx.fill();
      }
    },
  };
}

/* ---------- Tunnel: snapshots of the spectrum receding past you ---------- */

function tunnel(): VizMode {
  const SPOKES = 48;
  const LIFE = 1;
  interface Ring {
    prog: number;
    bands: Float32Array;
    hue: number;
  }
  const rings: Ring[] = [];
  const streaks: { ang: number; phase: number }[] = Array.from({ length: 40 }, (_, i) => ({
    ang: (i / 40) * TAU + ((i * 7919) % 100) / 100,
    phase: (i * 3571) % 100 / 100,
  }));
  let acc = 0;
  return {
    id: 'tunnel',
    label: 'Tunnel',
    blurb: 'Every moment of sound becomes a ring you fly through.',
    trails: 0.26,
    draw({ ctx, w, h, dt, frame }) {
      const cx = w / 2;
      const cy = h / 2;
      const rMax = Math.hypot(w, h) * 0.52;

      acc += dt;
      while (acc > 0.055) {
        acc -= 0.055;
        const bands = new Float32Array(SPOKES);
        for (let i = 0; i < SPOKES; i++) {
          const bin = frame.bands.length ? Math.floor((i / SPOKES) ** 1.5 * frame.bands.length * 0.7) : 0;
          bands[i] = frame.bands.length ? Math.sqrt(frame.bands[bin]) : 0.04 + 0.03 * Math.sin(i + rings.length * 0.6);
        }
        rings.push({ prog: 0, bands, hue: 190 + frame.centroid * 150 + rings.length * 2 });
        if (rings.length > 110) rings.shift();
      }

      // Warp streaks: the sense of moving forward, faster the louder it gets.
      const speed = 0.12 + frame.rms * 0.5 + frame.onset * 0.5;
      ctx.strokeStyle = 'rgb(210 225 255 / 0.14)';
      ctx.lineWidth = 1;
      for (const s of streaks) {
        s.phase = (s.phase + dt * speed * 0.6) % 1;
        const r1 = 20 + s.phase * rMax * 0.5;
        const r2 = r1 + 14 + speed * 90 * (s.phase + 0.2);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(s.ang) * r1, cy + Math.sin(s.ang) * r1);
        ctx.lineTo(cx + Math.cos(s.ang) * r2, cy + Math.sin(s.ang) * r2);
        ctx.stroke();
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.prog += dt * (0.14 + frame.rms * 0.42 + frame.onset * 0.18);
        if (ring.prog >= LIFE) {
          rings.splice(i, 1);
          continue;
        }
        const p = ring.prog / LIFE;
        const r = lerp(8, rMax, p ** 1.6);
        ctx.beginPath();
        for (let k = 0; k <= SPOKES; k++) {
          const band = ring.bands[k % SPOKES];
          const ang = (k / SPOKES) * TAU;
          const rr = r * (0.66 + band * 0.55);
          const x = cx + Math.cos(ang) * rr;
          const y = cy + Math.sin(ang) * rr;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = hsl(ring.hue, 85, 52 + p * 24, (1 - p) ** 1.4 * 0.85);
        ctx.lineWidth = 1 + p * 5;
        ctx.stroke();
      }

      ctx.fillStyle = 'rgb(255 255 255 / 0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5 + frame.rms * 9, 0, TAU);
      ctx.fill();
    },
  };
}

/* ---------- Cymatics: sand on a vibrating plate, the FFT choosing the mode ---------- */

function cymatics(): VizMode {
  const COUNT = 900;
  const positions = new Float32Array(COUNT * 2);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 2] = Math.random() * 2 - 1;
    positions[i * 2 + 1] = Math.random() * 2 - 1;
  }
  const accents = new Uint8Array(COUNT);
  for (let i = 0; i < COUNT; i++) accents[i] = Math.random() < 0.09 ? 1 : 0;
  let m = 3;
  let n = 2;
  let targetM = 3;
  let targetN = 2;
  let lastOnsets = 0;
  const chladni = (x: number, y: number) => {
    const px = Math.PI * x;
    const py = Math.PI * y;
    return Math.cos(n * px) * Math.cos(m * py) - Math.cos(m * px) * Math.cos(n * py);
  };
  return {
    id: 'cymatics',
    label: 'Cymatics',
    blurb: 'Sand gathering into nodal lines; every hit retunes the plate.',
    trails: 0,
    draw({ ctx, w, h, dt, frame }) {
      // A new pattern only when the music says so: each onset reshapes the plate.
      if (frame.onsetCount !== lastOnsets) {
        lastOnsets = frame.onsetCount;
        targetN = 1 + Math.round(frame.centroid * 5);
        targetM = Math.min(9, targetN + 1 + Math.round(frame.bass * 4));
        if (targetM === targetN) targetM += 1;
      }
      m = lerp(m, targetM, Math.min(1, dt * 2.2));
      n = lerp(n, targetN, Math.min(1, dt * 2.2));

      const side = Math.min(w, h) * 0.62;
      const half = side / 2;
      const px = w / 2 - half;
      const py = h / 2 - half;
      ctx.fillStyle = 'rgb(7 8 13)';
      ctx.fillRect(px, py, side, side);
      ctx.strokeStyle = 'rgb(255 255 255 / 0.09)';
      ctx.strokeRect(px + 0.5, py + 0.5, side - 1, side - 1);

      const e = 0.012;
      const jitter = 0.008 + frame.onset * 0.09 + frame.rms * 0.012;
      ctx.fillStyle = 'rgb(214 200 158 / 0.8)';
      for (let i = 0; i < COUNT; i++) {
        let x = positions[i * 2];
        let y = positions[i * 2 + 1];
        const f = chladni(x, y);
        const gx = (chladni(x + e, y) - chladni(x - e, y)) / (2 * e);
        const gy = (chladni(x, y + e) - chladni(x, y - e)) / (2 * e);
        // Sand crawls down the slope of |f|²: steps against f times grad(f).
        x -= f * gx * dt * 0.85;
        y -= f * gy * dt * 0.85;
        x += (Math.random() - 0.5) * jitter;
        y += (Math.random() - 0.5) * jitter;
        positions[i * 2] = x = Math.min(0.97, Math.max(-0.97, x));
        positions[i * 2 + 1] = y = Math.min(0.97, Math.max(-0.97, y));
        const sx = px + (x * 0.5 + 0.5) * side;
        const sy = py + (y * 0.5 + 0.5) * side;
        if (accents[i]) ctx.fillStyle = hsl(190 + frame.centroid * 130, 90, 60 + frame.onset * 25, 0.95);
        ctx.fillRect(sx, sy, 1.7, 1.7);
        if (accents[i]) ctx.fillStyle = 'rgb(214 200 158 / 0.8)';
      }

      // The mode numbers, quietly, like a lab notebook.
      ctx.fillStyle = 'rgb(214 200 158 / 0.5)';
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(`CHLADNI  m=${targetM}  n=${targetN}`, px + 10, py + 18);
    },
  };
}

/* ---------- Galaxy: the piece itself, as stars, links and comet pulses ---------- */

function galaxy(): VizMode {
  let rot = 0;
  return {
    id: 'galaxy',
    label: 'Galaxy',
    blurb: 'Your blocks as stars, pulses as comets flying the links.',
    trails: 0.42,
    wantsPiece: true,
    draw({ ctx, w, h, dt, bpm, frame, piece }) {
      const cx = w / 2;
      const cy = h / 2;
      const spread = Math.min(w, h) * 0.4;
      rot += dt * (bpm / 60) * 0.1;
      if (!piece) return;

      const place = (i: number) => {
        const arm = i % 2;
        const ang = i * GOLDEN + arm * 0.9 + rot;
        const r = 34 + Math.sqrt((i + 1) / Math.max(1, piece.blocks.length)) * spread;
        return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * 0.78 };
      };
      const at = piece.blocks.map((_, i) => place(i));

      // Links: faint arcs between connected stars.
      ctx.strokeStyle = 'rgb(220 228 255 / 0.1)';
      ctx.lineWidth = 1;
      for (const link of piece.links) {
        const a = at[link.from];
        const b = at[link.to];
        if (!a || !b) continue;
        ctx.beginPath();
        const steps = 16;
        for (let s = 0; s <= steps; s++) {
          const p = arcPoint(a.x, a.y, b.x, b.y, 0.12, s / steps);
          if (s === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      // Comets: pulses actually in flight, glowing along their link's arc.
      for (const comet of piece.comets) {
        const a = at[comet.from];
        const b = at[comet.to];
        if (!a || !b) continue;
        const head = arcPoint(a.x, a.y, b.x, b.y, 0.12, comet.progress);
        const tail = arcPoint(a.x, a.y, b.x, b.y, 0.12, Math.max(0, comet.progress - 0.09));
        const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
        grad.addColorStop(0, 'rgb(255 255 255 / 0)');
        grad.addColorStop(1, 'rgb(255 250 230 / 0.9)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        ctx.fillStyle = 'rgb(255 252 240 / 0.95)';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2.6, 0, TAU);
        ctx.fill();
      }

      // Stars: one per block, sized by family, coloured as on the canvas.
      for (let i = 0; i < piece.blocks.length; i++) {
        const block = piece.blocks[i];
        const { x, y } = at[i];
        const r = block.isStart ? 7.5 : block.isDrum ? 4 : 6;
        const bright = 0.55 + frame.rms * 0.45;
        ctx.fillStyle = block.color;
        ctx.globalAlpha = bright;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = bright * 0.22;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.4 + frame.onset * 6, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Blooms: rings where notes actually sounded this instant.
      for (const bloom of piece.blooms) {
        const pos = at[bloom.at];
        if (!pos) continue;
        const u = Math.min(1, bloom.age / 0.5);
        ctx.strokeStyle = bloom.color;
        ctx.globalAlpha = (1 - u) * 0.75 * bloom.strength;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 7 + u * 46, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // The clock: a ring at the core fills once per beat, plus a loudness heart.
      const phase = piece.playing ? ((piece.beat % 1) + 1) % 1 : 0;
      ctx.strokeStyle = 'rgb(255 255 255 / 0.28)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 21, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgb(255 244 214 / 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, 21, -Math.PI / 2, -Math.PI / 2 + phase * TAU);
      ctx.stroke();
      ctx.fillStyle = hsl(190 + frame.centroid * 150, 80, 68, 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, 5 + frame.rms * 12, 0, TAU);
      ctx.fill();
    },
  };
}

/* ---------- Phosphor: the waveform as an XY oscilloscope trace ---------- */

function phosphor(): VizMode {
  let lag = 160;
  let flicker = 0;
  let peak = 0;
  return {
    id: 'phosphor',
    label: 'Phosphor',
    blurb: 'The raw wave bent into a Lissajous figure on a green screen.',
    trails: 0.14,
    draw({ ctx, w, h, dt, t, bpm, frame }) {
      flicker = flicker * Math.exp(-dt / 0.08) + (Math.random() < 0.06 ? 0.25 : 0);
      const cx = w / 2;
      const cy = h / 2;
      const A = Math.min(w, h) * 0.42;
      // Auto-gain, like a scope: a full mix never reaches ±1, so the beam is
      // scaled against a smoothed peak — fast to rise, slow to fall.
      peak = peak > frame.peak ? peak * Math.exp(-dt / 1.4) : Math.max(peak, frame.peak);
      const gain = A / Math.max(0.14, peak);
      const dim = 0.07 + flicker * 0.05;

      ctx.strokeStyle = `rgb(80 255 160 / ${dim})`;
      ctx.lineWidth = 1;
      for (let gx = 1; gx < 8; gx++) {
        const x = Math.round((w / 8) * gx) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let gy = 1; gy < 6; gy++) {
        const y = Math.round((h / 6) * gy) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgb(80 255 160 / ${dim * 1.8})`;
      ctx.strokeRect(12.5, 12.5, w - 25, h - 25);

      const targetLag = 96 + frame.centroid * 224;
      lag = lerp(lag, targetLag, Math.min(1, dt * 2.5));
      const useLag = Math.max(2, Math.round(lag));
      const wave = frame.wave;
      if (wave.length > useLag * 2 && frame.peak > 0.004) {
        const trace = () => {
          ctx.beginPath();
          for (let i = 0; i + useLag < wave.length; i += 2) {
            const x = cx + wave[i] * gain;
            const y = cy + wave[i + useLag] * gain * 0.92;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        };
        trace();
        ctx.strokeStyle = 'rgb(70 255 150 / 0.22)';
        ctx.lineWidth = 4;
        ctx.stroke();
        trace();
        ctx.strokeStyle = `rgb(150 255 190 / ${0.85 + flicker * 0.15})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        // Nothing playing: the beam sits at centre, wandering like an idle CRT.
        const jx = cx + Math.sin(t * 3.7) * 1.5 + (Math.random() - 0.5) * 1.2;
        const jy = cy + Math.cos(t * 2.9) * 1.5 + (Math.random() - 0.5) * 1.2;
        ctx.fillStyle = 'rgb(160 255 190 / 0.9)';
        ctx.beginPath();
        ctx.arc(jx, jy, 2.2, 0, TAU);
        ctx.fill();
      }

      ctx.fillStyle = 'rgb(110 255 170 / 0.55)';
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`XY · ${bpm} BPM`, w - 24, h - 24);
      ctx.textAlign = 'left';
    },
  };
}

export const MODES: VizMode[] = [mandala(), creature(), tunnel(), cymatics(), galaxy(), phosphor()];
