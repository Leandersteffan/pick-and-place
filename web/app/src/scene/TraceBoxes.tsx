// Trace boxes (Requirement 4.2): length along line_from to line_to, the Spec
// width, top face at line Z, rotated by rotZ about Z.
import { Edges } from '@react-three/drei'
import type { TraceItem } from '../model/sceneModel'
import { HIGHLIGHT, selectOnClick } from './interaction'

export default function TraceBox({ item, selected }: { item: TraceItem; selected: boolean }) {
  return (
    <mesh
      position={[item.center.x, item.center.y, item.center.z]}
      rotation={[0, 0, item.rotZ]}
      onClick={selectOnClick(item)}
    >
      <boxGeometry args={[item.length, item.width, item.height]} />
      <meshStandardMaterial
        color="#c47a3a"
        emissive={selected ? HIGHLIGHT : '#000000'}
        emissiveIntensity={selected ? 0.4 : 0}
      />
      <Edges color={selected ? HIGHLIGHT : '#6b3e17'} />
    </mesh>
  )
}
