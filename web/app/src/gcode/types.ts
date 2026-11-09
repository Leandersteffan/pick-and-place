import type { Vec3 } from '../model/spec'

export type MoveType = 'extrude' | 'travel' | 'pick' | 'place' | 'tamp' | 'prinjection' | 'wipe' | 'z_hop'
/** Index in this array is the value stored in MoveTable.type. */
export const MOVE_TYPES: readonly MoveType[] = ['extrude', 'travel', 'pick', 'place', 'tamp', 'prinjection', 'wipe', 'z_hop']

/** View object; storage is MoveTable. */
export interface Move {
  index: number
  segment: number
  layer: number
  type: MoveType
  from: Vec3
  to: Vec3
  /** relative mm of this Move */
  e: number
  /** mm/min */
  feedrate: number
  /** 1-based source line */
  line: number
  /** seconds */
  tStart: number
  /** seconds */
  duration: number
  /** part of a tessellated G2/G3 */
  arc: boolean
}

/** Struct of arrays, length n. */
export interface MoveTable {
  n: number
  x0: Float64Array; y0: Float64Array; z0: Float64Array
  x1: Float64Array; y1: Float64Array; z1: Float64Array
  e: Float32Array; f: Float32Array
  type: Uint8Array; segment: Uint8Array; layer: Uint16Array
  line: Uint32Array; tStart: Float64Array; duration: Float32Array; arc: Uint8Array
}

export type EventKind =
  | 'placement_group' | 'placing' | 'pnp_header' | 'pick_seq' | 'place_seq' | 'tamping' | 'prinjection' | 'wipe'
  | 'pause' | 'temperature' | 'temperature_wait' | 'fan' | 'dwell' | 'skipped_extrusion' | 'unknown_marker'

export interface GcodeEvent {
  kind: EventKind
  line: number
  /** first Move emitted after this line */
  moveIndex: number
  /** e.g. "Layer 11 Placement", "Placing PCB #3" */
  label: string
  data:
    | { kind: 'placement_group'; layer: number | null; variant: 'layer' | 'late' | 'fallback' }
    /** number is 1-based, part index = number - 1 */
    | { kind: 'placing'; partKind: string; number: number }
    | { kind: 'pnp_header'; partKind: string }
    | { kind: 'tamping'; count: number }
    | { kind: 'temperature'; tool: number; target: number; wait: boolean }
    | { kind: 'temperature_wait'; sensor: string; min?: number; max?: number }
    /** value 0..1 */
    | { kind: 'fan'; fan: 0; value: number }
    | { kind: 'dwell'; ms: number }
    | { kind: 'skipped_extrusion'; e: number; minTemp: number }
    | { kind: 'none' }
}

export interface Segment {
  /** 1-based */
  index: number
  firstMove: number
  lastMove: number
  firstLine: number
  lastLine: number
  /** over extrude Moves only */
  extrudeZMin: number
  extrudeZMax: number
  /** number of ;LAYER_CHANGE in this segment */
  layerCount: number
  duration: number
}

/** value[k] holds from moveIndex[k] until moveIndex[k+1]. */
export interface StepTrack { moveIndex: Uint32Array; value: Float32Array }

export interface ParseResult {
  moves: MoveTable
  events: GcodeEvent[]
  segments: Segment[]
  unhandled: number[]
  totalTime: number
  tempTrack: StepTrack
  fanTrack: StepTrack
  /**
   * `arcs`: extruding arc commands (G2/G3 source lines with E > 0), not tessellated pieces.
   * `helicalLifts`: G2/G3 source lines with no X/Y words (Orca's `G3 Z.. I.. J.. P1`).
   */
  stats: { lines: number; arcs: number; helicalLifts: number; timestampLine: number | null }
}

/** Builds a Move view object for row i of the table. */
export function getMove(table: MoveTable, i: number): Move {
  if (!Number.isInteger(i) || i < 0 || i >= table.n) {
    throw new RangeError(`move index ${i} out of range [0, ${table.n})`)
  }
  const type = MOVE_TYPES[table.type[i]]
  if (type === undefined) throw new RangeError(`unknown move type code ${table.type[i]} at index ${i}`)
  return {
    index: i,
    segment: table.segment[i],
    layer: table.layer[i],
    type,
    from: { x: table.x0[i], y: table.y0[i], z: table.z0[i] },
    to: { x: table.x1[i], y: table.y1[i], z: table.z1[i] },
    e: table.e[i],
    feedrate: table.f[i],
    line: table.line[i],
    tStart: table.tStart[i],
    duration: table.duration[i],
    arc: table.arc[i] !== 0,
  }
}
