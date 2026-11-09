// Undo and redo (design section 10, Requirement 12.9).
//
// An entry stores immer patches over the editable slice of the Project
// (`EditState`) and, when a command rewrote part meshes, the file bytes before
// and after. Undo applies the inverse patches and restores `fileBefore`; redo
// applies the patches and restores `fileAfter`. `gcodeStale` is part of the
// slice, so undoing every edit back to the import state clears it again.
import { applyPatches, enablePatches, type Patch } from 'immer'
import type { ContactPoint, Project } from '../model/project'
import type { Spec } from '../model/spec'

enablePatches()

export const HISTORY_LIMIT = 200

/** The part of a Project that commands change through patches. */
export interface EditState {
  spec: Spec
  partUids: string[]
  contactPoints: ContactPoint[]
  gcodeStale: boolean
  traceGeometryDirty: boolean
  /** indices of added traces for the next Regenerate's `auto_place` */
  autoPlace: number[]
}

export interface HistoryEntry {
  label: string
  patches: Patch[]
  inverse: Patch[]
  /** rewritten part meshes */
  fileBefore?: Record<string, Uint8Array>
  fileAfter?: Record<string, Uint8Array>
}

export interface History {
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export function emptyHistory(): History {
  return { past: [], future: [] }
}

export function editState(p: Project): EditState {
  return {
    spec: p.spec,
    partUids: p.partUids,
    contactPoints: p.contactPoints,
    gcodeStale: p.gcodeStale,
    traceGeometryDirty: p.traceGeometryDirty ?? false,
    autoPlace: p.autoPlace ?? [],
  }
}

export function withEditState(p: Project, s: EditState, files?: Record<string, Uint8Array>): Project {
  return {
    ...p,
    spec: s.spec,
    partUids: s.partUids,
    contactPoints: s.contactPoints,
    gcodeStale: s.gcodeStale,
    traceGeometryDirty: s.traceGeometryDirty,
    autoPlace: s.autoPlace,
    files: files ? { ...p.files, ...files } : p.files,
  }
}

/** Records a new entry: clears the redo stack and keeps at most HISTORY_LIMIT entries. */
export function pushEntry(h: History, entry: HistoryEntry): History {
  const past = [...h.past, entry]
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT)
  return { past, future: [] }
}

export function canUndo(h: History): boolean {
  return h.past.length > 0
}

export function canRedo(h: History): boolean {
  return h.future.length > 0
}

export function undo(p: Project, h: History): [Project, History] {
  const entry = h.past[h.past.length - 1]
  if (!entry) return [p, h]
  const state = applyPatches(editState(p), entry.inverse) as EditState
  return [withEditState(p, state, entry.fileBefore), { past: h.past.slice(0, -1), future: [...h.future, entry] }]
}

export function redo(p: Project, h: History): [Project, History] {
  const entry = h.future[h.future.length - 1]
  if (!entry) return [p, h]
  const state = applyPatches(editState(p), entry.patches) as EditState
  const past = [...h.past, entry]
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT)
  return [withEditState(p, state, entry.fileAfter), { past, future: h.future.slice(0, -1) }]
}
