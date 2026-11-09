// Bed reach outline X 0.5 to 270.5, Y 1 to 271 at Z 0, and a 10 mm grid
// (Requirement 4.4). Lines carry no handlers, so r3f never raycasts them.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { BED_REACH } from './sceneHelpers'

/** Grid from 0 to 280 mm in X and Y, so its lines sit on multiples of 10 mm. */
const GRID_SIZE = 280

export default function Bed({ showReach }: { showReach: boolean }) {
  const outline = useMemo(() => {
    const { x0, y0, x1, y1 } = BED_REACH
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0], 3))
    return g
  }, [])
  useEffect(() => () => outline.dispose(), [outline])

  return (
    <group>
      {/* gridHelper lies in XZ; +90° about X puts it in XY (Z up). */}
      <gridHelper
        args={[GRID_SIZE, GRID_SIZE / 10, '#3a3d44', '#2c2e33']}
        position={[GRID_SIZE / 2, GRID_SIZE / 2, -0.01]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      {showReach && (
        <lineLoop geometry={outline}>
          <lineBasicMaterial color="#6a8fd0" />
        </lineLoop>
      )}
    </group>
  )
}
