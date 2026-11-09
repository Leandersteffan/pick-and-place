// Diff between the baseline Spec and the Spec after Regenerate (Requirement 14.3).
// Parts are matched by partUid; partUids[i] belongs to spec.parts[i].
import type { Part, Spec, Vec3 } from '../model/spec'

export const MOVE_TOLERANCE_MM = 0.001

export interface SpecState {
  spec: Spec
  partUids: string[]
}

export interface DiffAdded { uid: string; index: number; type: Part['type']; place: Vec3 }
export interface DiffRemoved { uid: string; type: Part['type']; place: Vec3 }
export interface DiffMoved { uid: string; index: number; type: Part['type']; from: Vec3; to: Vec3 }
export interface DiffPauseLayer { uid: string; index: number; type: Part['type']; from: number; to: number }

export interface SpecDiff {
  added: DiffAdded[]
  removed: DiffRemoved[]
  moved: DiffMoved[]
  pauseLayers: DiffPauseLayer[]
}

function byUid(state: SpecState): Map<string, { part: Part; index: number }> {
  const map = new Map<string, { part: Part; index: number }>()
  state.spec.parts.forEach((part, index) => {
    const uid = state.partUids[index]
    if (uid !== undefined) map.set(uid, { part, index })
  })
  return map
}

/** true when any coordinate differs by more than MOVE_TOLERANCE_MM. */
export function placeMoved(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a.x - b.x) > MOVE_TOLERANCE_MM ||
    Math.abs(a.y - b.y) > MOVE_TOLERANCE_MM ||
    Math.abs(a.z - b.z) > MOVE_TOLERANCE_MM
  )
}

export function diffSpecs(before: SpecState, after: SpecState): SpecDiff {
  const old = byUid(before)
  const next = byUid(after)
  const result: SpecDiff = { added: [], removed: [], moved: [], pauseLayers: [] }

  for (const [uid, { part, index }] of next) {
    const prev = old.get(uid)
    if (!prev) {
      result.added.push({ uid, index, type: part.type, place: { ...part.place } })
      continue
    }
    if (placeMoved(prev.part.place, part.place)) {
      result.moved.push({ uid, index, type: part.type, from: { ...prev.part.place }, to: { ...part.place } })
    }
    if (prev.part.pause_layer !== part.pause_layer) {
      result.pauseLayers.push({ uid, index, type: part.type, from: prev.part.pause_layer, to: part.pause_layer })
    }
  }
  for (const [uid, { part }] of old) {
    if (!next.has(uid)) result.removed.push({ uid, type: part.type, place: { ...part.place } })
  }
  return result
}

export function isEmptyDiff(d: SpecDiff): boolean {
  return d.added.length + d.removed.length + d.moved.length + d.pauseLayers.length === 0
}
