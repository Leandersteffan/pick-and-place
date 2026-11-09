// GET /api/health and what the UI makes of it (Requirements 14.5, 13.3).
import { apiUrl, defaultFetch, readJson, type FetchLike } from './client'

export interface Health {
  version: string
  python: string
  pipeline_dir: string
  pipeline_version: string | null
  orca_path: string | null
  orca_exists: boolean
  orca_candidates: string[]
  manifold3d: { ok: boolean; version: string | null; error: string | null }
  intersection_port: boolean
  busy: boolean
}

/** `null` health means the Backend did not answer. */
export async function fetchHealth(fetchImpl: FetchLike = defaultFetch(), signal?: AbortSignal): Promise<Health | null> {
  try {
    const res = await fetchImpl(apiUrl('/api/health'), { signal })
    if (!res.ok) return null
    const body = (await readJson(res)) as Health | null
    if (!body || typeof body !== 'object' || typeof body.orca_exists !== 'boolean') return null
    return body
  } catch {
    return null
  }
}

export interface HealthView {
  online: boolean
  orcaOk: boolean
  manifoldOk: boolean
  canRegenerate: boolean
  /** Short reason Regenerate is disabled, or null. */
  disabledReason: string | null
  /** Lines for the banner; empty when all is well. */
  problems: string[]
}

export function healthView(health: Health | null): HealthView {
  if (!health) {
    return {
      online: false,
      orcaOk: false,
      manifoldOk: false,
      canRegenerate: false,
      disabledReason: 'Backend offline',
      problems: ['Backend offline (http://127.0.0.1:8765). Viewing works; Regenerate is disabled.'],
    }
  }
  const problems: string[] = []
  if (!health.orca_exists) {
    const candidates = health.orca_candidates?.length ? ` Tried: ${health.orca_candidates.join(', ')}.` : ''
    problems.push(`OrcaSlicer not found at ${health.orca_path ?? '(no path)'}.${candidates}`)
  }
  if (!health.manifold3d?.ok) {
    problems.push(`manifold3d is not available: ${health.manifold3d?.error ?? 'unknown error'}`)
  }
  const disabledReason = !health.orca_exists ? 'OrcaSlicer missing' : null
  return {
    online: true,
    orcaOk: health.orca_exists,
    manifoldOk: health.manifold3d?.ok === true,
    canRegenerate: health.orca_exists,
    disabledReason,
    problems,
  }
}
