// Toolpath geometry (design section 6; Requirements 6.1, 6.2, 6.4, 10.3).
//
// One THREE.LineSegments BufferGeometry for the whole file, built once per parse.
// Vertex 2i is the start of Move i, vertex 2i+1 its end, straight from the gcode
// (Bed_Space). Scrubbing only changes the draw range and, while playing, the end
// vertex of the current Move. No React here, so it runs under Vitest in Node.
import { BufferAttribute, BufferGeometry } from 'three'
import { MOVE_TYPES, type MoveTable, type MoveType } from '../gcode/types'

/**
 * Move_Type colours. Travel and z_hop are dim greys so they read thinner than
 * extrusion (line width is 1 px on most GPUs, so colour does the work).
 */
export const PALETTE: Record<MoveType, string> = {
  extrude: '#9fb4cc',
  travel: '#4f545b',
  pick: '#22d3ee',
  place: '#ff9f1c',
  tamp: '#ef4444',
  prinjection: '#22c55e',
  wipe: '#a855f7',
  z_hop: '#3a3d42',
}

export const MOVE_TYPE_LABELS: Record<MoveType, string> = {
  extrude: 'Extrude',
  travel: 'Travel',
  pick: 'Pick',
  place: 'Place',
  tamp: 'Tamp',
  prinjection: 'Prinjection',
  wipe: 'Wipe',
  z_hop: 'Z hop',
}

/** Legend rows in MOVE_TYPES order (index = MoveTable.type code). */
export const LEGEND: readonly { type: MoveType; label: string; color: string }[] = MOVE_TYPES.map((type) => ({
  type,
  label: MOVE_TYPE_LABELS[type],
  color: PALETTE[type],
}))

/** '#rrggbb' to [r, g, b] bytes. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`bad colour ${hex}`)
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

const PALETTE_RGB: [number, number, number][] = MOVE_TYPES.map((t) => hexToRgb(PALETTE[t]))

export interface ToolpathArrays {
  /** 6n: start xyz, end xyz per Move */
  position: Float32Array
  /** 6n: PALETTE[type] bytes, normalized */
  color: Uint8Array
  /** 2n: index into MOVE_TYPES */
  aType: Float32Array
  /** 2n: segment index, 1-based */
  aSeg: Float32Array
  /** 2n: layer within segment */
  aLayer: Float32Array
}

/** The vertex arrays for a Move table. Pure. */
export function buildToolpathArrays(moves: MoveTable): ToolpathArrays {
  const n = moves.n
  const position = new Float32Array(6 * n)
  const color = new Uint8Array(6 * n)
  const aType = new Float32Array(2 * n)
  const aSeg = new Float32Array(2 * n)
  const aLayer = new Float32Array(2 * n)
  for (let i = 0; i < n; i++) {
    const o = 6 * i
    position[o] = moves.x0[i]
    position[o + 1] = moves.y0[i]
    position[o + 2] = moves.z0[i]
    position[o + 3] = moves.x1[i]
    position[o + 4] = moves.y1[i]
    position[o + 5] = moves.z1[i]
    const rgb = PALETTE_RGB[moves.type[i]] ?? PALETTE_RGB[0]
    color[o] = color[o + 3] = rgb[0]
    color[o + 1] = color[o + 4] = rgb[1]
    color[o + 2] = color[o + 5] = rgb[2]
    const v = 2 * i
    aType[v] = aType[v + 1] = moves.type[i]
    aSeg[v] = aSeg[v + 1] = moves.segment[i]
    aLayer[v] = aLayer[v + 1] = moves.layer[i]
  }
  return { position, color, aType, aSeg, aLayer }
}

/** One BufferGeometry for the whole toolpath, drawn in full. */
export function buildToolpathGeometry(moves: MoveTable): BufferGeometry {
  const a = buildToolpathArrays(moves)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(a.position, 3))
  g.setAttribute('color', new BufferAttribute(a.color, 3, true))
  g.setAttribute('aType', new BufferAttribute(a.aType, 1))
  g.setAttribute('aSeg', new BufferAttribute(a.aSeg, 1))
  g.setAttribute('aLayer', new BufferAttribute(a.aLayer, 1))
  g.setDrawRange(0, 2 * moves.n)
  g.computeBoundingSphere()
  return g
}

/** Clamps a playhead to a Move index in [0, n - 1] (0 for an empty table). */
export function playheadIndex(playhead: number, n: number): number {
  if (n <= 0 || !Number.isFinite(playhead)) return 0
  return Math.min(n - 1, Math.max(0, Math.floor(playhead)))
}

/** Vertex count drawn for playhead p: Moves 0..p, i.e. `2 * (p + 1)`. */
export function drawCount(playhead: number, n: number): number {
  if (n <= 0) return 0
  return 2 * (playheadIndex(playhead, n) + 1)
}

/** Point at fraction `frac` (clamped to [0, 1]) along Move p. */
export function interpolatedPoint(moves: MoveTable, p: number, frac: number): [number, number, number] {
  const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 1))
  return [
    moves.x0[p] + (moves.x1[p] - moves.x0[p]) * f,
    moves.y0[p] + (moves.y1[p] - moves.y0[p]) * f,
    moves.z0[p] + (moves.z1[p] - moves.z0[p]) * f,
  ]
}

/**
 * Applies the playhead to a geometry from buildToolpathGeometry: sets the draw
 * range and, for frac < 1, moves the end vertex of Move p to the interpolated
 * point with one 3-float update range. The original end vertex is restored when
 * p changes or frac reaches 1. Returns the playhead marker point, or null for an
 * empty table.
 */
export class PlayheadPatch {
  /** Move whose end vertex currently holds an interpolated value, or -1. */
  private patched = -1

  constructor(
    private readonly geometry: BufferGeometry,
    private readonly moves: MoveTable,
  ) {}

  get patchedMove(): number {
    return this.patched
  }

  apply(playhead: number, frac = 1): [number, number, number] | null {
    const n = this.moves.n
    this.geometry.setDrawRange(0, drawCount(playhead, n))
    if (n === 0) return null
    const p = playheadIndex(playhead, n)
    const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 1))
    if (this.patched >= 0 && this.patched !== p) this.writeEnd(this.patched, interpolatedPoint(this.moves, this.patched, 1))
    const point = interpolatedPoint(this.moves, p, f)
    if (f < 1) {
      this.writeEnd(p, point)
      this.patched = p
    } else {
      if (this.patched === p) this.writeEnd(p, point)
      this.patched = -1
    }
    return point
  }

  private writeEnd(i: number, pt: [number, number, number]): void {
    const attr = this.geometry.getAttribute('position') as BufferAttribute
    const o = 3 * (2 * i + 1)
    const arr = attr.array as Float32Array
    arr[o] = pt[0]
    arr[o + 1] = pt[1]
    arr[o + 2] = pt[2]
    attr.addUpdateRange(o, 3)
    attr.needsUpdate = true
  }
}
