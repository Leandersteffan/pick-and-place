// Backend store: health, the running Regenerate, its failure and the last diff
// input for the Diff_View (Requirements 14.1, 14.2, 14.4, 14.5).
// Vanilla zustand, no React import.
import { createStore } from 'zustand/vanilla'
import type { FetchLike } from '../backend/client'
import { fetchHealth, type Health } from '../backend/health'
import { applySliceResponse, regenerate, type RegenerateFailure } from '../backend/regenerate'
import type { Spec } from '../model/spec'
import { emptyHistory } from '../editor/history'
import { editorStore } from './editorStore'
import { projectStore } from './projectStore'

export const HEALTH_POLL_MS = 10_000

export interface SpecSnapshot {
  spec: Spec
  partUids: string[]
}

export interface BackendState {
  /** null until the first check answers, or when the Backend is offline. */
  health: Health | null
  /** true after the first health check finished (answered or not). */
  healthChecked: boolean
  /** Date.now() when the running Regenerate started, or null. */
  runningSince: number | null
  failure: RegenerateFailure | null
  /** Baseline before and Spec after the last successful Regenerate (for the Diff_View). */
  lastDiff: { before: SpecSnapshot; after: SpecSnapshot } | null
  lastDurationS: number | null

  refreshHealth(): Promise<Health | null>
  startRegenerate(): Promise<boolean>
  cancelRegenerate(): void
  clearFailure(): void
  clearDiff(): void
}

export function createBackendStore(fetchImpl?: FetchLike) {
  let controller: AbortController | null = null

  return createStore<BackendState>()((set, get) => ({
    health: null,
    healthChecked: false,
    runningSince: null,
    failure: null,
    lastDiff: null,
    lastDurationS: null,

    async refreshHealth() {
      const health = await fetchHealth(fetchImpl)
      set({ health, healthChecked: true })
      return health
    },

    async startRegenerate() {
      if (get().runningSince !== null) return false
      const before = projectStore.getState().project
      if (!before || before.gcodeOnly) return false
      controller = new AbortController()
      set({ runningSince: Date.now(), failure: null })
      const result = await regenerate(before, { signal: controller.signal, fetchImpl })
      controller = null
      if (!result.ok) {
        // Cancel is the user's choice; it is not shown as a failure panel.
        set({ runningSince: null, failure: result.failure.stage === 'cancelled' ? null : result.failure })
        if (result.failure.stage === 'network') void get().refreshHealth()
        return false
      }
      const current = projectStore.getState().project
      if (!current || current.id !== before.id) {
        // A different Project was opened meanwhile; discard the result.
        set({ runningSince: null })
        return false
      }
      const next = applySliceResponse(before, result.response)
      set({
        runningSince: null,
        failure: null,
        lastDurationS: result.response.duration_s ?? null,
        lastDiff: {
          before: { spec: before.baseline.spec, partUids: before.baseline.partUids },
          after: { spec: next.spec, partUids: next.partUids },
        },
      })
      projectStore.getState().setProject(next)
      editorStore.setState({ history: emptyHistory(), error: null })
      return true
    },

    cancelRegenerate() {
      controller?.abort()
    },

    clearFailure() {
      set({ failure: null })
    },

    clearDiff() {
      set({ lastDiff: null })
    },
  }))
}

export type BackendStore = ReturnType<typeof createBackendStore>

export const backendStore: BackendStore = createBackendStore()

/** Polls /api/health; returns a stop function. Called once from the App. */
export function startHealthPolling(store: BackendStore = backendStore, everyMs = HEALTH_POLL_MS): () => void {
  void store.getState().refreshHealth()
  const id = setInterval(() => {
    if (store.getState().runningSince === null) void store.getState().refreshHealth()
  }, everyMs)
  return () => clearInterval(id)
}
