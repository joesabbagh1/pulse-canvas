import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Timeline, TimelineConnector, TimelineDescription, TimelineItem, TimelineMarker, TimelineTime, TimelineTitle } from '@ui-sdk/react/timeline';
import {
  clipBeats,
  duplicateClip,
  moveClip,
  shapeClip,
  splitClip,
  trimClip,
  wholeClip,
  type Bed,
  type BedClip,
} from './bed';
import type { Engine } from './engine/engine';
import { formatBeats } from './engine/geometry';
import { newId } from './piece';
import { clockTime } from './TopBar';

const BASE_PX = 40;
const LANE_H = 72;

interface Props {
  bed: Bed | null;
  /** Interleaved min/max over the whole file. Null while it is still decoding, or when the file is gone. */
  peaks: Float32Array | null;
  missing: boolean;
  bpm: number;
  snap: boolean;
  playing: boolean;
  engine: Engine;
  onChange: (bed: Bed | null) => void;
  onLoad: (file: File) => void;
}

export function BedLane({ bed, peaks, missing, bpm, snap, playing, engine, onChange, onLoad }: Props) {
  const [open, setOpen] = useState(bed !== null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<Bed | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draft = useRef<Bed | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const secondsPerBeat = 60 / bpm;
  const px = BASE_PX * zoom;
  const shown = drag ?? bed;
  const clip = shown?.clips.find((item) => item.id === selected) ?? null;

  useEffect(() => {
    if (bed) setOpen(true);
  }, [bed]);

  useEffect(() => {
    if (selected && bed && !bed.clips.some((item) => item.id === selected)) setSelected(bed.clips[0]?.id ?? null);
  }, [bed, selected]);

  const endBeat = shown ? Math.max(8, ...shown.clips.map((item) => item.beat + clipBeats(item, secondsPerBeat))) : 8;
  const width = Math.min(16000, Math.max(480, Math.ceil(endBeat * px + 32)));

  useEffect(() => {
    const canvas = canvasRef.current;
    const file = shown;
    if (!canvas || !file) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(LANE_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, LANE_H);
    ctx.fillStyle = '#101413';
    ctx.fillRect(0, 0, width, LANE_H);
    ctx.strokeStyle = '#24302c';
    ctx.fillStyle = '#6d7a74';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.beginPath();
    const step = px >= 36 ? 1 : 4;
    for (let beat = 0; beat * px < width; beat += step) {
      const x = beat * px;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, beat % 4 === 0 ? 14 : 8);
      if (beat % 4 === 0) ctx.fillText(formatBeats(beat, true), x + 3, 12);
    }
    ctx.stroke();
    if (!peaks || !(file.duration > 0)) return;
    const buckets = peaks.length / 2;
    const mid = 18 + (LANE_H - 22) / 2;
    const amp = (LANE_H - 28) / 2;
    for (const item of file.clips) {
      const x0 = item.beat * px;
      const w = Math.max(2, clipBeats(item, secondsPerBeat) * px);
      const from = Math.floor((item.offset / file.duration) * buckets);
      const to = Math.max(from + 1, Math.ceil(((item.offset + item.seconds) / file.duration) * buckets));
      ctx.fillStyle = item.mute ? '#3a4642' : item.id === selected ? '#3ee0c5' : '#1f8f7e';
      ctx.globalAlpha = item.mute ? 0.45 : 0.9;
      for (let i = from; i < to && i < buckets; i++) {
        const t = (i - from) / (to - from);
        const min = peaks[i * 2];
        const max = peaks[i * 2 + 1];
        const barW = Math.max(1, w / (to - from));
        ctx.fillRect(x0 + t * w, mid - max * amp, barW, Math.max(1, (max - min) * amp));
      }
      ctx.globalAlpha = 1;
    }
  }, [shown, peaks, px, secondsPerBeat, width, selected]);

  useEffect(() => {
    if (!playing) {
      if (headRef.current) headRef.current.style.transform = 'translateX(0px)';
      return;
    }
    let frame = 0;
    const tick = () => {
      if (headRef.current) headRef.current.style.transform = `translateX(${engine.currentBeat() * px}px)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, engine, px]);

  function begin(event: ReactPointerEvent, item: BedClip, edge: 'move' | 'start' | 'end') {
    if (!bed) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(item.id);
    const x0 = event.clientX;
    const move = (ev: PointerEvent) => {
      const deltaBeats = (ev.clientX - x0) / px;
      const next =
        edge === 'move'
          ? moveClip(item, item.beat + deltaBeats, snap)
          : trimClip(item, edge, deltaBeats, secondsPerBeat, bed.duration, snap);
      const updated = { ...bed, clips: bed.clips.map((current) => (current.id === item.id ? next : current)) };
      draft.current = updated;
      setDrag(updated);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (draft.current) onChange(draft.current);
      draft.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function commit(next: Bed | null) {
    setDrag(null);
    onChange(next);
  }

  function split() {
    if (!bed || !clip) return;
    const into = playing ? (engine.currentBeat() - clip.beat) * secondsPerBeat : clip.seconds / 2;
    const parts = splitClip(clip, into, secondsPerBeat, newId('cut')) ?? splitClip(clip, clip.seconds / 2, secondsPerBeat, newId('cut'));
    if (!parts) return;
    commit({ ...bed, clips: bed.clips.flatMap((item) => (item.id === clip.id ? parts : [item])) });
    setSelected(parts[1].id);
  }

  const ordered = shown ? [...shown.clips].sort((a, b) => a.beat - b.beat || a.offset - b.offset) : [];

  return (
    <section
      className={`bed${open ? ' is-open' : ''}`}
      aria-label="Background"
      onKeyDown={(event) => {
        if (!bed || !selected || (event.key !== 'Backspace' && event.key !== 'Delete')) return;
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        event.stopPropagation();
        commit({ ...bed, clips: bed.clips.filter((item) => item.id !== selected) });
      }}
    >
      <div className="bed-bar">
        <button type="button" className="bed-disclosure" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Background
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          {bed ? 'Replace…' : 'Load a file…'}
        </button>
        {bed && (
          <>
            <span className={`bed-name${missing ? ' warn' : ''}`} title={bed.sample.name}>
              {missing ? `${bed.sample.name} is missing` : bed.sample.name}
            </span>
            <label className="bed-level">
              <span>Level</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={bed.level}
                aria-label="Background level"
                onChange={(event) => commit({ ...bed, level: Number(event.target.value) })}
              />
            </label>
            <button type="button" onClick={() => commit(null)}>
              Remove
            </button>
          </>
        )}
        {!bed && <span className="muted">A file behind the piece. Cuts sit on the beat and play at the file's own speed.</span>}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aiff,.aif"
          hidden
          aria-label="Background file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onLoad(file);
          }}
        />
      </div>
      {open && shown && (
        <>
          {ordered.length > 0 ? (
            <Timeline className="bed-cuts" orientation="horizontal" loop={false} aria-label="Cuts">
              {ordered.map((item, index) => (
                <TimelineItem
                  key={item.id}
                  value={item.id}
                  status={item.id === selected ? 'current' : 'upcoming'}
                  onClick={() => setSelected(item.id)}
                  onFocus={() => setSelected(item.id)}
                >
                  <TimelineMarker />
                  <TimelineConnector />
                  <TimelineTitle>{item.mute ? 'Muted' : `Cut ${index + 1}`}</TimelineTitle>
                  <TimelineTime dateTime={`PT${Math.max(0, Math.round(item.offset))}S`}>{clockTime(item.offset)}</TimelineTime>
                  <TimelineDescription>
                    {formatBeats(item.beat, snap)} · {formatBeats(clipBeats(item, secondsPerBeat), snap)}
                  </TimelineDescription>
                </TimelineItem>
              ))}
            </Timeline>
          ) : (
            <div className="bed-empty">
              <span className="muted">Every cut is gone.</span>
              <button type="button" onClick={() => commit({ ...shown, clips: [wholeClip(shown.duration)] })}>
                Use the whole file
              </button>
            </div>
          )}
          <div className="bed-scroll">
            <div className="bed-track" style={{ width }}>
              <canvas ref={canvasRef} className="bed-wave" style={{ width, height: LANE_H }} />
              {shown.clips.map((item) => {
                const left = item.beat * px;
                const w = Math.max(8, clipBeats(item, secondsPerBeat) * px);
                return (
                  <div
                    key={item.id}
                    className={`bed-clip${item.id === selected ? ' is-on' : ''}${item.mute ? ' is-muted' : ''}`}
                    style={{ left, width: w }}
                    onPointerDown={(event) => begin(event, item, 'move')}
                  >
                    <button type="button" className="bed-handle" aria-label="Trim the start" onPointerDown={(event) => begin(event, item, 'start')} />
                    <button type="button" className="bed-handle is-end" aria-label="Trim the end" onPointerDown={(event) => begin(event, item, 'end')} />
                  </div>
                );
              })}
              <div className="bed-playhead" ref={headRef} />
            </div>
          </div>
          {clip && bed && (
            <div className="bed-edit">
              <label className="bed-level">
                <span>Gain</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={clip.gain}
                  aria-label="Cut gain"
                  onChange={(event) =>
                    commit({ ...bed, clips: bed.clips.map((item) => (item.id === clip.id ? shapeClip(item, { gain: Number(event.target.value) }) : item)) })
                  }
                />
              </label>
              <label className="bed-level">
                <span>Fade in</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.05, clip.seconds / 2)}
                  step={0.01}
                  value={clip.fadeIn}
                  aria-label="Fade in"
                  onChange={(event) =>
                    commit({ ...bed, clips: bed.clips.map((item) => (item.id === clip.id ? shapeClip(item, { fadeIn: Number(event.target.value) }) : item)) })
                  }
                />
              </label>
              <label className="bed-level">
                <span>Fade out</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.05, clip.seconds / 2)}
                  step={0.01}
                  value={clip.fadeOut}
                  aria-label="Fade out"
                  onChange={(event) =>
                    commit({ ...bed, clips: bed.clips.map((item) => (item.id === clip.id ? shapeClip(item, { fadeOut: Number(event.target.value) }) : item)) })
                  }
                />
              </label>
              <button type="button" onClick={() => commit({ ...bed, clips: bed.clips.map((item) => (item.id === clip.id ? { ...item, mute: !item.mute } : item)) })}>
                {clip.mute ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" onClick={split}>
                Split
              </button>
              <button type="button" onClick={() => commit({ ...bed, clips: [...bed.clips, duplicateClip(clip, secondsPerBeat, newId('cut'))] })}>
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => {
                  commit({ ...bed, clips: bed.clips.filter((item) => item.id !== clip.id) });
                  setSelected(null);
                }}
              >
                Delete
              </button>
            </div>
          )}
          <div className="bed-zoom">
            <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value / 1.5))} aria-label="Zoom out">
              −
            </button>
            <button type="button" onClick={() => setZoom((value) => Math.min(4, value * 1.5))} aria-label="Zoom in">
              +
            </button>
          </div>
        </>
      )}
    </section>
  );
}
