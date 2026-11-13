import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
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
import { BlockNodeView } from './canvas/BlockNode';
import { LinkEdgeView, LinkPreview } from './canvas/LinkEdge';
import { PulseLayer } from './canvas/PulseLayer';
import { AddDock, ZoomControls, type Layer } from './canvas/CanvasControls';
import { LoopLabels } from './canvas/LoopLabels';
import { RegionNodeView } from './canvas/RegionNode';
import { WaveLayer } from './canvas/WaveLayer';
import { Engine } from './engine/engine';
import { ExamplesPage } from './ExamplesPage';
import { InstrumentsPage } from './InstrumentsPage';
import { BLOCK_SIZE, GRID, PX_PER_BEAT, fitLength, formatBeats, linkBeats, linkPath, type XY } from './engine/geometry';
import { isMelodic, type BlockKind } from './engine/scheduler';
import { DEFAULT_SCALE_ID, SCALES, scaleById, type Scale, type Tuning } from './engine/tuning';
import { GuidePage } from './GuidePage';
import { Inspector } from './Inspector';
import type { Example } from './examples';
import {
  bendsCarriedBy,
  bendsOf,
  carryBends,
  emptyPiece,
  isBlock,
  isRegion,
  hasSavedPiece,
  loadPiece,
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
import { findLoops } from './loops';
import { PiecePanel } from './PiecePanel';
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
import { useRoute } from './ui/route';
import { ConfirmHost, confirmDialog } from './ui/Confirm';
import { ToastHost, toast } from './ui/Toast';
import { storeSample } from './engine/samples';
import { MAX_RECORD_SECONDS } from './engine/recorder';
import { useHistory } from './history';
import { datedName, decodeShare, download, encodeShare, pieceFromFile, pieceToFile, sharedCode, shareUrl } from './share';
import { layoutTake, MAX_TAKES, type Take } from './takes';

const nodeTypes = { block: BlockNodeView, region: RegionNodeView };
const edgeTypes = { link: LinkEdgeView };
const SAMPLES_STAY = "Samples don't travel in links: whoever opens it hears the synth in their place. Save a file to send them too.";

/** Focus is somewhere keys type text, so shortcuts should leave them alone. */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('input[type="text"], input[type="number"], select, textarea');

export function App() {
  return (
    <ReactFlowProvider>
      <Studio />
    </ReactFlowProvider>
  );
}

function Studio() {
  // Read before the first autosave, to tell a first visit from returning work.
  const [hadSavedWork] = useState(hasSavedPiece);
  const [initial] = useState(loadPiece);
  const [nodes, setNodes, onNodesChange] = useNodesState(toNodes(initial));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toEdges(initial));
  const [waves, setWaves] = useState<Wave[]>(initial.waves ?? []);
  const [takes, setTakes] = useState<Take[]>(initial.takes ?? []);
  const [layer, setLayer] = useState<Layer>('beats');
  const [pencil, setPencil] = useState(false);
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(null);
  const [bpm, setBpm] = useState(initial.bpm);
  const [snap, setSnap] = useState(initial.snap);
  const [scaleId, setScaleId] = useState(initial.scaleId);
  const [rootHz, setRootHz] = useState(initial.rootHz);
  const [importedScales, setImportedScales] = useState(initial.scales);
  const [playing, setPlaying] = useState(false);
  const [route, go] = useRoute();
  const [recording, setRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const openFileRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState({ pulses: 0, overflow: false, beat: 0 });
  const [engine] = useState(() => new Engine());
  const { screenToFlowPosition, deleteElements, fitView } = useReactFlow<CanvasNode, LinkEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const scales = useMemo(() => [...SCALES, ...importedScales], [importedScales]);
  const scale = useMemo(() => scaleById(scaleId, scales), [scaleId, scales]);
  const canvas = useMemo<Tuning>(() => ({ scale, rootHz }), [scale, rootHz]);
  const settings = useMemo(() => ({ canvas, scales, snap }), [canvas, scales, snap]);

  // The canvas is the source of truth; the engine follows it.
  useEffect(() => engine.setGraph(toGraph(nodes, canvas, scales), toGraphLinks(edges)), [engine, nodes, edges, canvas, scales]);
  // Bus settings change rarely, but nodes change on every drag frame; key the
  // engine update on the settings themselves.
  const busKey = useMemo(() => JSON.stringify([...toBuses(nodes)]), [nodes]);
  useEffect(() => engine.setBuses(new Map(JSON.parse(busKey))), [engine, busKey]);
  useEffect(() => engine.setSnap(snap), [engine, snap]);
  useEffect(() => engine.setBpm(bpm), [engine, bpm]);
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
    const timer = setTimeout(
      () => savePiece(toPiece(nodes, edges, { bpm, snap, scaleId, rootHz, scales: importedScales }, waves, takes)),
      400,
    );
    return () => clearTimeout(timer);
  }, [nodes, edges, waves, takes, bpm, snap, scaleId, rootHz, importedScales]);

  // Everything undoable is in the piece; selection and view are not.
  const pieceJson = useMemo(
    () => JSON.stringify(toPiece(nodes, edges, { bpm, snap, scaleId, rootHz, scales: importedScales }, waves, takes)),
    [nodes, edges, waves, takes, bpm, snap, scaleId, rootHz, importedScales],
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
      const node: BlockNode = { id: newId('b'), type: 'block', position, data, selected: true };
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
    if (layer === 'waves') return;
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
    setNodes((ns) => ns.map((n) => (n.id === id && isBlock(n) ? { ...n, data } : n)));
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
      const beats = linkBeats(linkPath(a.position, b.position, bends, 0).len, snap);
      const minBeats = linkPath(a.position, b.position, [], 0).len / PX_PER_BEAT;
      selectedLink = { beats, minBeats, bends: bends.length, code: selectedEdge.data?.code ?? '' };
    }
  }

  // Bends the selected link to an exact length, keeping both blocks where they are.
  const setLinkLength = (beats: number) => {
    const a = selectedEdge && nodes.find((n) => n.id === selectedEdge.source);
    const b = selectedEdge && nodes.find((n) => n.id === selectedEdge.target);
    if (!selectedEdge || !a || !b) return;
    const bends = fitLength(a.position, b.position, bendsOf(selectedEdge), beats * PX_PER_BEAT);
    if (bends) setEdges((es) => es.map((e) => (e.id === selectedEdge.id ? { ...e, data: { ...e.data, bends } } : e)));
  };

  const blockPositions = useMemo(() => nodes.filter(isBlock).map((n) => n.position), [nodes]);
  const loops = useMemo(() => {
    const positions = new Map(nodes.filter(isBlock).map((n) => [n.id, n.position]));
    const links = edges.flatMap((e) => {
      const a = positions.get(e.source);
      const b = positions.get(e.target);
      return a && b ? [{ source: e.source, target: e.target, beats: linkBeats(linkPath(a, b, bendsOf(e), 0).len, snap) }] : [];
    });
    return findLoops(positions, links);
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
    setSelectedWaveId(null);
    setBpm(piece.bpm);
    setSnap(piece.snap);
    setScaleId(piece.scaleId);
    setRootHz(piece.rootHz);
    for (const s of piece.scales) importScale(s);
    setTimeout(() => void fitView({ padding: 0.25, duration: 300 }), 50);
  };

  const currentPiece = () => toPiece(nodes, edges, { bpm, snap, scaleId, rootHz, scales: importedScales }, waves, takes);

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
    go('canvas');
    replaceWith(example.piece);
    toast('success', example.title, 'Loaded. Press play, or Space, to hear it.');
  };

  const newPiece = async () => {
    const ok = await confirmDialog({
      title: 'Start a new piece?',
      message: `Every block, link, region, wave, and take goes away. ${MOD}Z brings them back.`,
      confirmLabel: 'New piece',
      danger: true,
    });
    if (ok) replaceWith(emptyPiece({ bpm, snap, scaleId, rootHz, scales: importedScales }));
  };

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
  const shortcuts = useRef({ save, openFile: () => openFileRef.current?.click(), go, route, perform });
  shortcuts.current = { save, openFile: () => openFileRef.current?.click(), go, route, perform };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const { current } = shortcuts;
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 's') void current.save();
      else if ((e.metaKey || e.ctrlKey) && key === 'o') current.openFile();
      else if (e.key === '?' && !e.metaKey && !e.ctrlKey) current.go('guide');
      else if (e.key === 'Escape' && current.route !== 'canvas' && !document.querySelector('.confirm, .menu-list, .select-list')) current.go('canvas');
      else if (current.route === 'instruments' || e.metaKey || e.ctrlKey || e.repeat || !current.perform(key)) return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const playInstrument = useCallback(
    (kind: string, degree: number) => {
      void engine.audition({ id: 'instrument', x: 0, y: 0, kind: kind as BlockKind, degree, every: 0, scale, rootHz });
    },
    [engine, scale, rootHz],
  );

  const saveTake = useCallback((take: Take) => {
    setTakes((current) => [...current, take].slice(-MAX_TAKES));
  }, []);

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
      go('canvas');
      setTimeout(() => void fitView({ padding: 0.25, duration: 300 }), 50);
    },
    [nodes, setNodes, setEdges, go, fitView],
  );

  useEffect(() => {
    const page = route === 'canvas' ? '' : `${route[0].toUpperCase()}${route.slice(1)} · `;
    document.title = `${page}Pulse Canvas`;
  }, [route]);

  return (
    <SettingsContext.Provider value={settings}>
      <div className="app">
        <TopBar
          route={route}
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
          <div className={`stage${layer === 'waves' ? ' is-waves' : ''}${layer === 'waves' && pencil ? ' is-drawing' : ''}`} ref={wrapperRef}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              connectionLineComponent={LinkPreview}
              onNodeDoubleClick={onNodeDoubleClick}
              onPaneClick={() => setSelectedWaveId(null)}
              onNodeClick={() => setSelectedWaveId(null)}
              onEdgeClick={() => setSelectedWaveId(null)}
              panOnDrag={layer === 'waves' && pencil ? [1, 2] : true}
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={() => (carried.current = null)}
              onDoubleClick={onPaneDoubleClick}
              nodeOrigin={[0.5, 0.5]}
              connectOnClick={false}
              zoomOnDoubleClick={false}
              panActivationKeyCode={null}
              deleteKeyCode={['Backspace', 'Delete']}
              defaultEdgeOptions={{ type: 'link' }}
              minZoom={0.25}
              maxZoom={2.5}
              fitView
              fitViewOptions={{ padding: 0.25 }}
              colorMode="dark"
            >
              <Background variant={BackgroundVariant.Dots} gap={PX_PER_BEAT * GRID} size={1.4} color="#2a2e39" />
              <LoopLabels loops={loops} blocks={blockPositions} />
              <WaveLayer
                waves={waves}
                selectedId={selectedWaveId}
                snap={snap}
                drawing={layer === 'waves' && pencil}
                ghost={layer !== 'waves'}
                engine={engine}
                onSelect={(id) => {
                  setSelectedWaveId(id);
                  if (id) clearFlowSelection();
                }}
                onPoints={(id, points) => setWaves((ws) => ws.map((w) => (w.id === id ? { ...w, points } : w)))}
                onCreate={(points) => addWave('cycle', points)}
              />
              <PulseLayer engine={engine} />
              <AddDock
                layer={layer}
                pencil={pencil}
                onLayer={(next) => {
                  setLayer(next);
                  setPencil(next === 'waves');
                }}
                onPencil={() => setPencil((on) => !on)}
                onAdd={addFromToolbar}
                onAddRegion={addRegion}
                onStamp={addStamp}
              />
              <ZoomControls />
              {playing && (
                <Panel position="top-left" className={`status${stats.overflow ? ' warn' : ''}`}>
                  <span className="status-dot" aria-hidden="true" />
                  {stats.pulses} {stats.pulses === 1 ? 'pulse' : 'pulses'} in flight
                  {cycle.kind === 'repeats' && ` · beat ${Math.floor(stats.beat % cycle.beats) + 1} of ${formatBeats(cycle.beats, true)}`}
                  {stats.overflow && ' · limit reached, extra pulses dropped'}
                </Panel>
              )}
            </ReactFlow>
          </div>

          <aside className="sidebar" aria-label={selectedNode || selectedLink || waveInfo ? 'Selection' : 'Piece'}>
            {selectedNode || selectedLink || waveInfo ? (
              <Inspector
                node={selectedBlock}
                nodeTuning={blockTuning}
                region={selectedRegion}
                link={selectedLink}
                wave={waveInfo || undefined}
                playing={playing}
                onChange={updateBlock}
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
                takenKeys={takenKeys}
              />
            ) : (
              <PiecePanel
                rootHz={rootHz}
                scaleId={scaleId}
                counts={{ blocks: nodes.filter(isBlock).length, links: edges.length, regions: nodes.filter(isRegion).length, waves: waves.length }}
                loops={loops}
                cycle={cycle}
                bpm={bpm}
                bindings={bindings}
                onRoot={setRootHz}
                onScale={setScaleId}
                onImportScale={importScale}
                onRemoveScale={(id) => void removeScale(id)}
              />
            )}
          </aside>

          {route === 'examples' && <ExamplesPage onOpen={openExample} />}
          {route === 'guide' && <GuidePage />}
          {route === 'instruments' && (
            <InstrumentsPage
              bpm={bpm}
              snap={snap}
              scale={scale}
              rootHz={rootHz}
              takes={takes}
              onPlay={playInstrument}
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
