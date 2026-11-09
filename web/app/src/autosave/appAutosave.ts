// The app's single autosave, wired to projectStore and uiStore.
// Started once from main.tsx; the StatusPanel banner calls restore/discard.
import { projectStore } from '../store/projectStore'
import { uiStore } from '../store/uiStore'
import { startAutosave, type AutosaveHandle } from './autosave'

let handle: AutosaveHandle | null = null

export function startAppAutosave(): AutosaveHandle {
  if (!handle) {
    handle = startAutosave(projectStore, {
      onOffer: (offer) => uiStore.getState().setRestoreOffer(offer),
      onWarning: (message) => uiStore.getState().setAutosaveWarning(message),
    })
  }
  return handle
}

export function restoreAutosave(): Promise<boolean> {
  return handle ? handle.restore() : Promise.resolve(false)
}

export function discardAutosave(): Promise<void> {
  return handle ? handle.discard() : Promise.resolve()
}
