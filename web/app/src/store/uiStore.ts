// UI store: selection, scene space, visibility and transient UI flags.
// Vanilla zustand, no React import.
import { createStore } from 'zustand/vanilla'
import type { RestoreOffer } from '../autosave/autosave'
import type { SceneItemKind, SceneSpace } from '../model/sceneModel'
import { allVisible, type Selection, type Visibility } from '../scene/sceneHelpers'
import { projectStore } from './projectStore'

export type { Selection, Visibility } from '../scene/sceneHelpers'

export interface UiState {
  selection: Selection | null
  /** Design_Space (spec coordinates) or Bed_Space (offsets applied). */
  space: SceneSpace
  /** Per SceneItem kind; 'partMesh' is the "Parts" toggle. All on by default. */
  visibility: Visibility
  /** True while files are dragged over the window. */
  dragActive: boolean
  /** Whether the warning list in the status panel is expanded. */
  warningsOpen: boolean
  /** Saved Project offered for restore at startup, or null. */
  restoreOffer: RestoreOffer | null
  /** Dismissible autosave warning, e.g. full browser storage, or null. */
  autosaveWarning: string | null

  setSelection(selection: Selection | null): void
  setSpace(space: SceneSpace): void
  setVisible(kind: SceneItemKind, visible: boolean): void
  setDragActive(active: boolean): void
  setWarningsOpen(open: boolean): void
  setRestoreOffer(offer: RestoreOffer | null): void
  setAutosaveWarning(message: string | null): void
}

export const uiStore = createStore<UiState>()((set) => ({
  selection: null,
  space: 'bed',
  visibility: allVisible(),
  dragActive: false,
  warningsOpen: true,
  restoreOffer: null,
  autosaveWarning: null,

  setSelection(selection) {
    set({ selection })
  },
  setSpace(space) {
    set({ space })
  },
  setVisible(kind, visible) {
    set((s) => ({ visibility: { ...s.visibility, [kind]: visible } }))
  },
  setDragActive(dragActive) {
    set({ dragActive })
  },
  setWarningsOpen(warningsOpen) {
    set({ warningsOpen })
  },
  setRestoreOffer(restoreOffer) {
    set({ restoreOffer })
  },
  setAutosaveWarning(autosaveWarning) {
    set({ autosaveWarning })
  },
}))

// A different Project invalidates the selection (part indices refer to the old spec).
projectStore.subscribe((state, prev) => {
  if (state.project?.id !== prev.project?.id) {
    uiStore.getState().setSelection(null)
    // A gcode-only Project has nothing in Design_Space; its toolpath is Bed_Space.
    if (state.project?.gcodeOnly) uiStore.getState().setSpace('bed')
  }
})
