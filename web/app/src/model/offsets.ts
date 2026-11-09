// Bed_Space offsets (design section 4, Requirement 4.6).
//
// Bed = Design + offset. Picks and the tray use `tray`; places, tamps,
// prinjection, part meshes, traces and the housing use `model`.
//
// The mesh-bounds source is a port of `housing_clearance` and
// `shared_bed_shift` in Scripts/pipeline/geometry.py, combined the way
// Scripts/pipeline/run.py combines them on the Orca (U1) path.
import type { ParseResult } from '../gcode/types'
import type { BedOffsets, ImportWarning, XY } from './project'
import type { Spec, Vec3 } from './spec'

export type OffsetKind = 'pick' | 'tray' | 'model'

/** (minX, minY, maxX, maxY) of the raw vertices, like `geometry.mesh_bounds`. */
export type Bounds2 = readonly [number, number, number, number]

export const BED_MIN_X = 0.5
export const BED_MIN_Y = 1.0
export const BED_MAX_X = 270.5
export const BED_MAX_Y = 271.0
export const HOUSING_GAP_MM = 10.0

function offsetFor(kind: OffsetKind, offsets: Pick<BedOffsets, 'tray' | 'model'>): XY {
  return kind === 'model' ? offsets.model : offsets.tray
}

/** Design_Space point to Bed_Space. Z is unchanged. */
export function toBed<P extends Pick<Vec3, 'x' | 'y'>>(
  p: P,
  kind: OffsetKind,
  offsets: Pick<BedOffsets, 'tray' | 'model'>,
): P {
  const [dx, dy] = offsetFor(kind, offsets)
  return { ...p, x: p.x + dx, y: p.y + dy }
}

/** Bed_Space point to Design_Space; the inverse of `toBed`. */
export function toDesign<P extends Pick<Vec3, 'x' | 'y'>>(
  p: P,
  kind: OffsetKind,
  offsets: Pick<BedOffsets, 'tray' | 'model'>,
): P {
  const [dx, dy] = offsetFor(kind, offsets)
  return { ...p, x: p.x - dx, y: p.y - dy }
}

/** `geometry.housing_clearance`: how far to move the housing in +Y so it clears the tray. */
export function housingClearance(
  trayBounds: Bounds2 | null | undefined,
  modelBounds: Bounds2 | null | undefined,
  gap = HOUSING_GAP_MM,
): number {
  if (!trayBounds || !modelBounds) return 0.0
  const xApart = modelBounds[2] < trayBounds[0] || trayBounds[2] < modelBounds[0]
  if (xApart) return 0.0
  const needed = trayBounds[3] + gap - modelBounds[1]
  return needed > 0.0 ? needed : 0.0
}

/** `geometry.shared_bed_shift`: one nudge that keeps every footprint on the bed, or null. */
export function sharedBedShift(bounds: readonly Bounds2[]): XY | null {
  const minx = Math.min(...bounds.map((b) => b[0]))
  const miny = Math.min(...bounds.map((b) => b[1]))
  const maxx = Math.max(...bounds.map((b) => b[2]))
  const maxy = Math.max(...bounds.map((b) => b[3]))
  let dx = minx < BED_MIN_X ? BED_MIN_X - minx : 0.0
  let dy = miny < BED_MIN_Y ? BED_MIN_Y - miny : 0.0
  if (maxx + dx > BED_MAX_X) dx = BED_MAX_X - maxx
  if (maxy + dy > BED_MAX_Y) dy = BED_MAX_Y - maxy
  if (minx + dx < BED_MIN_X - 0.05 || miny + dy < BED_MIN_Y - 0.05) return null
  if (maxx + dx > BED_MAX_X + 0.05 || maxy + dy > BED_MAX_Y + 0.05) return null
  return [dx, dy]
}

/** `slicer.is_u1`: printer name contains `u1` or `snapmaker`. */
export function isU1(printer: unknown): boolean {
  const name = typeof printer === 'string' ? printer.trim().toLowerCase() : ''
  return name.includes('u1') || name.includes('snapmaker')
}

/**
 * Offsets as run.py computes them on the U1 path: clearance from the raw
 * bounds, the model bounds moved by that clearance, then the shared nudge.
 * Returns null when the tray and housing do not fit on the bed together.
 */
export function meshBoundsOffsets(trayBounds: Bounds2, modelBounds: Bounds2): BedOffsets | null {
  const extraY = housingClearance(trayBounds, modelBounds, HOUSING_GAP_MM)
  let moved: Bounds2 = modelBounds
  if (extraY) moved = [modelBounds[0], modelBounds[1] + extraY, modelBounds[2], modelBounds[3] + extraY]
  const bed = sharedBedShift([trayBounds, moved])
  if (!bed) return null
  return { tray: [bed[0], bed[1]], model: [bed[0], bed[1] + extraY], source: 'mesh-bounds' }
}

export function defaultOffsets(): BedOffsets {
  return { tray: [0, 0], model: [0, 0], source: 'default' }
}

export interface ResolvedOffsets {
  offsets: BedOffsets
  warnings: ImportWarning[]
}

/**
 * Mesh-bounds offsets for a U1 printer, else (0, 0) with an `offsets-default`
 * warning. Bounds are null when the file is missing or unreadable.
 */
export function offsetsFromMeshes(
  printer: unknown,
  trayBounds: Bounds2 | null,
  modelBounds: Bounds2 | null,
): ResolvedOffsets {
  if (!isU1(printer)) {
    return {
      offsets: defaultOffsets(),
      warnings: [{
        kind: 'offsets-default',
        message: 'Printer is not a U1, so Bed_Space offsets are (0, 0) as on the Prusa path.',
      }],
    }
  }
  if (!trayBounds || !modelBounds) {
    return {
      offsets: defaultOffsets(),
      warnings: [{
        kind: 'offsets-default',
        message: 'tray.stl or the housing is missing, so Bed_Space offsets are (0, 0).',
      }],
    }
  }
  const offsets = meshBoundsOffsets(trayBounds, modelBounds)
  if (!offsets) {
    return {
      offsets: defaultOffsets(),
      warnings: [{
        kind: 'offsets-default',
        message: 'Tray and housing do not fit on the bed together, so Bed_Space offsets are (0, 0).',
      }],
    }
  }
  return { offsets, warnings: [] }
}

/** Above this many mm of disagreement between parts, `offset-spread` warns. */
export const OFFSET_SPREAD_LIMIT_MM = 0.001

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function isXY(p: unknown): p is { x: number; y: number } {
  const v = p as { x?: unknown; y?: unknown } | null
  return !!v && typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y)
}

/**
 * First Move in [from, to) that goes somewhere in XY. The MoveTable does not
 * record which words a command named, so "moves in XY, or starts from an
 * unknown XY" stands in for "has X and Y words". The writer emits the pick as
 * the first move after `;Pick Sequence` and the place right after one Z move
 * after `;Place Sequence`, and both always leave the previous XY.
 */
function firstXYMove(parse: ParseResult, from: number, to: number): number | null {
  const m = parse.moves
  for (let i = from; i < to && i < m.n; i++) {
    const startUnknown = Number.isNaN(m.x0[i]) || Number.isNaN(m.y0[i])
    if (startUnknown || m.x1[i] !== m.x0[i] || m.y1[i] !== m.y0[i]) {
      return Number.isFinite(m.x1[i]) && Number.isFinite(m.y1[i]) ? i : null
    }
  }
  return null
}

/**
 * Bed_Space offsets read back from the gcode (design section 4, source 3).
 * For each `placing` Event with number n (part index n - 1), the first XY Move
 * after its `pick_seq` gives tray = move - pick and the first XY Move after its
 * `place_seq` gives model = move - place. The result is the per-axis median
 * over parts; `spreadMm` is the largest distance of any sample from it.
 * Parts without `pick` are skipped for the tray offset. Null when either
 * offset has no sample.
 */
export function deriveOffsetsFromGcode(spec: Pick<Spec, 'parts'>, parse: ParseResult): BedOffsets | null {
  const parts = Array.isArray(spec.parts) ? spec.parts : []
  const events = parse.events
  const tray: XY[] = []
  const model: XY[] = []
  for (let k = 0; k < events.length; k++) {
    const ev = events[k]
    if (ev.data.kind !== 'placing') continue
    const part = parts[ev.data.number - 1]
    if (!part) continue
    let pickDone = false
    let placeDone = false
    for (let j = k + 1; j < events.length && events[j].kind !== 'placing'; j++) {
      const seq = events[j]
      if (seq.kind !== 'pick_seq' && seq.kind !== 'place_seq') continue
      if ((seq.kind === 'pick_seq' && pickDone) || (seq.kind === 'place_seq' && placeDone)) continue
      // Search until the next sequence marker or the next part.
      let end = parse.moves.n
      for (let q = j + 1; q < events.length; q++) {
        const kind = events[q].kind
        if (kind === 'pick_seq' || kind === 'place_seq' || kind === 'placing') {
          end = events[q].moveIndex
          break
        }
      }
      const i = firstXYMove(parse, seq.moveIndex, end)
      if (seq.kind === 'pick_seq') {
        pickDone = true
        if (i !== null && isXY(part.pick)) tray.push([parse.moves.x1[i] - part.pick.x, parse.moves.y1[i] - part.pick.y])
      } else {
        placeDone = true
        if (i !== null && isXY(part.place)) model.push([parse.moves.x1[i] - part.place.x, parse.moves.y1[i] - part.place.y])
      }
    }
  }
  if (tray.length === 0 || model.length === 0) return null
  const t: XY = [median(tray.map((s) => s[0])), median(tray.map((s) => s[1]))]
  const mo: XY = [median(model.map((s) => s[0])), median(model.map((s) => s[1]))]
  let spreadMm = 0
  for (const s of tray) spreadMm = Math.max(spreadMm, Math.hypot(s[0] - t[0], s[1] - t[1]))
  for (const s of model) spreadMm = Math.max(spreadMm, Math.hypot(s[0] - mo[0], s[1] - mo[1]))
  return { tray: t, model: mo, source: 'gcode', spreadMm }
}

/** `offset-spread` warning when gcode-derived offsets disagree between parts by more than 0.001 mm. */
export function offsetSpreadWarning(offsets: BedOffsets): ImportWarning | null {
  const spread = offsets.spreadMm ?? 0
  if (!(spread > OFFSET_SPREAD_LIMIT_MM)) return null
  return {
    kind: 'offset-spread',
    file: 'combined_output.gcode',
    message: `Bed_Space offsets read from the gcode disagree between parts by up to ${spread.toFixed(3)} mm; using the median.`,
  }
}
