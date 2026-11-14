import {
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type IsValidConnection,
  type NodeMouseHandler,
  type OnConnectEnd,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { wholeClip, type Bed } from './bed';
import { CanvasPage } from './CanvasPage';
import { CanvasesPage } from './CanvasesPage';
import { useDeck } from './deck/useDeck';
import type { DeckBlock } from './deck/scene';
import { Engine } from './engine/engine';
import { setMachines } from './engine/instruments';
import { DEFAULT_PATCH, machineInstrument, machineShort, PRESETS, type SynthMachine } from './engine/synth';
import { ExamplesPage } from './ExamplesPage';
import { InstrumentsPage } from './InstrumentsPage';
import { SynthPage } from './SynthPage';
import { BLOCK_SIZE, DEFAULT_SPAN, PX_PER_BEAT, fitLength, inPort, linkBeats, linkBetween, outPort, patternFrame, spanOf, type SpanPoint, type XY } from './engine/geometry';
import { NEW_PATTERN } from './engine/pattern';
import { isMelodic, type BlockKind } from './engine/scheduler';
import { DEFAULT_SCALE_ID, SCALES, scaleById, type Scale, type Tuning } from './engine/tuning';
import { GuidePage } from './GuidePage';
import { EXAMPLES, type Example } from './examples';
import {
  bendsCarriedBy,
  bendsOf,
  carryBends,
  emptyPiece,
  isBlock,
  isRegion,
  newId,
  regionNode,
  savePiece,
  toEdges,
  toBuses,
  toGraph,
  toGraphLinks,
  toNodes,
  toPiece,
  tuningAt,
  type BlockData,
  type BlockNode,
  type CanvasNode,
  type LinkEdge,
  type Piece,
  type RegionData,
} from './piece';
import { pieceCycle } from './cycle';
import { MAX_CANVASES, addCanvas, openLibrary, removeFromLibrary, renameInLibrary, writeLibrary } from './library';
import { findLoops } from './loops';
import { regionAt, regionContents, regionRect } from './regions';
import {
  compileWaves,
  heardCycleIds,
  motionBeats,
  stampOf,
  waveCenter,
  type Stamp,
  type Wave,
  type WaveRole,
} from './engine/wave';
import { SettingsContext } from './settings';
import { MOD, TopBar, clockTime } from './TopBar';
import type { MenuItem } from './ui/Menu';
import { routeHref, useRoute } from './ui/route';
import { ConfirmHost, confirmDialog } from './ui/Confirm';
import { ToastHost, toast } from './ui/Toast';
import { youtubeAudio, youtubeInfo } from './youTubeAudio';
import { storeSample } from './engine/samples';
import { MAX_RECORD_SECONDS } from './engine/recorder';
import { useHistory } from './history';
import { datedName, decodeShare, download, encodeShare, pieceFromFile, pieceToFile, sharedCode, shareUrl } from './share';
import { layoutTake, MAX_TAKES, type Take } from './takes';
import * as Tone from 'tone';

const SAMPLES_STAY = "Samples don't travel in links: whoever opens it hears the synth in their place. Save a file to send them too.";

/** Focus is somewhere keys type text, so shortcuts should leave them alone. */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('input[type="text"], input[type="number"], select, textarea');

/** A block as the point links measure from: its centre, and how long its box is. */
function spanPoint(node: CanvasNode): SpanPoint {
  return isBlock(node) ? { x: node.position.x, y: node.position.y, pattern: node.data.pattern, beats: node.data.beats } : node.position;
}

function blockFields(block: DeckBlock): BlockData {
  return {
    kind: block.kind as BlockKind,
    degree: block.degree,
    every: block.every,
    ...(block.key ? { key: block.key } : {}),
    ...(block.code ? { code: block.code } : {}),
    ...(block.pattern !== undefined
      ? {
          pattern: block.pattern,
          beats: spanOf(block),
          ...(block.figure ? { figure: block.figure } : {}),
          ...(typeof block.level === 'number' && block.level < 1 ? { level: block.level } : {}),
          ...(typeof block.tone === 'number' && block.tone < 1 ? { tone: block.tone } : {}),
        }
      : {}),
  };
}

export function App() {
  return (
    <ReactFlowProvider>
      <Studio />
    </ReactFlowProvider>
  );
}

function Studio() {
  // Read before the first autosave, to tell a first visit from returning work.
  const [shelf] = useState(() => openLibrary(localStorage));
  const [hadSavedWork] = useState(shelf.existed);
  const [initial] = useState(shelf.current);
  const [canvasId, setCanvasId] = useState(shelf.currentId);
  const [canvases, setCanvases] = useState(shelf.canvases);
  const [nodes, setNodes, onNodesChange] = useNodesState(toNodes(initial));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toEdges(initial));
  const [waves, setWaves] = useState<Wave[]>(initial.waves ?? []);
  const [takes, setTakes] = useState<Take[]>(initial.takes ?? []);
  const [machines, setMachinesState] = useState<SynthMachine[]>(initial.machines ?? []);
  const [bed, setBed] = useState<Bed | null>(initial.bed ?? null);
  const [bedPeaks, setBedPeaks] = useState<Float32Array | null>(null);
  const [bedMissing, setBedMissing] = useState(false);
  const [pencil, setPencil] = useState(false);
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(null);
  const [bpm, setBpm] = useState(initial.bpm);
  const [snap, setSnap] = useState(initial.snap);
  const [scaleId, setScaleId] = useState(initial.scaleId);
  const [rootHz, setRootHz] = useState(initial.rootHz);
  const [importedScales, setImportedScales] = useState(initial.scales);
  const [playing, setPlaying] = useState(false);
  const [route, routeCanvasId, go] = useRoute();
  const [recording, setRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const openFileRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState({ pulses: 0, overflow: false, beat: 0 });
  const [engine, setEngine] = useState(() => new Engine());
  // A hot reload keeps the old engine, including a playback clock that already
  // stopped. The new class is a different one, so swap it in.
  if (!(engine instanceof Engine)) {
    (engine as Engine).stop();
    setEngine(new Engine());
  }
  const { screenToFlowPosition, deleteElements, fitView } = useReactFlow<CanvasNode, LinkEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const scales = useMemo(() => [...SCALES, ...importedScales], [importedScales]);
  const scale = useMemo(() => scaleById(scaleId, scales), [scaleId, scales]);
  const canvas = useMemo<Tuning>(() => ({ scale, rootHz }), [scale, rootHz]);
  const settings = useMemo(() => ({ canvas, scales, snap }), [canvas, scales, snap]);

  // Synth machines resolve through the engine's registry, for the voices and
  // for every label and picker that looks instruments up by kind. Updated
  // during render, not in an effect, so a render that shows a machine already
  // resolves it — the playing surfaces read the registry in that same commit.
  useMemo(() => setMachines(machines.map(machineInstrument)), [machines]);

  // The canvas is the source of truth; the engine follows it.
  useEffect(() => engine.setGraph(toGraph(nodes, canvas, scales), toGraphLinks(edges)), [engine, nodes, edges, canvas, scales]);
  // Bus settings change rarely, but nodes change on every drag frame; key the
  // engine update on the settings themselves.
  const busKey = useMemo(() => JSON.stringify([...toBuses(nodes)]), [nodes]);
  useEffect(() => engine.setBuses(new Map(JSON.parse(busKey))), [engine, busKey]);
  useEffect(() => engine.setSnap(snap), [engine, snap]);
  useEffect(() => engine.setBpm(bpm), [engine, bpm]);
  useEffect(() => engine.setBed(bed), [engine, bed]);
  useEffect(() => {
    const id = bed?.sample.id;
    if (!id) {
      setBedPeaks(null);
      setBedMissing(false);
      return;
    }
    let live = true;
    void engine.warmBed(id).then((got) => {
      if (!live) return;
      setBedPeaks(got?.peaks ?? null);
      setBedMissing(got === null);
    });
    return () => {
      live = false;
    };
  }, [engine, bed?.sample.id]);
  useEffect(() => () => engine.stop(), [engine]);

  // Region geometry, not every block drag: a wave's bus is the region its centre is in.
  const regionKey = useMemo(
    () => nodes.filter(isRegion).map((n) => {
      const r = regionRect(n);
      return `${n.id}:${r.x}:${r.y}:${r.w}:${r.h}`;
    }).join('|'),
    [nodes],
  );
  useEffect(() => {
    engine.setWaves(compileWaves(waves, (at) => regionAt(nodes, at)?.id, snap));
    // `regionKey` is the region geometry; block drags don't change which bus a wave plays on.
  }, [engine, waves, snap, regionKey]);

  useEffect(() => {
    // Nothing is open; the library is empty until a canvas is made.
    if (canvasId === null) return;
    const timer = setTimeout(() => {
      const piece = toPiece(nodes, edges, { bpm, snap, scaleId, rootHz, scales: importedScales }, waves, takes, bed, machines);
      savePiece(piece);
      setCanvases((prev) => {
        const next = prev.map((canvas) => (canvas.id === canvasId ? { ...canvas, piece, updatedAt: Date.now() } : canvas));
        writeLibrary(localStorage, { currentId: canvasId, canvases: next });
        return next;
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [nodes, edges, waves, takes, bed, bpm, snap, scaleId, rootHz, importedScales, machines, canvasId]);

  // Everything undoable is in the piece; selection and view are not.
  const pieceJson = useMemo(
    () => JSON.stringify(toPiece(nodes, edges, { bpm, snap, scaleId, rootHz, scales: importedScales }, waves, takes, bed, machines)),
    [nodes, edges, waves, takes, bed, bpm, snap, scaleId, rootHz, importedScales, machines],
  );

  // Puts an undo step back, keeping what's selected and what React Flow has
  // already measured (so blocks don't blink while it measures them again).
  const restore = (json: string) => {
    const piece = JSON.parse(json) as Piece;
    setNodes((ns) => {
      const before = new Map(ns.map((n) => [n.id, n]));
      return toNodes(piece).map((n) => {
        const old = before.get(n.id);
        return old ? ({ ...n, selected: old.selected, measured: old.measured } as CanvasNode) : n;
      });
    });
    setEdges((es) => {
      const selected = new Set(es.filter((e) => e.selected).map((e) => e.id));
      return toEdges(piece).map((e) => (selected.has(e.id) ? { ...e, selected: true } : e));
    });
    setBpm(piece.bpm);
    setSnap(piece.snap);
    setScaleId(piece.scaleId);
    setRootHz(piece.rootHz);
    setImportedScales(piece.scales);
    setWaves(piece.waves ?? []);
    setTakes(piece.takes ?? []);
    setMachinesState(piece.machines ?? []);
    setBed(piece.bed ?? null);
    setSelectedWaveId((id) => ((piece.waves ?? []).some((w) => w.id === id) ? id : null));
  };
  const { undo, redo, canUndo, canRedo } = useHistory(pieceJson, restore);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // A selected wave isn't a React Flow node, so delete it here. Capture runs
  // before the canvas, which would otherwise see a key it has nothing for.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || (e.key !== 'Backspace' && e.key !== 'Delete') || !selectedWaveId) return;
      if (nodes.some((n) => n.selected) || edges.some((e) => e.selected)) return;
      e.preventDefault();
      e.stopPropagation();
      setWaves((ws) => ws.filter((w) => w.id !== selectedWaveId));
      setSelectedWaveId(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [selectedWaveId, nodes, edges]);

  // Imported scales are named by their content, so a re-import is a no-op.
  const importScale = useCallback(
    (s: Scale) => setImportedScales((ss) => (ss.some((x) => x.id === s.id) ? ss : [...ss, s])),
    [],
  );

  // Whatever still uses a removed scale switches to the default one, so say so first.
  const removeScale = async (id: string) => {
    const regions = nodes.filter((n) => isRegion(n) && n.data.scaleId === id).length;
    const users = [id === scaleId ? 'the canvas' : '', regions === 1 ? 'one region' : regions ? `${regions} regions` : '']
      .filter(Boolean)
      .join(' and ');
    const fallback = scaleById(DEFAULT_SCALE_ID).name;
    const ok = await confirmDialog({
      title: `Remove “${scaleById(id, scales).name}”?`,
      message: users ? `${users[0].toUpperCase()}${users.slice(1)} will switch to ${fallback}.` : 'Nothing uses it.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setImportedScales((ss) => ss.filter((s) => s.id !== id));
    setScaleId((current) => (current === id ? DEFAULT_SCALE_ID : current));
    setNodes((ns) => ns.map((n) => (isRegion(n) && n.data.scaleId === id ? { ...n, data: { ...n.data, scaleId: DEFAULT_SCALE_ID } } : n)));
  };

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const pulses = engine.scheduler.inFlight();
      const now = engine.currentBeat();
      const overflow = engine.scheduler.overflowBeat > now - 4;
      const beat = Math.floor(now);
      setStats((s) => (s.pulses === pulses && s.overflow === overflow && s.beat === beat ? s : { pulses, overflow, beat }));
    }, 250);
    return () => clearInterval(timer);
  }, [engine, playing]);

  // A dragged region brings along what's inside it, and links dragged along
  // with both of their blocks keep their shape. Offsets are taken from where
  // the drag started, so fast drags can't make anything drift.
  const carried = useRef<{ start: Map<string, XY>; riders: Map<string, XY>; bends: Map<string, XY[]>; waves: Map<string, XY[]> } | null>(null);

  const onNodeDragStart: OnNodeDrag<CanvasNode> = useCallback(
    (_, __, dragged) => {
      const start = new Map(dragged.map((n) => [n.id, n.position]));
      const riders = new Map<string, XY>();
      const waveStarts = new Map<string, XY[]>();
      for (const d of dragged) {
        const region = nodes.find((n) => n.id === d.id);
        if (!region || !isRegion(region)) continue;
        for (const n of regionContents(nodes, region)) if (!start.has(n.id)) riders.set(n.id, n.position);
        for (const w of waves) {
          if (waveStarts.has(w.id)) continue;
          if (regionAt([region], waveCenter(w.points))) waveStarts.set(w.id, w.points.map((p) => ({ ...p })));
        }
      }
      const bends = bendsCarriedBy(edges, new Set([...start.keys(), ...riders.keys()]));
      carried.current = bends.size || riders.size || waveStarts.size ? { start, riders, bends, waves: waveStarts } : null;
    },
    [nodes, edges, waves],
  );

  const onNodeDrag: OnNodeDrag<CanvasNode> = useCallback(
    (_, node) => {
      const c = carried.current;
      const from = c?.start.get(node.id);
      if (!c || !from) return;
      const dx = node.position.x - from.x;
      const dy = node.position.y - from.y;
      if (c.bends.size) setEdges((es) => carryBends(es, c.bends, dx, dy));
      if (c.riders.size) {
        setNodes((ns) =>
          ns.map((n) => {
            const p = c.riders.get(n.id);
            return p ? { ...n, position: { x: p.x + dx, y: p.y + dy } } : n;
          }),
        );
      }
      if (c.waves.size) {
        setWaves((ws) =>
          ws.map((w) => {
            const pts = c.waves.get(w.id);
            return pts ? { ...w, points: pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : w;
          }),
        );
      }
    },
    [setEdges, setNodes],
  );

  const togglePlay = useCallback(async () => {
    if (engine.playing) {
      engine.stop();
      setPlaying(false);
      return;
    }
    await engine.play();
    setPlaying(engine.playing);
  }, [engine]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return;
      e.preventDefault();
      if (!e.repeat) void togglePlay();
    };
    // Stops a focused button or checkbox from also reacting to the space bar.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [togglePlay]);

  const addBlock = useCallback(
    (data: BlockData, position: XY) => {
      const frame = patternFrame(data);
      const node: BlockNode = { id: newId('b'), type: 'block', position, data, selected: true, ...(frame ?? {}) };
      setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), node]);
      setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
      return node.id;
    },
    [setNodes, setEdges],
  );

  const viewCenter = (jitter = 0) => {
    const r = wrapperRef.current!.getBoundingClientRect();
    const j = () => (Math.random() - 0.5) * jitter;
    return screenToFlowPosition({ x: r.left + r.width / 2 + j(), y: r.top + r.height / 2 + j() });
  };

  const addFromToolbar = (kind: BlockKind) => addBlock({ kind, degree: 0, every: 0 }, viewCenter(120));

  const addPattern = () => addBlock({ kind: 'tone', degree: 0, every: 0, pattern: NEW_PATTERN, beats: DEFAULT_SPAN }, viewCenter(120));

  // A new region wraps the selected blocks, if any, so selecting a phrase and
  // adding a region gives that phrase its own tuning.
  const addRegion = () => {
    const picked = nodes.filter((n) => n.selected && isBlock(n));
    let rect: { x: number; y: number; w: number; h: number };
    if (picked.length) {
      const xs = picked.map((n) => n.position.x);
      const ys = picked.map((n) => n.position.y);
      const [x, y] = [Math.min(...xs) - BLOCK_SIZE, Math.min(...ys) - BLOCK_SIZE];
      rect = { x, y, w: Math.max(...xs) + BLOCK_SIZE - x, h: Math.max(...ys) + BLOCK_SIZE - y };
    } else {
      const c = viewCenter();
      const [w, h] = [PX_PER_BEAT * 2.5, PX_PER_BEAT * 1.75];
      rect = { x: c.x - w / 2, y: c.y - h / 2, w, h };
    }
    const name = `Region ${nodes.filter(isRegion).length + 1}`;
    const region = { ...regionNode(newId('r'), rect, { name, scaleId, rootHz }), selected: true };
    setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), region]);
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
  };

  const onPaneDoubleClick = (e: ReactMouseEvent) => {
    if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
    addBlock({ kind: 'tone', degree: 0, every: 0 }, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const clearFlowSelection = useCallback(() => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
  }, [setNodes, setEdges]);

  const addWave = useCallback(
    (role: WaveRole, points: XY[]) => {
      const id = newId('w');
      setWaves((ws) => [...ws, { id, role, points }]);
      setSelectedWaveId(id);
      clearFlowSelection();
    },
    [clearFlowSelection],
  );

  const addStamp = (stamp: Stamp) => {
    const shape = stampOf(stamp, viewCenter(40));
    addWave(shape.role, shape.points);
  };

  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, id: newId('l'), type: 'link' }, es)),
    [setEdges],
  );

  const isValidConnection: IsValidConnection<LinkEdge> = useCallback(
    (c) => c.source !== c.target && !edges.some((e) => e.source === c.source && e.target === c.target),
    [edges],
  );

  // Letting go of a new link over empty canvas grows a block there.
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || state.toNode) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const position = screenToFlowPosition({ x: point.clientX, y: point.clientY });
      const from = state.fromNode;
      if (Math.hypot(position.x - from.position.x, position.y - from.position.y) < BLOCK_SIZE) return;
      const source = from.data as BlockData;
      const id = addBlock(
        {
          kind: source.kind === 'start' ? 'tone' : source.kind,
          degree: isMelodic(source.kind) ? source.degree + 1 : source.degree,
          every: 0,
        },
        position,
      );
      setEdges((es) => [...es, { id: newId('l'), type: 'link', source: from.id, target: id }]);
    },
    [addBlock, screenToFlowPosition, setEdges],
  );

  const onNodeDoubleClick: NodeMouseHandler<CanvasNode> = useCallback(
    (_, node) => {
      if (!isBlock(node)) return;
      if (engine.playing) engine.fire(node.id);
      else void engine.audition({ id: node.id, ...node.position, ...node.data, ...tuningAt(nodes, node.position, canvas, scales) });
    },
    [engine, nodes, canvas, scales],
  );

  const updateBlock = (id: string, patch: Partial<BlockData>) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || !isBlock(node)) return;
    const data = { ...node.data, ...patch };
    // A length change keeps the left edge put, so the link coming in doesn't jump.
    const frame = patternFrame(data);
    let position = node.position;
    if (frame && node.data.pattern !== undefined && typeof patch.beats === 'number') {
      const left = node.position.x - (spanOf(node.data) * PX_PER_BEAT) / 2;
      position = { ...node.position, x: left + frame.width / 2 };
    }
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== id || !isBlock(n)) return n;
        const { measured: _measured, width: _width, height: _height, ...rest } = n;
        return frame ? { ...rest, position, data, width: frame.width, height: frame.height } : { ...rest, position, data };
      }),
    );
    if (!engine.playing && ('degree' in patch || 'kind' in patch)) {
      void engine.audition({ id, ...node.position, ...data, ...tuningAt(nodes, node.position, canvas, scales) });
    }
  };

  // The file is stored and decoded before the region takes it, so a file that
  // isn't audio never replaces a working sound.
  const loadSample = async (regionId: string, file: File) => {
    let sample;
    try {
      sample = await storeSample(file);
    } catch (err) {
      toast('error', `Couldn't load ${file.name}`, (err as Error).message);
      return;
    }
    try {
      await engine.loadSample(sample.id);
    } catch {
      toast('error', `Couldn't load ${file.name}`, "It isn't audio this browser can decode.");
      return;
    }
    updateRegion(regionId, { sample });
    toast('success', `Loaded ${file.name}`, 'Tones in this region now play it.');
  };

  // Stored and decoded before it becomes the background, so a file that isn't
  // audio never replaces one that is.
  const loadBed = async (file: File) => {
    let sample;
    try {
      sample = await storeSample(file);
    } catch (err) {
      toast('error', `Couldn't load ${file.name}`, (err as Error).message);
      return;
    }
    const got = await engine.warmBed(sample.id);
    if (!got) {
      toast('error', `Couldn't load ${file.name}`, "It isn't audio this browser can decode.");
      return;
    }
    setBedPeaks(got.peaks);
    setBedMissing(false);
    setBed({ sample, duration: got.duration, level: 0.8, clips: [wholeClip(got.duration)] });
    toast('success', `Playing ${file.name} behind the piece`, 'Drag a cut to move it, its edges to trim, and Split to cut it.');
  };

  // A pasted YouTube URL becomes an MP3 on the dev server, then rides the same
  // store-and-decode path as a file, so a video that fails never replaces a
  // working background. The lookup first so the person knows what is coming.
  const loadYouTube = async (raw: string) => {
    const url = raw.trim();
    if (!url) return;
    let info;
    try {
      info = await youtubeInfo(url);
    } catch (err) {
      toast('error', "Couldn't use that URL", (err as Error).message);
      return;
    }
    try {
      const file = await youtubeAudio(url, info);
      await loadBed(file);
    } catch (err) {
      toast('error', `Couldn't download “${info.title}”`, (err as Error).message);
    }
  };

  const updateRegion = (id: string, patch: Partial<RegionData>) =>
    setNodes((ns) => ns.map((n) => (n.id === id && isRegion(n) ? { ...n, data: { ...n.data, ...patch } } : n)));

  const selectedNode = nodes.find((n) => n.selected);
  const selectedBlock = selectedNode && isBlock(selectedNode) ? selectedNode : undefined;
  const selectedRegion = selectedNode && isRegion(selectedNode) ? selectedNode : undefined;
  const blockTuning = selectedBlock && {
    tuning: tuningAt(nodes, selectedBlock.position, canvas, scales),
    region: regionAt(nodes, selectedBlock.position)?.data.name,
  };
  const selectedEdge = selectedNode ? undefined : edges.find((e) => e.selected);
  const selectedWave = !selectedNode && !selectedEdge ? waves.find((w) => w.id === selectedWaveId) : undefined;
  const waveInfo = selectedWave && {
    role: selectedWave.role,
    beats: motionBeats(selectedWave.points, snap),
    place: regionAt(nodes, waveCenter(selectedWave.points))?.data.name || null,
    heard: selectedWave.role !== 'cycle' || heardCycleIds(waves, (at) => regionAt(nodes, at)?.id).has(selectedWave.id),
    sampled: !!regionAt(nodes, waveCenter(selectedWave.points))?.data.sample,
    points: selectedWave.points.length,
    instrument: selectedWave.instrument ?? '',
  };
  let selectedLink: { beats: number; minBeats: number; bends: number; code: string } | undefined;
  if (selectedEdge) {
    const a = nodes.find((n) => n.id === selectedEdge.source);
    const b = nodes.find((n) => n.id === selectedEdge.target);
    const bends = bendsOf(selectedEdge);
    if (a && b) {
      const beats = linkBeats(linkBetween(spanPoint(a), spanPoint(b), bends, 0).len, snap);
      const minBeats = linkBetween(spanPoint(a), spanPoint(b), [], 0).len / PX_PER_BEAT;
      selectedLink = { beats, minBeats, bends: bends.length, code: selectedEdge.data?.code ?? '' };
    }
  }

  // Bends the selected link to an exact length, keeping both blocks where they are.
  const setLinkLength = (beats: number) => {
    const a = selectedEdge && nodes.find((n) => n.id === selectedEdge.source);
    const b = selectedEdge && nodes.find((n) => n.id === selectedEdge.target);
    if (!selectedEdge || !a || !b) return;
    const from = spanPoint(a);
    const to = spanPoint(b);
    const bends = fitLength(outPort(from, spanOf(from)), inPort(to, spanOf(to)), bendsOf(selectedEdge), beats * PX_PER_BEAT);
    if (bends) setEdges((es) => es.map((e) => (e.id === selectedEdge.id ? { ...e, data: { ...e.data, bends } } : e)));
  };

  const blockPositions = useMemo(() => nodes.filter(isBlock).map((n) => n.position), [nodes]);
  const loops = useMemo(() => {
    const positions = new Map(nodes.filter(isBlock).map((n) => [n.id, n.position]));
    const links = edges.flatMap((e) => {
      const a = nodes.find((n) => n.id === e.source);
      const b = nodes.find((n) => n.id === e.target);
      return a && b ? [{ source: e.source, target: e.target, beats: linkBeats(linkBetween(spanPoint(a), spanPoint(b), bendsOf(e), 0).len, snap) }] : [];
    });
    const spans = new Map(nodes.filter(isBlock).map((n) => [n.id, spanOf(n.data)]));
    return findLoops(positions, links, spans);
  }, [nodes, edges, snap]);

  const setLinkCode = (code: string) => {
    if (!selectedEdge) return;
    setEdges((es) => es.map((e) => (e.id === selectedEdge.id ? { ...e, data: { bends: bendsOf(e), ...e.data, code } } : e)));
  };

  const straightenSelection = () => {
    if (!selectedEdge) return;
    setEdges((es) => es.map((e) => (e.id === selectedEdge.id ? { ...e, data: { ...e.data, bends: [] } } : e)));
  };

  const deleteSelection = () =>
    void deleteElements({
      nodes: selectedNode ? [{ id: selectedNode.id }] : [],
      edges: selectedEdge ? [{ id: selectedEdge.id }] : [],
    });

  const replaceWith = (piece: Piece) => {
    engine.stop();
    setPlaying(false);
    setNodes(toNodes(piece));
    setEdges(toEdges(piece));
    setWaves(piece.waves ?? []);
    setTakes(piece.takes ?? []);
    setMachinesState(piece.machines ?? []);
    setBed(piece.bed ?? null);
    setSelectedWaveId(null);
    setBpm(piece.bpm);
    setSnap(piece.snap);
    setScaleId(piece.scaleId);
    setRootHz(piece.rootHz);
    for (const s of piece.scales) importScale(s);
    setTimeout(() => void fitView({ padding: 0.25, duration: 300 }), 50);
  };

  const currentPiece = () => toPiece(nodes, edges, { bpm, snap, scaleId, rootHz, scales: importedScales }, waves, takes, bed, machines);

  // A shared link opens its piece. A first visit just shows it; otherwise ask,
  // since it replaces the work saved in this browser. The fragment is cleared
  // either way, so reloading doesn't ask again.
  useEffect(() => {
    const code = sharedCode(location.hash);
    if (!code) return;
    history.replaceState(null, '', location.pathname + location.search);
    void (async () => {
      let piece: Piece;
      try {
        piece = await decodeShare(code);
      } catch (err) {
        toast('error', "Couldn't open the shared link", (err as Error).message);
        return;
      }
      if (hadSavedWork) {
        const ok = await confirmDialog({
          title: 'Open the shared piece?',
          message: 'It replaces what is on your canvas now. Your imported scales stay.',
          confirmLabel: 'Open',
        });
        if (!ok) return;
      }
      replaceWith(piece);
      toast('success', 'Opened the shared piece', piece.regions.some((r) => r.sample) ? SAMPLES_STAY : 'Press play, or Space, to hear it.');
    })();
    // Only on arrival.
  }, []);

  const share = async () => {
    const piece = currentPiece();
    const url = shareUrl(await encodeShare(piece));
    const note = piece.regions.some((r) => r.sample) ? SAMPLES_STAY : 'Anyone who opens it gets their own copy of this piece.';
    try {
      await navigator.clipboard.writeText(url);
      toast('success', 'Link copied', note);
    } catch {
      history.replaceState(null, '', url);
      toast('info', 'Copy the link from the address bar', note);
    }
  };

  const save = async () => {
    download(await pieceToFile(currentPiece()), datedName('json'));
    toast('success', 'Saved', 'The file holds the piece and its samples; Open loads it back.');
  };

  const openFile = async (file: File) => {
    let piece: Piece;
    try {
      piece = await pieceFromFile(await file.text());
    } catch (err) {
      toast('error', `Couldn't open ${file.name}`, (err as Error).message);
      return;
    }
    const ok = await confirmDialog({
      title: `Open ${file.name}?`,
      message: 'It replaces the canvas. Your imported scales stay.',
      confirmLabel: 'Open',
    });
    if (!ok) return;
    replaceWith(piece);
    toast('success', `Opened ${file.name}`);
  };

  // Recording starts playback if it isn't running, so the first notes are
  // caught; stopping playback keeps recording, so reverb tails are too.
  const toggleRecording = async () => {
    if (engine.recording) {
      const seconds = engine.recordedSeconds;
      const wav = await engine.stopRecording();
      setRecording(false);
      if (wav) {
        download(wav, datedName('wav'));
        toast('success', 'Recording saved', `${clockTime(seconds)} of audio, as a WAV file.`);
      }
      return;
    }
    try {
      await engine.startRecording();
    } catch (err) {
      toast('error', "Couldn't start recording", (err as Error).message);
      return;
    }
    setRecordedSeconds(0);
    setRecording(true);
    if (!engine.playing) await togglePlay();
  };

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setRecordedSeconds(engine.recordedSeconds);
      if (engine.recordedSeconds >= MAX_RECORD_SECONDS) void toggleRecording();
    }, 250);
    return () => clearInterval(timer);
    // toggleRecording only touches the engine and state setters.
  }, [engine, recording]);

  const openExample = (example: Example) => {
    if (!canvasId) {
      // No canvas is open; the example becomes the first one.
      const added = addCanvas({ currentId: null, canvases: [] }, example.piece, Date.now(), example.title);
      if (!added) return;
      writeLibrary(localStorage, added);
      setCanvases(added.canvases);
      setCanvasId(added.currentId);
      replaceWith(example.piece);
      go('canvas', added.currentId);
      toast('success', example.title, 'Loaded into a new canvas. Press play, or Space, to hear it.');
      return;
    }
    go('canvas', canvasId);
    replaceWith(example.piece);
    toast('success', example.title, 'Loaded. Press play, or Space, to hear it.');
  };

  const newPiece = async () => {
    const ok = await confirmDialog({
      title: 'Start a new piece?',
      message: `This canvas is cleared. Your other canvases stay. ${MOD}Z brings this one back.`,
      confirmLabel: 'New piece',
      danger: true,
    });
    if (ok) replaceWith(emptyPiece({ bpm, snap, scaleId, rootHz, scales: importedScales }));
  };

  const settingsNow = () => ({ bpm, snap, scaleId, rootHz, scales: importedScales });

  const openCanvas = (id: string) => {
    const target = canvases.find((canvas) => canvas.id === id);
    if (!target) return;
    if (id !== canvasId) {
      const piece = currentPiece();
      const next = canvases.map((canvas) => (canvas.id === canvasId ? { ...canvas, piece, updatedAt: Date.now() } : canvas));
      writeLibrary(localStorage, { currentId: id, canvases: next });
      setCanvases(next);
      setCanvasId(id);
      replaceWith(target.piece);
    }
    go('canvas', id);
  };

  // The URL names the open canvas (#/canvas/<id>), so a refresh, the back
  // button, or a pasted link restores it. An id that isn't in the library
  // (deleted, or from another browser's localStorage) falls back to the
  // canvas that is open; a bare canvas URL is rewritten in place. With no
  // canvases at all there is nothing to open, so land on the list.
  useEffect(() => {
    if (route !== 'canvas') return;
    if (!canvases.length) {
      go('canvases');
      return;
    }
    if (routeCanvasId && canvases.some((canvas) => canvas.id === routeCanvasId)) {
      if (routeCanvasId !== canvasId) openCanvas(routeCanvasId);
      return;
    }
    history.replaceState(null, '', routeHref('canvas', canvasId));
    // Navigation is driven by the fragment; openCanvas follows the canvases.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, routeCanvasId, canvasId, canvases]);

  const makeCanvas = (name?: string): string | null => {
    if (canvases.length >= MAX_CANVASES) {
      toast('info', `${MAX_CANVASES} canvases is the limit`, 'Delete one before adding another.');
      return `${MAX_CANVASES} canvases is the limit. Delete one before adding another.`;
    }
    const piece = currentPiece();
    const fresh = emptyPiece(settingsNow());
    const saved = canvases.map((canvas) => (canvas.id === canvasId ? { ...canvas, piece, updatedAt: Date.now() } : canvas));
    const added = addCanvas({ currentId: canvasId, canvases: saved }, fresh, Date.now(), name);
    if (!added) return `${MAX_CANVASES} canvases is the limit. Delete one before adding another.`;
    writeLibrary(localStorage, added);
    setCanvases(added.canvases);
    setCanvasId(added.currentId);
    replaceWith(fresh);
    go('canvas', added.currentId);
    return null;
  };

  const renameCanvas = (id: string, name: string) => {
    setCanvases((prev) => {
      const file = renameInLibrary({ currentId: canvasId, canvases: [...prev] }, id, name);
      writeLibrary(localStorage, file);
      return file.canvases;
    });
  };

  const removeCanvas = (id: string) => {
    const piece = currentPiece();
    const saved = canvases.map((item) => (item.id === canvasId ? { ...item, piece, updatedAt: Date.now() } : item));
    const result = removeFromLibrary({ currentId: canvasId, canvases: saved }, id);
    writeLibrary(localStorage, result.file);
    setCanvases(result.file.canvases);
    setCanvasId(result.file.currentId);
    if (result.opened) replaceWith(result.opened);
  };

  const deleteCanvas = async (id: string) => {
    const canvas = canvases.find((item) => item.id === id);
    if (!canvas) return;
    const ok = await confirmDialog({
      title: `Delete “${canvas.name}”?`,
      message: canvases.length > 1 ? 'It is removed from this browser. The other canvases stay.' : 'It is the last canvas. The list stays empty until you add one.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    removeCanvas(id);
  };

  const canvasName = canvases.find((canvas) => canvas.id === canvasId)?.name ?? 'Canvas';

  const fileMenu: MenuItem[] = [
    { label: 'New piece', onSelect: () => void newPiece() },
    { label: 'Open file…', shortcut: `${MOD}O`, onSelect: () => openFileRef.current?.click() },
    { label: 'Save file', shortcut: `${MOD}S`, onSelect: () => void save() },
    'separator',
    { label: 'Copy share link', onSelect: () => void share() },
  ];

  // Performance keys: a start block's fires it, a region's mutes and unmutes it.
  const bindings = useMemo(
    () =>
      nodes.flatMap((n) => {
        const key = n.data.key;
        if (!key) return [];
        if (isBlock(n)) return n.data.kind === 'start' ? [{ key, id: n.id, mute: false, does: 'fires a start block' }] : [];
        return [{ key, id: n.id, mute: true, does: `mutes “${n.data.name || 'a region'}”` }];
      }),
    [nodes],
  );
  const takenKeys = useMemo(
    () => new Map(bindings.filter((b) => b.id !== selectedNode?.id).map((b) => [b.key, b.does])),
    [bindings, selectedNode?.id],
  );

  /** Plays a performance key. Returns false if nothing has that key. */
  const perform = (key: string) => {
    const binding = bindings.find((b) => b.key === key);
    if (!binding) return false;
    if (binding.mute) {
      setNodes((ns) =>
        ns.map((n) => (n.id === binding.id && isRegion(n) ? { ...n, data: { ...n.data, mix: { ...n.data.mix, mute: !n.data.mix.mute } } } : n)),
      );
    } else if (engine.playing) {
      engine.fire(binding.id);
    } else {
      toast('info', `${key.toUpperCase()} fires a start block`, 'Press play first; then it sends out a pulse each time you press it.');
    }
    return true;
  };

  // When every loop, and every repeating start, lines up again.
  const cycle = useMemo(
    () =>
      pieceCycle([
        ...loops.map((l) => l.beats),
        ...nodes.filter((n) => isBlock(n) && n.data.kind === 'start' && n.data.every > 0).map((n) => (n as BlockNode).data.every),
      ]),
    [loops, nodes],
  );

  // Shortcuts that belong to the app rather than the canvas.
  const shortcuts = useRef({ save, openFile: () => openFileRef.current?.click(), go, route, perform, canvasId });
  shortcuts.current = { save, openFile: () => openFileRef.current?.click(), go, route, perform, canvasId };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const { current } = shortcuts;
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 's') void current.save();
      else if ((e.metaKey || e.ctrlKey) && key === 'o') current.openFile();
      else if (e.key === '?' && !e.metaKey && !e.ctrlKey) current.go('guide');
      else if (e.key === 'Escape' && current.route !== 'canvas' && !document.querySelector('.confirm, .menu-list, .select-list')) current.go(current.canvasId ? 'canvas' : 'canvases', current.canvasId);
      else if (current.route === 'instruments' || current.route === 'synth' || e.metaKey || e.ctrlKey || e.repeat || !current.perform(key)) return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const attackInstrument = useCallback(
    (kind: string, degree: number, velocity: number) =>
      engine.attack({ id: 'instrument', x: 0, y: 0, kind: kind as BlockKind, degree, every: 0, scale, rootHz }, velocity),
    [engine, scale, rootHz],
  );
  const releaseInstrument = useCallback((id: number) => engine.release(id), [engine]);

  const saveTake = useCallback((take: Take) => {
    setTakes((current) => [...current, take].slice(-MAX_TAKES));
  }, []);

  // Synth machines: piece-level instruments. Removing one retargets the
  // blocks that played it, so nothing on the canvas points nowhere.
  const addMachine = useCallback((presetId?: string) => {
    const preset = PRESETS.find((item) => item.id === presetId);
    const id = newId('syn');
    const name = preset ? preset.name : 'Synth';
    const hint = preset ? preset.hint : 'A synth machine: a wave through a resonant low-pass and an envelope.';
    setMachinesState((current) => [...current, { id, name, short: machineShort(name), hint, patch: preset ? { ...preset.patch } : { ...DEFAULT_PATCH } }]);
    return id;
  }, []);

  const editMachine = useCallback((id: string, patch: Partial<SynthMachine>) => {
    setMachinesState((current) => current.map((machine) => (machine.id === id ? { ...machine, ...patch } : machine)));
  }, []);

  const removeMachine = useCallback(
    (id: string) => {
      setMachinesState((current) => current.filter((machine) => machine.id !== id));
      setNodes((ns) => ns.map((n) => (isBlock(n) && n.data.kind === id ? { ...n, data: { ...n.data, kind: 'tone' as BlockKind } } : n)));
      toast('info', 'Machine deleted', 'Blocks that played it now play the plain tone.');
    },
    [setNodes],
  );

  // A row of blocks, one per note, linked in time order. The piece already on
  // the canvas stays; the row steps down if (80, 80) is already a block.
  const placeTake = useCallback(
    (take: Take) => {
      const laid = layoutTake(
        take.notes,
        nodes.filter(isBlock).map((node) => node.position),
      );
      if (!laid.notes.length) return;
      const ids = laid.notes.map(() => newId('b'));
      const added: BlockNode[] = laid.notes.map((note, i) => ({
        id: ids[i],
        type: 'block',
        position: laid.positions[i],
        selected: true,
        data: { kind: take.instrument as BlockKind, degree: note.degree, every: 0 },
      }));
      const links: LinkEdge[] = [];
      for (let i = 0; i < ids.length - 1; i++) links.push({ id: newId('l'), type: 'link', source: ids[i], target: ids[i + 1] });
      setNodes((current) => [...current.map((node) => (node.selected ? { ...node, selected: false } : node)), ...added]);
      setEdges((current) => [...current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)), ...links]);
      const count = laid.notes.length;
      toast('success', `Placed ${take.name}`, `${count} ${count === 1 ? 'note' : 'notes'} on the canvas.`);
      go('canvas', canvasId);
      setTimeout(() => void fitView({ padding: 0.25, duration: 300 }), 50);
    },
    [nodes, setNodes, setEdges, go, canvasId, fitView],
  );

  useEffect(() => {
    const page = route === 'canvas' ? '' : `${route[0].toUpperCase()}${route.slice(1)} · `;
    document.title = `${page}Pulse Canvas`;
  }, [route]);

  // Arriving on Waves starts in pencil, so the page is for drawing. Leaving it
  // and coming back does the same; turning the pencil off while you stay there
  // is how you pan.
  const wasWaves = useRef(false);
  useEffect(() => {
    const onWaves = route === 'waves';
    if (onWaves && !wasWaves.current) setPencil(true);
    wasWaves.current = onWaves;
  }, [route]);

  const deck = useDeck({
    snapshot: () => ({
      canvasName,
      bpm,
      snap,
      playing,
      beat: playing ? stats.beat : 0,
      scaleId,
      scaleName: scale.name,
      rootHz,
      scales: scales.map((item) => ({ id: item.id, name: item.name })),
      blocks: nodes.filter(isBlock).map((node) => ({
        id: node.id,
        kind: node.data.kind,
        degree: node.data.degree,
        every: node.data.every,
        ...(node.data.key ? { key: node.data.key } : {}),
        ...(node.data.code ? { code: node.data.code } : {}),
        ...(node.data.pattern !== undefined
          ? {
              pattern: node.data.pattern,
              beats: node.data.beats,
              ...(node.data.figure && node.data.figure !== 'roll' ? { figure: node.data.figure } : {}),
              ...(typeof node.data.level === 'number' && node.data.level < 1 ? { level: node.data.level } : {}),
              ...(typeof node.data.tone === 'number' && node.data.tone < 1 ? { tone: node.data.tone } : {}),
            }
          : {}),
        x: node.position.x,
        y: node.position.y,
      })),
      links: edges.map((edge) => ({
        id: edge.id,
        from: edge.source,
        to: edge.target,
        bends: bendsOf(edge),
        ...(edge.data?.code ? { code: edge.data.code } : {}),
      })),
      regions: nodes.filter(isRegion).map((node) => ({
        id: node.id,
        name: node.data.name,
        scaleId: node.data.scaleId,
        scaleName: scaleById(node.data.scaleId, scales).name,
        rootHz: node.data.rootHz,
        ...(node.data.key ? { key: node.data.key } : {}),
        ...(node.data.sample ? { sample: node.data.sample } : {}),
        x: node.position.x,
        y: node.position.y,
        w: node.width ?? node.measured?.width ?? 0,
        h: node.height ?? node.measured?.height ?? 0,
        mix: node.data.mix,
        fx: node.data.fx,
        groove: node.data.groove,
      })),
      waves: waves.map((wave) => ({
        id: wave.id,
        role: wave.role,
        points: wave.points,
        ...(wave.instrument ? { instrument: wave.instrument } : {}),
      })),
      machines,
      recording,
      takes,
      canvasId,
      canvases: canvases.map((canvas) => ({ id: canvas.id, name: canvas.name })),
      bed: bed
        ? {
            name: bed.sample.name,
            sampleId: bed.sample.id,
            duration: bed.duration,
            level: bed.level,
            missing: bedMissing,
            clips: bed.clips.map((clip) => ({
              id: clip.id,
              beat: clip.beat,
              offset: clip.offset,
              seconds: clip.seconds,
              gain: clip.gain,
              fadeIn: clip.fadeIn,
              fadeOut: clip.fadeOut,
              mute: clip.mute,
            })),
          }
        : null,
      canUndo,
      canRedo,
    }),
    play: async () => {
      if (engine.playing) return;
      await engine.play();
      setPlaying(engine.playing);
    },
    stop: () => {
      if (!engine.playing) return;
      engine.stop();
      setPlaying(false);
    },
    playing: () => engine.playing,
    contextRunning: () => Tone.getContext().state === 'running',
    setBpm,
    fire: (id) => engine.fire(id),
    patchRegion: (id, patch) =>
      setNodes((current) =>
        current.map((node) =>
          node.id === id && isRegion(node)
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...(patch.mix ? { mix: { ...node.data.mix, ...patch.mix } } : {}),
                  ...(patch.fx ? { fx: { ...node.data.fx, ...patch.fx } } : {}),
                  ...(patch.groove ? { groove: { ...node.data.groove, ...patch.groove } } : {}),
                },
              }
            : node,
        ),
      ),
    moveBlock: (id, x, y) => setNodes((current) => current.map((node) => (node.id === id && isBlock(node) ? { ...node, position: { x, y } } : node))),
    setLinkBends: (id, bends) => setEdges((current) => current.map((edge) => (edge.id === id ? { ...edge, data: { ...edge.data, bends } } : edge))),
    addBlock: (block) => {
      const data = blockFields(block);
      const frame = patternFrame(data);
      const node: BlockNode = { id: block.id, type: 'block', position: { x: block.x, y: block.y }, data, ...(frame ?? {}) };
      setNodes((current) => [...current, node]);
    },
    putBlock: (block) => {
      const data = blockFields(block);
      const frame = patternFrame(data);
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== block.id || !isBlock(node)) return node;
          const { measured: _measured, width: _width, height: _height, ...rest } = node;
          return frame
            ? { ...rest, position: { x: block.x, y: block.y }, data, width: frame.width, height: frame.height }
            : { ...rest, position: { x: block.x, y: block.y }, data };
        }),
      );
    },
    addLink: (link) =>
      setEdges((current) => [
        ...current,
        { id: link.id, type: 'link', source: link.from, target: link.to, data: { bends: link.bends, ...(link.code ? { code: link.code } : {}) } },
      ]),
    putLink: (link) =>
      setEdges((current) =>
        current.map((edge) => (edge.id === link.id ? { ...edge, data: { bends: link.bends, ...(link.code ? { code: link.code } : {}) } } : edge)),
      ),
    addRegion: (region) => {
      const node = regionNode(region.id, { x: region.x, y: region.y, w: region.w, h: region.h }, {
        name: region.name,
        scaleId: region.scaleId || scaleId,
        rootHz: region.rootHz || rootHz,
        mix: region.mix,
        fx: region.fx,
        groove: region.groove,
        ...(region.key ? { key: region.key } : {}),
      });
      setNodes((current) => [...current, node]);
    },
    placeRegion: (region) => {
      const current = nodes.find((node) => node.id === region.id);
      if (!current || !isRegion(current)) return;
      const dx = region.x - current.position.x;
      const dy = region.y - current.position.y;
      const moving = new Set(regionContents(nodes, current).map((node) => node.id));
      const carried = new Set(waves.filter((wave) => regionAt([current], waveCenter(wave.points))).map((wave) => wave.id));
      setNodes((list) =>
        list.map((node) => {
          if (node.id === region.id && isRegion(node)) {
            const data = { ...node.data, name: region.name ?? node.data.name };
            if (region.scaleId) data.scaleId = region.scaleId;
            if (typeof region.rootHz === 'number') data.rootHz = region.rootHz;
            if (region.key === null) delete data.key;
            else if (region.key) data.key = region.key;
            return { ...node, position: { x: region.x, y: region.y }, width: region.w, height: region.h, data };
          }
          if (moving.has(node.id)) return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } };
          return node;
        }),
      );
      if (dx || dy) {
        setWaves((list) => list.map((wave) => (carried.has(wave.id) ? { ...wave, points: wave.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) } : wave)));
      }
    },
    drop: (gone) => {
      const blocks = new Set(gone.blockIds);
      const links = new Set(gone.linkIds);
      const regions = new Set(gone.regionIds);
      const goneWaves = new Set(gone.waveIds);
      setNodes((list) => list.filter((node) => !blocks.has(node.id) && !regions.has(node.id)));
      setEdges((list) => list.filter((edge) => !links.has(edge.id) && !blocks.has(edge.source) && !blocks.has(edge.target)));
      setWaves((list) => list.filter((wave) => !goneWaves.has(wave.id)));
    },
    tune: (tuning) => {
      if (tuning.scaleId) setScaleId(tuning.scaleId);
      if (typeof tuning.rootHz === 'number') setRootHz(tuning.rootHz);
      if (typeof tuning.snap === 'boolean') setSnap(tuning.snap);
    },
    addWave: (wave) => setWaves((list) => [...list, wave]),
    putWave: (wave) => setWaves((list) => list.map((item) => (item.id === wave.id ? wave : item))),
    putMachine: (machine) =>
      setMachinesState((list) => {
        const next: SynthMachine = { ...machine, hint: machine.hint ?? '' };
        return list.some((item) => item.id === machine.id) ? list.map((item) => (item.id === machine.id ? next : item)) : [...list, next];
      }),
    dropMachine: removeMachine,
    playNotes: async ({ instrument, notes }) => {
      if (Tone.getContext().state !== 'running') {
        try {
          await Tone.start();
        } catch {
          return 'Press Play in the browser once so it can make sound. After that, the deck can start and stop on its own.';
        }
      }
      if (Tone.getContext().state !== 'running') return 'Press Play in the browser once so it can make sound. After that, the deck can start and stop on its own.';
      const seconds = (60 / bpm) * 1000;
      for (const note of notes) {
        window.setTimeout(() => {
          const id = engine.attack({ id: 'instrument', x: 0, y: 0, kind: instrument as BlockKind, degree: note.degree, every: 0, scale, rootHz }, note.velocity);
          window.setTimeout(() => engine.release(id), note.beats * seconds);
        }, note.at * seconds);
      }
      return null;
    },
    recordStart: async () => {
      if (Tone.getContext().state !== 'running') {
        try {
          await Tone.start();
        } catch {
          return 'Press Play in the browser once so it can make sound. After that, the deck can record.';
        }
      }
      if (Tone.getContext().state !== 'running') return 'Press Play in the browser once so it can make sound. After that, the deck can record.';
      try {
        await engine.startRecording();
      } catch (err) {
        return err instanceof Error ? err.message : "Couldn't start recording.";
      }
      setRecording(true);
      setRecordedSeconds(0);
      if (!engine.playing) {
        await engine.play();
        setPlaying(engine.playing);
      }
      return null;
    },
    recordStop: async () => {
      const wav = await engine.stopRecording();
      setRecording(false);
      if (wav) download(wav, datedName('wav'));
    },
    saveTake,
    placeTake,
    newCanvas: (name) => {
      let failed: string | null = null;
      flushSync(() => {
        failed = makeCanvas(name);
      });
      if (!failed) toast('success', name, 'The canvas you had stays in the list.');
      return failed;
    },
    openCanvas: (id) => {
      if (!canvases.some((canvas) => canvas.id === id)) return 'That canvas is no longer in the list.';
      flushSync(() => openCanvas(id));
      return null;
    },
    renameCanvas,
    deleteCanvas: (id) => {
      const canvas = canvases.find((item) => item.id === id);
      if (!canvas) return 'That canvas is no longer in the list.';
      flushSync(() => removeCanvas(id));
      toast('info', `Deleted ${canvas.name}`, canvases.length === 1 ? 'A blank canvas takes its place.' : 'The other canvases stay.');
      return null;
    },
    openExample: (id) => {
      const example = EXAMPLES.find((item) => item.id === id);
      if (!example) return 'That example is no longer here.';
      flushSync(() => openExample(example));
      return null;
    },
    undo: () => {
      if (!canUndo) return 'Nothing to undo.';
      flushSync(() => undo());
      return null;
    },
    redo: () => {
      if (!canRedo) return 'Nothing to redo.';
      flushSync(() => redo());
      return null;
    },
    setBed,
    regionSample: async (id, sample) => {
      if (sample) {
        try {
          await engine.loadSample(sample.id);
        } catch (err) {
          return err instanceof Error ? err.message : 'That sample is not in this browser.';
        }
      }
      setNodes((list) =>
        list.map((node) => {
          if (node.id !== id || !isRegion(node)) return node;
          const data = { ...node.data };
          if (sample) data.sample = sample;
          else delete data.sample;
          return { ...node, data };
        }),
      );
      return null;
    },
  });

  return (
    <SettingsContext.Provider value={settings}>
      <div className="app">
        <TopBar
          route={route}
          canvasId={canvasId}
          canvasName={canvasName}
          playing={playing}
          recording={recording}
          recordedSeconds={recordedSeconds}
          bpm={bpm}
          snap={snap}
          canUndo={canUndo}
          canRedo={canRedo}
          fileMenu={fileMenu}
          onTogglePlay={() => void togglePlay()}
          onToggleRecording={() => void toggleRecording()}
          onBpm={setBpm}
          onSnap={setSnap}
          onUndo={undo}
          onRedo={redo}
          onShare={() => void share()}
          onClear={() => void newPiece()}
          deck={deck}
        />
        <input
          ref={openFileRef}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Piece file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void openFile(file);
          }}
        />

        <div className={`workspace${selectedNode || selectedLink || waveInfo ? ' has-selection' : ''}`}>
          {canvasId === null ? null : (
          <CanvasPage
            mode={route === 'waves' ? 'waves' : 'canvas'}
            parked={route !== 'canvas' && route !== 'waves'}
            wrapperRef={wrapperRef}
            nodes={nodes}
            edges={edges}
            waves={waves}
            selectedWaveId={selectedWaveId}
            pencil={pencil}
            playing={playing}
            snap={snap}
            bpm={bpm}
            stats={stats}
            cycle={cycle}
            loops={loops}
            blockPositions={blockPositions}
            engine={engine}
            selectedBlock={selectedBlock}
            blockTuning={blockTuning || undefined}
            selectedRegion={selectedRegion}
            selectedLink={selectedLink}
            waveInfo={waveInfo || undefined}
            machines={machines}
            onCreateMachine={addMachine}
            onEditMachine={editMachine}
            rootHz={rootHz}
            scaleId={scaleId}
            counts={{ blocks: nodes.filter(isBlock).length, links: edges.length, regions: nodes.filter(isRegion).length, waves: waves.length }}
            canvasName={canvasName}
            bindings={bindings}
            takenKeys={takenKeys}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={() => (carried.current = null)}
            onPaneDoubleClick={onPaneDoubleClick}
            onPaneClick={() => setSelectedWaveId(null)}
            onFlowSelect={() => setSelectedWaveId(null)}
            onSelectWave={(id) => {
              setSelectedWaveId(id);
              if (id) clearFlowSelection();
            }}
            onWavePoints={(id, points) => setWaves((ws) => ws.map((w) => (w.id === id ? { ...w, points } : w)))}
            onCreateWave={(points) => addWave('cycle', points)}
            onPencil={() => setPencil((on) => !on)}
            onAdd={addFromToolbar}
            onAddPattern={addPattern}
            onAddRegion={addRegion}
            onStamp={addStamp}
            onChangeBlock={updateBlock}
            onLinkCode={setLinkCode}
            onLinkLength={setLinkLength}
            onRegionChange={updateRegion}
            onLoadSample={(id, file) => void loadSample(id, file)}
            onImportScale={importScale}
            onRemoveScale={(id) => void removeScale(id)}
            onFire={(id) => engine.fire(id)}
            onStraighten={straightenSelection}
            onWaveRole={(role) => selectedWave && setWaves((ws) => ws.map((w) => (w.id === selectedWave.id ? { ...w, role } : w)))}
            onWaveInstrument={(instrument) =>
              selectedWave &&
              setWaves((ws) =>
                ws.map((w) => {
                  if (w.id !== selectedWave.id) return w;
                  if (!instrument) {
                    const next = { ...w };
                    delete next.instrument;
                    return next;
                  }
                  return { ...w, instrument };
                }),
              )
            }
            onDelete={() => {
              if (!selectedWave) {
                deleteSelection();
                return;
              }
              setWaves((ws) => ws.filter((w) => w.id !== selectedWave.id));
              setSelectedWaveId(null);
            }}
            onRoot={setRootHz}
            onScale={setScaleId}
            bed={bed}
            bedPeaks={bedPeaks}
            bedMissing={bedMissing}
            onBed={setBed}
            onLoadBed={(file) => void loadBed(file)}
            onLoadUrl={loadYouTube}
          />
          )}

          {route === 'canvases' && (
            <CanvasesPage canvases={canvases} currentId={canvasId} onOpen={openCanvas} onCreate={makeCanvas} onRename={renameCanvas} onDelete={(id) => void deleteCanvas(id)} />
          )}
          {route === 'examples' && <ExamplesPage onOpen={openExample} />}
          {route === 'guide' && <GuidePage />}
          {route === 'instruments' && (
            <InstrumentsPage
              bpm={bpm}
              snap={snap}
              scale={scale}
              rootHz={rootHz}
              takes={takes}
              onAttack={attackInstrument}
              onRelease={releaseInstrument}
              onSaveTake={saveTake}
              onPlace={placeTake}
            />
          )}
          {route === 'synth' && (
            <SynthPage
              bpm={bpm}
              snap={snap}
              scale={scale}
              rootHz={rootHz}
              machines={machines}
              takes={takes}
              onAdd={addMachine}
              onEdit={editMachine}
              onRemove={removeMachine}
              onAttack={attackInstrument}
              onRelease={releaseInstrument}
              onSaveTake={saveTake}
              onPlace={placeTake}
            />
          )}
        </div>
        <ToastHost />
        <ConfirmHost />
      </div>
    </SettingsContext.Provider>
  );
}
