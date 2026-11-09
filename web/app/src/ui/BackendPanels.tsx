// Backend UI: Regenerate button, health banner, progress overlay and failure
// panel (Requirements 14.1, 14.4, 14.5).
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { healthView } from '../backend/health'
import { backendStore } from '../store/backendStore'
import { projectStore } from '../store/projectStore'

export function RegenerateButton() {
  const health = useStore(backendStore, (s) => s.health)
  const running = useStore(backendStore, (s) => s.runningSince !== null)
  const project = useStore(projectStore, (s) => s.project)
  const loading = useStore(projectStore, (s) => s.loading !== null)
  const view = healthView(health)
  let reason: string | null = null
  if (!project) reason = 'Open a Project first'
  else if (project.gcodeOnly) reason = 'A gcode-only Project has no spec.json to regenerate'
  else reason = view.disabledReason
  const disabled = reason !== null || running || loading
  const label = project?.gcodeStale ? 'Regenerate (gcode stale)' : 'Regenerate'
  return (
    <button
      type="button"
      disabled={disabled}
      title={reason ?? 'Slice the current Spec with the Backend pipeline'}
      onClick={() => void backendStore.getState().startRegenerate()}
    >
      {label}
    </button>
  )
}

export function BackendBanner() {
  const health = useStore(backendStore, (s) => s.health)
  const checked = useStore(backendStore, (s) => s.healthChecked)
  if (!checked) return null
  const view = healthView(health)
  if (view.problems.length === 0) return null
  return (
    <div className="backend-banner" role="status">
      {view.problems.map((p) => (
        <div key={p}>{p}</div>
      ))}
      <button type="button" onClick={() => void backendStore.getState().refreshHealth()}>
        Check again
      </button>
    </div>
  )
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function RegenerateOverlay() {
  const since = useStore(backendStore, (s) => s.runningSince)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === null) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [since])
  if (since === null) return null
  return (
    <div className="drop-overlay regenerate-overlay">
      <div className="drop-overlay-box">
        <div>Regenerating… {formatElapsed(Math.max(0, now - since))}</div>
        <div className="toolbar-muted">Orca slices the tray and the housing; this can take a few minutes.</div>
        <button type="button" onClick={() => backendStore.getState().cancelRegenerate()}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function RegenerateFailurePanel() {
  const failure = useStore(backendStore, (s) => s.failure)
  if (!failure) return null
  return (
    <div className="regenerate-failure" role="alert">
      <div>
        <strong>Regenerate failed</strong> at stage <code>{failure.stage}</code>: {failure.message}
      </div>
      <div className="toolbar-muted">The previous gcode and Spec are unchanged.</div>
      {failure.errors && failure.errors.length > 0 && (
        <ul>
          {failure.errors.map((e, i) => (
            <li key={i}>
              {e.pointer ? <code>{e.pointer}</code> : null} {e.message}
            </li>
          ))}
        </ul>
      )}
      {failure.logTail && <pre className="regenerate-log">{failure.logTail}</pre>}
      <button type="button" onClick={() => backendStore.getState().clearFailure()}>
        Dismiss
      </button>
    </div>
  )
}
