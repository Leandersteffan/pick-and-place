// Frames the scene when a new Project loads: OrbitControls target at the centre
// of the visible items' bounds, camera at a distance where they fit. Without a
// Project the view frames the bed reach. Space or visibility changes do not
// refit, so the user's orbit stays where it is.
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { SceneItem } from '../model/sceneModel'
import { meshBoundsFor } from './MeshObject'
import { bedBox, fitCamera, sceneBounds } from './sceneHelpers'

/** The part of drei's OrbitControls this component uses. */
interface Controls {
  target: THREE.Vector3
  update(): void
}

export default function CameraFit({
  projectId,
  items,
  files,
}: {
  projectId: string | null
  items: readonly SceneItem[]
  files: Record<string, Uint8Array>
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as Controls | null
  const fitted = useRef<string | undefined>(undefined)

  useEffect(() => {
    const key = projectId ?? ''
    if (!controls || fitted.current === key) return
    fitted.current = key

    const box =
      sceneBounds(items, (item) => {
        const bytes = files[item.file]
        return bytes ? meshBoundsFor(item.file, bytes) : null
      }) ?? bedBox()
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 45
    const fit = fitCamera(box, fov)

    camera.position.set(...fit.position)
    camera.near = fit.near
    camera.far = fit.far
    camera.updateProjectionMatrix()
    controls.target.set(...fit.target)
    controls.update()
  }, [projectId, items, files, camera, controls])

  return null
}
