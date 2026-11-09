// Design_Space / Bed_Space switch with the on-screen label of the active space
// and its offsets (Requirement 4.5).
import { useStore } from 'zustand'
import type { SceneSpace } from '../model/sceneModel'
import { projectStore } from '../store/projectStore'
import { uiStore } from '../store/uiStore'
import { spaceLabel } from './sceneHelpers'

const OPTIONS: { space: SceneSpace; label: string }[] = [
  { space: 'design', label: 'Design' },
  { space: 'bed', label: 'Bed' },
]

export default function SpaceToggle() {
  const space = useStore(uiStore, (s) => s.space)
  const offsets = useStore(projectStore, (s) => s.project?.offsets ?? null)

  return (
    <div className="scene-overlay scene-overlay-right">
      <div className="segmented" role="radiogroup" aria-label="Coordinate space">
        {OPTIONS.map((o) => (
          <button
            key={o.space}
            type="button"
            role="radio"
            aria-checked={space === o.space}
            className={space === o.space ? 'active' : ''}
            onClick={() => uiStore.getState().setSpace(o.space)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="space-label">{spaceLabel(space, offsets)}</div>
    </div>
  )
}
