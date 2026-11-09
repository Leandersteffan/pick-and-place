// Click selection for scene objects (Requirement 4.8).
import type { ThreeEvent } from '@react-three/fiber'
import type { SceneItem } from '../model/sceneModel'
import { uiStore } from '../store/uiStore'
import { selectionOf } from './sceneHelpers'

/** Outline and emissive colour of the selected item. */
export const HIGHLIGHT = '#4cc2ff'

/** userData flag of the housing and tray meshes, which enclose or carry other items. */
export const BACKGROUND = { background: true }

/**
 * onClick for one SceneItem. A background mesh (housing, tray) lets the click
 * pass on to any other item behind it, so a part inside the semi-transparent
 * housing can still be clicked. Otherwise the event stops here.
 */
export function selectOnClick(item: SceneItem, background = false) {
  return (e: ThreeEvent<MouseEvent>) => {
    if (background && e.intersections.some((h) => h.eventObject !== e.eventObject && !h.eventObject.userData.background)) {
      return
    }
    e.stopPropagation()
    uiStore.getState().setSelection(selectionOf(item))
  }
}
