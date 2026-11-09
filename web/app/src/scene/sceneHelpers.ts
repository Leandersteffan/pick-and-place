// Pure helpers for the Scene_View (design section 7, Requirements 4.4, 4.5, 4.7, 4.8).
// No React or three import, so the logic runs in Node under Vitest.
import type { Bounds } from '../io/stl'
import type { BedOffsets, XY } from '../model/project'
import type { MeshItem, SceneItem, SceneItemKind, SceneSpace } from '../model/sceneModel'
import { TRAY_FILE } from '../model/sceneModel'
import type { Spec, Vec3 } from '../model/spec'

/** Reach of the U1 nozzle in Bed_Space (pipeline bed limits), mm. */
export const BED_REACH = { x0: 0.5, y0: 1, x1: 270.5, y1: 271 } as const

/** Half size of the largest point marker (pick ring outer radius 1.3, cone height 1.6). */
const MARKER_EXTENT = 1.6

export interface Box {
  min: Vec3
  max: Vec3
}

/** The bed reach rectangle at Z 0, the camera fallback without a Project. */
export function bedBox(): Box {
  return { min: { x: BED_REACH.x0, y: BED_REACH.y0, z: 0 }, max: { x: BED_REACH.x1, y: BED_REACH.y1, z: 0 } }
}

function grow(box: Box | null, min: Vec3, max: Vec3): Box {
  if (!box) return { min: { ...min }, max: { ...max } }
  return {
    min: { x: Math.min(box.min.x, min.x), y: Math.min(box.min.y, min.y), z: Math.min(box.min.z, min.z) },
    max: { x: Math.max(box.max.x, max.x), y: Math.max(box.max.y, max.y), z: Math.max(box.max.z, max.z) },
  }
}

/**
 * Axis-aligned bounds of the scene items. `meshBoundsOf` returns the decoded
 * mesh's bounds (`[minX, minY, maxX, maxY, minZ, maxZ]`, before the item's
 * translation) or null when the file is missing or empty; such a mesh is skipped.
 * Returns null when nothing has extent.
 */
export function sceneBounds(items: readonly SceneItem[], meshBoundsOf: (item: MeshItem) => Bounds | null): Box | null {
  let box: Box | null = null
  for (const item of items) {
    switch (item.kind) {
      case 'housing':
      case 'tray':
      case 'partMesh': {
        const b = meshBoundsOf(item)
        if (!b) break
        const [dx, dy, dz] = item.translation
        box = grow(box, { x: b[0] + dx, y: b[1] + dy, z: b[4] + dz }, { x: b[2] + dx, y: b[3] + dy, z: b[5] + dz })
        break
      }
      case 'trace': {
        const c = Math.abs(Math.cos(item.rotZ))
        const s = Math.abs(Math.sin(item.rotZ))
        const hx = (c * item.length + s * item.width) / 2
        const hy = (s * item.length + c * item.width) / 2
        const hz = item.height / 2
        const { x, y, z } = item.center
        box = grow(box, { x: x - hx, y: y - hy, z: z - hz }, { x: x + hx, y: y + hy, z: z + hz })
        break
      }
      default: {
        const { x, y, z } = item.pos
        const e = MARKER_EXTENT
        box = grow(box, { x: x - e, y: y - e, z: z - e }, { x: x + e, y: y + e, z: z + e })
      }
    }
  }
  return box
}

export interface CameraFit {
  target: [number, number, number]
  position: [number, number, number]
  near: number
  far: number
}

/** View direction from the target to the camera: from the front (-Y) and above. */
const VIEW_DIR: [number, number, number] = [0, -0.8, 0.6]

/**
 * Camera placement that frames `box` for a perspective camera with vertical
 * field of view `fovDeg`: target at the box centre, camera along VIEW_DIR at a
 * distance where the box's bounding sphere fits, with 15 % margin.
 */
export function fitCamera(box: Box, fovDeg: number): CameraFit {
  const target: [number, number, number] = [
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    (box.min.z + box.max.z) / 2,
  ]
  const radius = Math.max(
    5,
    Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) / 2,
  )
  const distance = (radius / Math.sin(((fovDeg * Math.PI) / 180) / 2)) * 1.15
  return {
    target,
    position: [target[0] + VIEW_DIR[0] * distance, target[1] + VIEW_DIR[1] * distance, target[2] + VIEW_DIR[2] * distance],
    near: Math.max(0.1, distance / 100),
    far: Math.max(5000, distance * 20),
  }
}

/** Toggle order and labels of the per-category visibility toggles. */
export const VISIBILITY_KINDS: readonly { kind: SceneItemKind; label: string }[] = [
  { kind: 'housing', label: 'Housing' },
  { kind: 'tray', label: 'Tray' },
  { kind: 'partMesh', label: 'Parts' },
  { kind: 'trace', label: 'Traces' },
  { kind: 'tamp', label: 'Tamps' },
  { kind: 'prinjection', label: 'Prinjection' },
  { kind: 'pick', label: 'Picks' },
]

export type Visibility = Record<SceneItemKind, boolean>

export function allVisible(): Visibility {
  return { housing: true, tray: true, partMesh: true, trace: true, tamp: true, prinjection: true, pick: true }
}

/** What the user clicked. Housing and tray have no partIndex. */
export interface Selection {
  kind: SceneItemKind
  partIndex?: number
  tampIndex?: number
  holeIndex?: number
}

/** The Selection a click on this item produces. */
export function selectionOf(item: SceneItem): Selection {
  switch (item.kind) {
    case 'housing':
    case 'tray':
      return { kind: item.kind }
    case 'tamp':
      return { kind: 'tamp', partIndex: item.partIndex, tampIndex: item.tampIndex }
    case 'prinjection':
      return { kind: 'prinjection', partIndex: item.partIndex, holeIndex: item.holeIndex }
    default:
      return { kind: item.kind, partIndex: item.partIndex }
  }
}

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && a.partIndex === b.partIndex && a.tampIndex === b.tampIndex && a.holeIndex === b.holeIndex
}

export function isSelected(item: SceneItem, selection: Selection | null): boolean {
  return sameSelection(selectionOf(item), selection)
}

/** "+0.5", "+1.0", "+23.616", "-2.25": at most 3 decimals, at least 1. */
export function formatOffset(v: number): string {
  let s = (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3).replace(/0+$/, '')
  if (s.endsWith('.')) s += '0'
  return s.startsWith('-') ? s : `+${s}`
}

export function formatXY(o: XY): string {
  return `${formatOffset(o[0])}, ${formatOffset(o[1])}`
}

/**
 * The on-screen label of the active space, as in design section 7, plus where
 * the offsets came from: "Bed_Space (tray +0.5, +1.0 / model +0.5, +23.616) · source: manifest".
 */
export function spaceLabel(space: SceneSpace, offsets: BedOffsets | null): string {
  if (space === 'design') return 'Design_Space'
  if (!offsets) return 'Bed_Space'
  return `Bed_Space (tray ${formatXY(offsets.tray)} / model ${formatXY(offsets.model)}) · source: ${offsets.source}`
}

export interface SelectionDetails {
  title: string
  /** The Spec part object, if the selection belongs to a part. */
  part?: unknown
  /** The selected sub-item (tamp, prinjection hole or pick point) of that part. */
  sub?: { label: string; value: unknown }
  /** The mesh file behind the selection; bytes is null when the file is missing. */
  file?: { name: string; bytes: number | null }
}

function fileInfo(name: string, files: Record<string, Uint8Array>): { name: string; bytes: number | null } {
  const bytes = files[name]
  return { name, bytes: bytes ? bytes.byteLength : null }
}

/**
 * Looks the Selection up in the Spec. Returns null when it points at
 * something the Spec does not have (e.g. after an edit removed the part).
 */
export function selectionDetails(
  spec: Spec,
  files: Record<string, Uint8Array>,
  selection: Selection,
): SelectionDetails | null {
  if (selection.kind === 'housing') return { title: 'Housing', file: fileInfo(spec.housing, files) }
  if (selection.kind === 'tray') return { title: 'Tray', file: fileInfo(TRAY_FILE, files) }

  const i = selection.partIndex
  if (i === undefined || !Number.isInteger(i) || i < 0 || i >= spec.parts.length) return null
  const part = spec.parts[i]
  const head = `Part ${i} · ${part.type}${part.name ? ` · ${part.name}` : ''}`

  switch (selection.kind) {
    case 'partMesh': {
      if (part.type !== 'pcb' && part.type !== 'print') return null
      return { title: head, part, file: fileInfo(part.mesh, files) }
    }
    case 'trace':
      if (part.type !== 'trace_cloth' && part.type !== 'trace_braid') return null
      return { title: head, part }
    case 'tamp': {
      const t = selection.tampIndex
      const tamp = t === undefined ? undefined : part.tamps?.[t]
      if (!tamp) return null
      return { title: `${head} · tamp ${t}`, part, sub: { label: `tamps[${t}]`, value: tamp } }
    }
    case 'prinjection': {
      const h = selection.holeIndex
      const hole = h === undefined || (part.type !== 'pcb' && part.type !== 'print') ? undefined : part.prinjection?.[h]
      if (!hole) return null
      return { title: `${head} · prinjection ${h}`, part, sub: { label: `prinjection[${h}]`, value: hole } }
    }
    case 'pick':
      if (!part.pick) return null
      return { title: `${head} · pick`, part, sub: { label: 'pick', value: part.pick } }
    default:
      return null
  }
}
