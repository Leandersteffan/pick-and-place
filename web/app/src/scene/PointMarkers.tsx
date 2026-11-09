// Tamp, prinjection and pick markers (Requirement 4.3): tamps are spheres of
// radius 0.6 coloured by type, prinjection points purple cones with the tip on
// the point, picks teal rings.
import { Edges } from '@react-three/drei'
import * as THREE from 'three'
import type { PickItem, PrinjectionItem, TampItem } from '../model/sceneModel'
import { HIGHLIGHT, selectOnClick } from './interaction'

export const TAMP_COLORS = ['#e5484d', '#f76b15', '#ffd60a', '#d6409f'] as const

const CONE_HEIGHT = 1.6

type MarkerItem = TampItem | PrinjectionItem | PickItem

export default function PointMarker({ item, selected }: { item: MarkerItem; selected: boolean }) {
  const emissive = selected ? HIGHLIGHT : '#000000'
  const intensity = selected ? 0.6 : 0
  const { x, y, z } = item.pos

  if (item.kind === 'tamp') {
    return (
      <mesh position={[x, y, z]} onClick={selectOnClick(item)}>
        <sphereGeometry args={[0.6, 20, 14]} />
        <meshStandardMaterial color={TAMP_COLORS[item.tampType]} emissive={emissive} emissiveIntensity={intensity} />
        {selected && <Edges threshold={40} color={HIGHLIGHT} />}
      </mesh>
    )
  }

  if (item.kind === 'prinjection') {
    // coneGeometry points along +Y; -90° about X turns the tip to -Z.
    return (
      <mesh position={[x, y, z + CONE_HEIGHT / 2]} rotation={[-Math.PI / 2, 0, 0]} onClick={selectOnClick(item)}>
        <coneGeometry args={[0.6, CONE_HEIGHT, 16]} />
        <meshStandardMaterial color="#8e4ec6" emissive={emissive} emissiveIntensity={intensity} />
        {selected && <Edges threshold={40} color={HIGHLIGHT} />}
      </mesh>
    )
  }

  return (
    <mesh position={[x, y, z]} onClick={selectOnClick(item)}>
      <ringGeometry args={[0.8, 1.3, 32]} />
      <meshStandardMaterial color="#12a594" side={THREE.DoubleSide} emissive={emissive} emissiveIntensity={intensity} />
      {selected && <Edges threshold={40} color={HIGHLIGHT} />}
    </mesh>
  )
}
