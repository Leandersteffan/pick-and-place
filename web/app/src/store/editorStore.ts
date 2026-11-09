// Editor store: undo history and the last command error.
// Commands go through projectStore.setProject, which revalidates the Spec
// synchronously; the scene model is rebuilt from the new Project on the next
// render (Requirement 12.8). Vanilla zustand, no React import.
import { createStore } from 'zustand/vanilla'
import { applyCommand, type Command } from '../editor/commands'
import { emptyHistory, pushEntry, redo, undo, type History } from '../editor/history'
import { housingFile } from '../io/importer'
import { housingZMax, layerCount } from '../model/layerCount'
import { projectStore } from './projectStore'
import { viewerStore } from './viewerStore'

export interface EditorState {
  history: History
  error: string | null
  /** `portAvailable` comes from `/api/health` (`intersection_port`); add and delete trace need it. */
  run(cmd: Command, opts?: { portAvailable?: boolean }): boolean
  undo(): void
  redo(): void
  clearError(): void
}

/** Housing layer count of the current Project: Segment 2, else housing Z max / 0.2, else 0. */
export function currentLayerCount(): number {
  const project = projectStore.getState().project
  if (!project) return 0
  const segments = viewerStore.getState().parse?.segments
  const name = housingFile(project.spec, project.files)
  const zMax = name ? housingZMax(name, project.files[name]) : null
  return layerCount(segments, zMax)
}

export const editorStore = createStore<EditorState>()((set, get) => ({
  history: emptyHistory(),
  error: null,

  run(cmd, opts) {
    const project = projectStore.getState().project
    if (!project) return false
    const result = applyCommand(project, cmd, { layerCount: currentLayerCount(), portAvailable: opts?.portAvailable })
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    set({ history: pushEntry(get().history, result.entry), error: null })
    projectStore.getState().setProject(result.project)
    return true
  },
  undo() {
    const project = projectStore.getState().project
    if (!project || get().history.past.length === 0) return
    const [next, history] = undo(project, get().history)
    set({ history, error: null })
    projectStore.getState().setProject(next)
  },
  redo() {
    const project = projectStore.getState().project
    if (!project || get().history.future.length === 0) return
    const [next, history] = redo(project, get().history)
    set({ history, error: null })
    projectStore.getState().setProject(next)
  },
  clearError() {
    set({ error: null })
  },
}))

// A different Project starts with an empty history.
projectStore.subscribe((state, prev) => {
  if (state.project?.id !== prev.project?.id) editorStore.setState({ history: emptyHistory(), error: null })
})
