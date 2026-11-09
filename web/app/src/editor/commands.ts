// Editor commands (design section 10, Requirements 12.1 to 12.4, 12.10).
//
// A command never mutates the Project: it runs immer `produceWithPatches` over
// the EditState slice and returns a new Project plus a HistoryEntry. Every
// successful command sets `gcodeStale`. Translating a trace or a pcb sets
// `traceGeometryDirty`, which turns on `recompute_tamps` for the next Regenerate.
//
// Write-back fields (`pick`, `slot`, `pocket`, `pocket_depth`) are left alone:
// `pick` is a tray position, not a housing one, and the next Regenerate
// overwrites all of them.
import { enablePatches, produceWithPatches, setAutoFreeze } from 'immer'
import { translateStl } from '../io/meshTransform'
import { CONTACT_MERGE_TOL_MM } from '../model/contactPoints'
import type { Project } from '../model/project'
import type { Part, TracePart, Vec3 } from '../model/spec'
import { editState, withEditState, type EditState, type HistoryEntry } from './history'

enablePatches()
// Other code reads Project objects as plain data; frozen results would make any
// later in-place write throw, so results stay unfrozen.
setAutoFreeze(false)

export type TraceType = 'trace_cloth' | 'trace_braid'

export type Command =
  | { kind: 'translate'; partIndex: number; dx: number; dy: number }
  | { kind: 'setPauseLayer'; partIndex: number; value: number }
  | { kind: 'addTrace'; from: [number, number]; to: [number, number]; z: number; partType: TraceType }
  | { kind: 'deleteTrace'; partIndex: number }

export type CommandResult =
  | { ok: true; project: Project; entry: HistoryEntry }
  | { ok: false; error: string }

export interface CommandContext {
  /** housing layer count; 0 when unknown */
  layerCount: number
  /** `/api/health` reports `intersection_port: true`; required for add and delete trace */
  portAvailable?: boolean
}

export const TRACE_WIDTH = 2.8
export const TRACE_HEIGHT = 0.2
/** C# `TRACE_SIDE_OFFSET`: line_from/line_to extend the nominal line by width / 2 + this */
export const TRACE_SIDE_OFFSET = 0.15
export const AXIS_ERROR = 'Only straight traces along X or along Y are supported'
export const PORT_ERROR = 'Adding and deleting traces needs the Intersection_Port on the Backend'

const AXIS_EPS = 1e-6

/** Round half to even, as C# `Math.Round` (default MidpointRounding.ToEven). */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const diff = x - f
  if (diff === 0.5) return f % 2 === 0 ? f : f + 1
  return Math.round(x)
}

function isTrace(p: Part | undefined): p is TracePart {
  return p?.type === 'trace_cloth' || p?.type === 'trace_braid'
}

/** Builds the Spec part of an added trace, or an error (Requirements 12.5, 12.6). */
export function buildTrace(
  from: [number, number],
  to: [number, number],
  z: number,
  partType: TraceType,
  layerCount: number,
): { ok: true; part: TracePart } | { ok: false; error: string } {
  const nums = [from[0], from[1], to[0], to[1], z]
  if (!nums.every(Number.isFinite)) return { ok: false, error: 'Trace endpoints and Z must be numbers' }
  const ddx = to[0] - from[0]
  const ddy = to[1] - from[1]
  const alongX = Math.abs(ddx) > AXIS_EPS
  const alongY = Math.abs(ddy) > AXIS_EPS
  if (alongX === alongY) return { ok: false, error: AXIS_ERROR }
  const nominal = Math.hypot(ddx, ddy)
  if (nominal < TRACE_WIDTH) return { ok: false, error: `A trace must be at least ${TRACE_WIDTH} mm long` }
  const pauseLayer = roundHalfEven(z / 0.2) + 1
  if (pauseLayer < 1 || pauseLayer > layerCount) {
    return { ok: false, error: `Z ${z} gives ${pauseLayer > 0 ? `pause_layer ${pauseLayer}` : 'no layer'}; ${pauseLayerError(layerCount)}` }
  }
  const ux = ddx / nominal
  const uy = ddy / nominal
  const ext = TRACE_WIDTH / 2 + TRACE_SIDE_OFFSET
  const line_from: Vec3 = { x: from[0] - ux * ext, y: from[1] - uy * ext, z }
  const line_to: Vec3 = { x: to[0] + ux * ext, y: to[1] + uy * ext, z }
  const part: TracePart = {
    type: partType,
    place: { x: (line_from.x + line_to.x) / 2, y: (line_from.y + line_to.y) / 2, z },
    pause_layer: pauseLayer,
    length: Math.hypot(line_to.x - line_from.x, line_to.y - line_from.y),
    width: TRACE_WIDTH,
    height: TRACE_HEIGHT,
    horizontal: Math.abs(uy) < 0.01,
    line_from,
    line_to,
    tamps: [
      { x: from[0], y: from[1], z, type: 0 },
      { x: to[0], y: to[1], z, type: 0 },
    ],
  }
  return { ok: true, part }
}

function newUid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `uid-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function addTrace(project: Project, cmd: Extract<Command, { kind: 'addTrace' }>, ctx: CommandContext): CommandResult {
  const built = buildTrace(cmd.from, cmd.to, cmd.z, cmd.partType, ctx.layerCount)
  if (!built.ok) return built
  const parts = project.spec.parts
  let at = 0
  parts.forEach((p, i) => {
    if (isTrace(p)) at = i + 1
  })
  const uid = newUid()
  const [next, patches, inverse] = produceWithPatches(editState(project), (d: EditState) => {
    d.spec.parts.splice(at, 0, built.part)
    d.partUids.splice(at, 0, uid)
    d.autoPlace = d.autoPlace.map((i) => (i >= at ? i + 1 : i))
    d.autoPlace.push(at)
    d.gcodeStale = true
    d.traceGeometryDirty = true
  })
  const [a, b] = [cmd.from, cmd.to].map((p) => `(${p[0]}, ${p[1]})`)
  return {
    ok: true,
    project: withEditState(project, next),
    entry: { label: `Add trace ${a} to ${b} at Z ${cmd.z}`, patches, inverse },
  }
}

function deleteTrace(project: Project, partIndex: number): CommandResult {
  const part = project.spec.parts[partIndex]
  if (!Number.isInteger(partIndex) || !part) return { ok: false, error: `No part at index ${partIndex}` }
  if (!isTrace(part)) return { ok: false, error: `Part ${partIndex} is not a trace` }
  const [next, patches, inverse] = produceWithPatches(editState(project), (d: EditState) => {
    d.spec.parts.splice(partIndex, 1)
    d.partUids.splice(partIndex, 1)
    d.autoPlace = d.autoPlace.filter((i) => i !== partIndex).map((i) => (i > partIndex ? i - 1 : i))
    d.gcodeStale = true
    d.traceGeometryDirty = true
  })
  return {
    ok: true,
    project: withEditState(project, next),
    entry: { label: `Delete trace ${partIndex}`, patches, inverse },
  }
}

function shift(p: Vec3, dx: number, dy: number): void {
  p.x += dx
  p.y += dy
}

export function pauseLayerError(layerCount: number): string {
  if (layerCount < 1) return 'The housing layer count is unknown: load gcode or a housing mesh'
  return `pause_layer must be an integer from 1 to ${layerCount}`
}

export function applyCommand(project: Project, cmd: Command, ctx: CommandContext): CommandResult {
  if (project.gcodeOnly) return { ok: false, error: 'A gcode-only Project has no Spec to edit' }
  if (cmd.kind === 'addTrace' || cmd.kind === 'deleteTrace') {
    if (ctx.portAvailable !== true) return { ok: false, error: PORT_ERROR }
    return cmd.kind === 'addTrace' ? addTrace(project, cmd, ctx) : deleteTrace(project, cmd.partIndex)
  }
  const part = project.spec.parts[cmd.partIndex]
  if (!Number.isInteger(cmd.partIndex) || !part) return { ok: false, error: `No part at index ${cmd.partIndex}` }

  if (cmd.kind === 'setPauseLayer') {
    const v = cmd.value
    if (!Number.isInteger(v) || v < 1 || v > ctx.layerCount) return { ok: false, error: pauseLayerError(ctx.layerCount) }
    if (v === part.pause_layer) return { ok: false, error: `pause_layer is already ${v}` }
    const [next, patches, inverse] = produceWithPatches(editState(project), (d) => {
      d.spec.parts[cmd.partIndex].pause_layer = v
      d.gcodeStale = true
    })
    return {
      ok: true,
      project: withEditState(project, next),
      entry: { label: `Set pause_layer of part ${cmd.partIndex} to ${v}`, patches, inverse },
    }
  }

  const { dx, dy } = cmd
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { ok: false, error: 'dx and dy must be numbers' }
  if (dx === 0 && dy === 0) return { ok: false, error: 'Enter a non-zero offset' }

  const isComponent = part.type === 'pcb' || part.type === 'print'
  // Contact points that came from this component's prinjection points (matched before the move).
  const movedContacts: number[] = []
  if (isComponent && part.prinjection) {
    project.contactPoints.forEach((c, i) => {
      if (part.prinjection!.some((h) => Math.hypot(h.x - c.x, h.y - c.y) <= CONTACT_MERGE_TOL_MM)) movedContacts.push(i)
    })
  }

  const [next, patches, inverse] = produceWithPatches(editState(project), (d: EditState) => {
    const p = d.spec.parts[cmd.partIndex]
    shift(p.place, dx, dy)
    for (const t of p.tamps ?? []) shift(t, dx, dy)
    if (p.type === 'trace_cloth' || p.type === 'trace_braid') {
      shift(p.line_from, dx, dy)
      shift(p.line_to, dx, dy)
    } else if (p.type === 'pcb' || p.type === 'print') {
      shift(p.bbox_center, dx, dy)
      shift(p.bbox_min, dx, dy)
      for (const h of p.prinjection ?? []) shift(h, dx, dy)
      for (const i of movedContacts) shift(d.contactPoints[i], dx, dy)
    }
    d.gcodeStale = true
    if (p.type === 'trace_cloth' || p.type === 'trace_braid' || p.type === 'pcb') d.traceGeometryDirty = true
  })

  let fileBefore: Record<string, Uint8Array> | undefined
  let fileAfter: Record<string, Uint8Array> | undefined
  if (part.type === 'pcb' || part.type === 'print') {
    const bytes = project.files[part.mesh]
    if (bytes) {
      fileBefore = { [part.mesh]: bytes }
      fileAfter = { [part.mesh]: translateStl(bytes, dx, dy) }
    }
  }

  return {
    ok: true,
    project: withEditState(project, next, fileAfter),
    entry: { label: `Move part ${cmd.partIndex} by (${dx}, ${dy})`, patches, inverse, fileBefore, fileAfter },
  }
}
