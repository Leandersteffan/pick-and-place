// Status panel: import error banner, Spec validation result with JSON pointers
// (Requirements 3.3, 3.4) and import warnings naming each file (1.5, 1.7).
import { useStore } from 'zustand'
import { discardAutosave, restoreAutosave } from '../autosave/appAutosave'
import { formatSavedAt } from '../autosave/autosave'
import { projectStore } from '../store/projectStore'
import { uiStore } from '../store/uiStore'

export default function StatusPanel() {
  const project = useStore(projectStore, (s) => s.project)
  const validation = useStore(projectStore, (s) => s.validation)
  const error = useStore(projectStore, (s) => s.error)
  const warningsOpen = useStore(uiStore, (s) => s.warningsOpen)
  const restoreOffer = useStore(uiStore, (s) => s.restoreOffer)
  const autosaveWarning = useStore(uiStore, (s) => s.autosaveWarning)

  // Schema findings are shown from `validation`, which follows the current Spec;
  // the import-time copies in project.warnings would repeat them.
  const warnings = project ? project.warnings.filter((w) => w.kind !== 'schema') : []

  return (
    <section className="status-panel">
      {error && (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="banner-close" aria-label="Dismiss" onClick={() => projectStore.getState().clearError()}>
            ×
          </button>
        </div>
      )}

      {autosaveWarning && (
        <div className="banner banner-warn" role="status">
          <span>{autosaveWarning}</span>
          <button type="button" className="banner-close" aria-label="Dismiss" onClick={() => uiStore.getState().setAutosaveWarning(null)}>
            ×
          </button>
        </div>
      )}

      {restoreOffer && !project && (
        <div className="banner banner-info" role="status">
          <span>
            Restore last project '{restoreOffer.name}' (saved {formatSavedAt(restoreOffer.savedAt)})?
          </span>
          <button type="button" className="banner-action" onClick={() => void restoreAutosave()}>
            Restore
          </button>
          <button type="button" className="banner-action" onClick={() => void discardAutosave()}>
            Discard
          </button>
        </div>
      )}

      {!project && !error && (
        <p className="status-empty">
          No project loaded. Use "Load demo", "Open bundle", "Open Rhino folder" or "Open gcode", or drop a{' '}
          <code>.pnp.zip</code>, a Rhino output folder or a <code>.gcode</code> file onto the window.
        </p>
      )}

      {project?.gcodeOnly && (
        <div className="status-block">
          <div className="status-line">● gcode only – no spec.json (toolpath, timeline and gcode only)</div>
        </div>
      )}

      {project && validation && (
        <div className="status-block">
          {validation.valid ? (
            <div className="status-line status-ok-text">● valid Spec v1</div>
          ) : (
            <>
              <div className="status-line status-bad-text">
                ● invalid Spec v1, {validation.errors.length} {validation.errors.length === 1 ? 'error' : 'errors'}
              </div>
              <ul className="status-list">
                {validation.errors.map((e, i) => (
                  <li key={`${e.pointer}-${e.keyword}-${i}`}>
                    <code className="pointer">{e.pointer || '/'}</code> {e.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="status-block">
          <button
            type="button"
            className="status-line status-warn-text status-toggle"
            onClick={() => uiStore.getState().setWarningsOpen(!warningsOpen)}
          >
            {warningsOpen ? '▾' : '▸'} {warnings.length} import {warnings.length === 1 ? 'warning' : 'warnings'}
          </button>
          {warningsOpen && (
            <ul className="status-list">
              {warnings.map((w, i) => (
                <li key={`${w.kind}-${w.file ?? ''}-${i}`}>
                  {w.file && <code className="pointer">{w.file}</code>} {w.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
