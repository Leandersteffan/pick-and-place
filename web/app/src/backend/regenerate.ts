// Regenerate: POST /api/slice and apply the result (design section 10,
// Requirements 14.1, 14.2, 14.4, 12.10).
//
// Order: ajv check first (no request for an invalid Spec), then a multipart
// upload of the canonical spec text, the housing and the component meshes.
// `recompute_tamps` follows `project.traceGeometryDirty`. The caller's
// AbortSignal cancels; a 10 minute timeout aborts as well.
import { canonicalJson } from '../model/canonicalJson'
import { deriveContactPoints } from '../model/contactPoints'
import type { BedOffsets, Project, XY } from '../model/project'
import type { Overrides, Spec } from '../model/spec'
import { validateSpec } from '../schema/validate'
import { apiUrl, base64ToBytes, defaultFetch, readJson, type FetchLike } from './client'

export const REGENERATE_TIMEOUT_MS = 10 * 60 * 1000
export const BUSY_MESSAGE = 'A regenerate is already running'
export const TRAY_FILE = 'tray.stl'
export const GCODE_FILE = 'combined_output.gcode'

export interface SliceResponse {
  gcode: string
  tray_stl_b64: string
  spec: Spec
  offsets: { tray: XY; model: XY; extra_y?: number; housing_clearance?: number; source?: string }
  intersections?: unknown
  pipeline_version: string | null
  duration_s: number
  log_tail: string
}

export interface RegenerateFailure {
  /** 'validate', 'upload', 'busy', 'network', 'cancelled', 'timeout', or the Backend's stage. */
  stage: string
  message: string
  logTail?: string
  /** Schema errors (client ajv or Backend 422). */
  errors?: { pointer?: string; message: string }[]
  status?: number
}

export type RegenerateResult = { ok: true; response: SliceResponse } | { ok: false; failure: RegenerateFailure }

export interface RegenerateOptions {
  signal?: AbortSignal
  fetchImpl?: FetchLike
  timeoutMs?: number
}

export interface SliceOptions {
  recompute_tamps: boolean
  contact_points: { x: number; y: number; z: number; overrides?: Overrides }[]
  auto_place: number[]
}

/**
 * The `options` field of /api/slice. The Backend uses `contact_points` and
 * `auto_place` only when `recompute_tamps` is true.
 */
export function sliceOptions(project: Project): SliceOptions {
  return {
    recompute_tamps: project.traceGeometryDirty === true,
    contact_points: project.contactPoints.map((c) =>
      c.overrides ? { x: c.x, y: c.y, z: c.z, overrides: { ...c.overrides } } : { x: c.x, y: c.y, z: c.z },
    ),
    auto_place: [...(project.autoPlace ?? [])].sort((a, b) => a - b),
  }
}

/** Builds the multipart body, or a failure when a file the Spec names is missing. */
export function buildSliceForm(project: Project): { ok: true; form: FormData } | { ok: false; failure: RegenerateFailure } {
  const spec = project.spec
  const housing = project.files[spec.housing]
  if (!housing) {
    return { ok: false, failure: { stage: 'upload', message: `The Project has no ${spec.housing}` } }
  }
  const form = new FormData()
  form.append('spec', canonicalJson(spec))
  form.append('options', JSON.stringify(sliceOptions(project)))
  form.append('housing', new Blob([housing as BlobPart]), spec.housing)
  const seen = new Set<string>()
  for (const part of spec.parts) {
    if (part.type !== 'pcb' && part.type !== 'print') continue
    if (seen.has(part.mesh)) continue
    seen.add(part.mesh)
    const bytes = project.files[part.mesh]
    if (!bytes) return { ok: false, failure: { stage: 'upload', message: `The Project has no ${part.mesh}` } }
    form.append('meshes', new Blob([bytes as BlobPart]), part.mesh)
  }
  return { ok: true, form }
}

function failureFromBody(status: number, body: unknown): RegenerateFailure {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (status === 409) return { stage: 'busy', message: BUSY_MESSAGE, status }
  if (status === 422) {
    const errors = Array.isArray(b.errors) ? (b.errors as { pointer?: string; message: string }[]) : []
    return { stage: String(b.stage ?? 'validate'), message: 'The Backend rejected the Spec', errors, status }
  }
  if (status === 400) {
    const field = typeof b.field === 'string' ? ` (field ${b.field})` : ''
    return { stage: 'upload', message: `${String(b.detail ?? 'Bad request')}${field}`, status }
  }
  return {
    stage: String(b.stage ?? 'backend'),
    message: String(b.message ?? b.detail ?? `HTTP ${status}`),
    logTail: typeof b.log_tail === 'string' ? b.log_tail : undefined,
    status,
  }
}

/** Sends the Project to the Backend. Never throws. */
export async function regenerate(project: Project, options: RegenerateOptions = {}): Promise<RegenerateResult> {
  const verdict = validateSpec(project.spec)
  if (!verdict.valid) {
    return {
      ok: false,
      failure: { stage: 'validate', message: 'The Spec is invalid; fix it before Regenerate', errors: verdict.errors },
    }
  }
  const built = buildSliceForm(project)
  if (!built.ok) return built

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? REGENERATE_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', onAbort)

  const fetchImpl = options.fetchImpl ?? defaultFetch()
  try {
    const res = await fetchImpl(apiUrl('/api/slice'), { method: 'POST', body: built.form, signal: controller.signal })
    const body = await readJson(res)
    if (!res.ok) return { ok: false, failure: failureFromBody(res.status, body) }
    const r = body as SliceResponse | null
    if (!r || typeof r.gcode !== 'string' || typeof r.tray_stl_b64 !== 'string' || !r.spec) {
      return { ok: false, failure: { stage: 'response', message: 'The Backend answered without gcode, tray or spec' } }
    }
    return { ok: true, response: r }
  } catch (err) {
    if (timedOut) return { ok: false, failure: { stage: 'timeout', message: 'Regenerate took longer than 10 minutes' } }
    if (controller.signal.aborted) return { ok: false, failure: { stage: 'cancelled', message: 'Regenerate cancelled' } }
    return { ok: false, failure: { stage: 'network', message: `Backend unreachable: ${(err as Error).message}` } }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * The Project after a successful Regenerate: Spec, tray, gcode, offsets,
 * pipeline version and contact points replaced, stale flags cleared, and the
 * baseline moved to the new Spec. The pipeline keeps part order, so the part
 * uids carry over.
 */
export function applySliceResponse(project: Project, r: SliceResponse): Project {
  const offsets: BedOffsets = {
    tray: [r.offsets.tray[0], r.offsets.tray[1]],
    model: [r.offsets.model[0], r.offsets.model[1]],
    source: 'backend',
  }
  const partUids =
    r.spec.parts.length === project.partUids.length
      ? project.partUids
      : r.spec.parts.map((_, i) => project.partUids[i] ?? globalThis.crypto.randomUUID())
  return {
    ...project,
    spec: r.spec,
    partUids,
    files: {
      ...project.files,
      [TRAY_FILE]: base64ToBytes(r.tray_stl_b64),
      [GCODE_FILE]: new TextEncoder().encode(r.gcode),
    },
    gcodeStale: false,
    traceGeometryDirty: false,
    autoPlace: [],
    offsets,
    contactPoints: deriveContactPoints(r.spec),
    baseline: { spec: r.spec, partUids },
    pipelineVersion: r.pipeline_version ?? undefined,
  }
}
