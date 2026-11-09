// Per-category visibility toggles (Requirement 4.7).
import { useStore } from 'zustand'
import { uiStore } from '../store/uiStore'
import { VISIBILITY_KINDS } from './sceneHelpers'

export default function VisibilityToggles() {
  const visibility = useStore(uiStore, (s) => s.visibility)
  return (
    <div className="scene-overlay scene-overlay-left" role="group" aria-label="Visibility">
      {VISIBILITY_KINDS.map(({ kind, label }) => (
        <label key={kind} className="vis-toggle">
          <input
            type="checkbox"
            checked={visibility[kind]}
            onChange={(e) => uiStore.getState().setVisible(kind, e.target.checked)}
          />
          {label}
        </label>
      ))}
    </div>
  )
}
