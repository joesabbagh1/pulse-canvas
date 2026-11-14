import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  type IsValidConnection,
  type NodeMouseHandler,
  type OnConnect,
  type OnConnectEnd,
  type OnEdgesChange,
  type OnNodeDrag,
  type OnNodesChange,
} from '@xyflow/react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import type { Bed } from './bed';
import { BedLane } from './BedLane';
import { BlockNodeView } from './canvas/BlockNode';
import { AddDock, ZoomControls } from './canvas/CanvasControls';
import { LinkEdgeView, LinkPreview } from './canvas/LinkEdge';
import { RegionNodeView } from './canvas/RegionNode';
import { LoopLabels } from './canvas/LoopLabels';
import { PulseLayer } from './canvas/PulseLayer';
import { ScopePanel } from './canvas/ScopePanel';
import { WaveLayer } from './canvas/WaveLayer';
import type { Cycle } from './cycle';
import type { Engine } from './engine/engine';
import { GRID, PX_PER_BEAT, formatBeats, type XY } from './engine/geometry';
import type { BlockKind } from './engine/scheduler';
import type { Scale } from './engine/tuning';
import type { Stamp, Wave, WaveRole } from './engine/wave';
import { Inspector } from './Inspector';
import type { Loop } from './loops';
import { PiecePanel } from './PiecePanel';
import type { BlockData, BlockNode, CanvasNode, LinkEdge, RegionData, RegionNode } from './piece';

const nodeTypes = { block: BlockNodeView, region: RegionNodeView };
const edgeTypes = { link: LinkEdgeView };

export type PiecePage = 'canvas' | 'waves';

interface Props {
  /** Canvas composes notes and time. Waves only draws the synth. */
  mode: PiecePage;
  /** Another page is open, so this one stays mounted but out of the way. */
  parked: boolean;
  wrapperRef: RefObject<HTMLDivElement | null>;
  nodes: CanvasNode[];
  edges: LinkEdge[];
  waves: Wave[];
  selectedWaveId: string | null;
  pencil: boolean;
  playing: boolean;
  snap: boolean;
  bpm: number;
  stats: { pulses: number; overflow: boolean; beat: number };
  cycle: Cycle;
  loops: Loop[];
  blockPositions: XY[];
  engine: Engine;
  selectedBlock?: BlockNode;
  blockTuning?: { tuning: { scale: Scale; rootHz: number }; region?: string };
  selectedRegion?: RegionNode;
  selectedLink?: { beats: number; minBeats: number; bends: number; code: string };
  waveInfo?: { role: WaveRole; beats: number; place: string | null; heard: boolean; sampled: boolean; points: number; instrument: string };
  rootHz: number;
  scaleId: string;
  counts: { blocks: number; links: number; regions: number; waves: number };
  canvasName: string;
  bindings: { key: string; id: string; mute: boolean; does: string }[];
  takenKeys: ReadonlyMap<string, string>;
  onNodesChange: OnNodesChange<CanvasNode>;
  onEdgesChange: OnEdgesChange<LinkEdge>;
  onConnect: OnConnect;
  onConnectEnd: OnConnectEnd;
  isValidConnection: IsValidConnection<LinkEdge>;
  onNodeDoubleClick: NodeMouseHandler<CanvasNode>;
  onNodeDragStart: OnNodeDrag<CanvasNode>;
  onNodeDrag: OnNodeDrag<CanvasNode>;
  onNodeDragStop: () => void;
  onPaneDoubleClick: (event: ReactMouseEvent) => void;
  onPaneClick: () => void;
  onFlowSelect: () => void;
  onSelectWave: (id: string | null) => void;
  onWavePoints: (id: string, points: XY[]) => void;
  onCreateWave: (points: XY[]) => void;
  onPencil: () => void;
  onAdd: (kind: BlockKind) => void;
  onAddPattern: () => void;
  onAddRegion: () => void;
  onStamp: (stamp: Stamp) => void;
  onChangeBlock: (id: string, patch: Partial<BlockData>) => void;
  onLinkCode: (code: string) => void;
  onLinkLength: (beats: number) => void;
  onRegionChange: (id: string, patch: Partial<RegionData>) => void;
  onLoadSample: (regionId: string, file: File) => void;
  onImportScale: (scale: Scale) => void;
  onRemoveScale: (id: string) => void;
  onFire: (id: string) => void;
  onStraighten: () => void;
  onWaveRole: (role: WaveRole) => void;
  onWaveInstrument: (instrument: string) => void;
  onDelete: () => void;
  onRoot: (hz: number) => void;
  onScale: (scaleId: string) => void;
  bed: Bed | null;
  bedPeaks: Float32Array | null;
  bedMissing: boolean;
  onBed: (bed: Bed | null) => void;
  onLoadBed: (file: File) => void;
}

/**
 * The piece, on the page whose job is open. Canvas places blocks, links and
 * regions. Waves draws cycles and filter motions on that same space, because a
 * drawing belongs to the region under its middle. Other pages park this view
 * so it is not the background of everything else.
 */
export function CanvasPage(props: Props) {
  const waves = props.mode === 'waves';
  const open = !!(props.selectedBlock || props.selectedRegion || props.selectedLink || props.waveInfo);
  return (
    <>
      <div
        className={`stage${waves ? ' is-waves' : ''}${waves && props.pencil ? ' is-drawing' : ''}${props.parked ? ' is-parked' : ''}`}
        aria-hidden={props.parked}
        inert={props.parked}
      >
        <div className="stage-flow" ref={props.wrapperRef}>
        <ReactFlow
          nodes={props.nodes}
          edges={props.edges}
          onNodesChange={props.onNodesChange}
          onEdgesChange={props.onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onConnect={props.onConnect}
          onConnectEnd={props.onConnectEnd}
          isValidConnection={props.isValidConnection}
          connectionLineComponent={LinkPreview}
          onNodeDoubleClick={props.onNodeDoubleClick}
          onPaneClick={props.onPaneClick}
          onNodeClick={props.onFlowSelect}
          onEdgeClick={props.onFlowSelect}
          nodesConnectable={!waves}
          panOnDrag={waves && props.pencil ? [1, 2] : true}
          onNodeDragStart={props.onNodeDragStart}
          onNodeDrag={props.onNodeDrag}
          onNodeDragStop={props.onNodeDragStop}
          onDoubleClick={waves ? undefined : props.onPaneDoubleClick}
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
          <LoopLabels loops={props.loops} blocks={props.blockPositions} />
          <WaveLayer
            waves={props.waves}
            selectedId={props.selectedWaveId}
            snap={props.snap}
            drawing={waves && props.pencil}
            ghost={!waves}
            engine={props.engine}
            onSelect={props.onSelectWave}
            onPoints={props.onWavePoints}
            onCreate={props.onCreateWave}
          />
          <PulseLayer engine={props.engine} />
          <AddDock
            waves={waves}
            pencil={props.pencil}
            onPencil={props.onPencil}
            onAdd={props.onAdd}
            onAddPattern={props.onAddPattern}
            onAddRegion={props.onAddRegion}
            onStamp={props.onStamp}
          />
          <ZoomControls />
          <Panel position="bottom-left" className="scope-dock">
            <ScopePanel engine={props.engine} />
          </Panel>
          {props.playing && (
            <Panel position="top-left" className={`status${props.stats.overflow ? ' warn' : ''}`}>
              <span className="status-dot" aria-hidden="true" />
              {props.stats.pulses} {props.stats.pulses === 1 ? 'pulse' : 'pulses'} in flight
              {props.cycle.kind === 'repeats' && ` · beat ${Math.floor(props.stats.beat % props.cycle.beats) + 1} of ${formatBeats(props.cycle.beats, true)}`}
              {props.stats.overflow && ' · limit reached, extra pulses dropped'}
            </Panel>
          )}
        </ReactFlow>
        </div>
        {!props.parked && (
          <BedLane
            bed={props.bed}
            peaks={props.bedPeaks}
            missing={props.bedMissing}
            bpm={props.bpm}
            snap={props.snap}
            playing={props.playing}
            engine={props.engine}
            onChange={props.onBed}
            onLoad={props.onLoadBed}
          />
        )}
      </div>

      <aside className={`sidebar${props.parked ? ' is-parked' : ''}`} aria-hidden={props.parked} inert={props.parked} aria-label={open ? 'Selection' : 'Piece'}>
        {open ? (
          <Inspector
            node={props.selectedBlock}
            nodeTuning={props.blockTuning}
            region={props.selectedRegion}
            link={props.selectedLink}
            wave={props.waveInfo}
            playing={props.playing}
            onChange={props.onChangeBlock}
            onLinkCode={props.onLinkCode}
            onLinkLength={props.onLinkLength}
            onRegionChange={props.onRegionChange}
            onLoadSample={props.onLoadSample}
            onImportScale={props.onImportScale}
            onRemoveScale={props.onRemoveScale}
            onFire={props.onFire}
            onStraighten={props.onStraighten}
            onWaveRole={props.onWaveRole}
            onWaveInstrument={props.onWaveInstrument}
            onDelete={props.onDelete}
            takenKeys={props.takenKeys}
          />
        ) : (
          <PiecePanel
            page={props.mode}
            rootHz={props.rootHz}
            scaleId={props.scaleId}
            counts={props.counts}
            canvasName={props.canvasName}
            loops={props.loops}
            cycle={props.cycle}
            bpm={props.bpm}
            bindings={props.bindings}
            onRoot={props.onRoot}
            onScale={props.onScale}
            onImportScale={props.onImportScale}
            onRemoveScale={props.onRemoveScale}
          />
        )}
      </aside>
    </>
  );
}
