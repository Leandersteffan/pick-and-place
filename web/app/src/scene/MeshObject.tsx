// Housing, tray and part meshes (Requirement 4.1). Each file's bytes are decoded
// once into a BufferGeometry with computeVertexNormals and cached by the bytes
// object, which the importer and the editor replace whenever the file content
// changes. Mounted MeshObjects count as users of a cache entry. When the last
// user lets go (unmount, hidden by a toggle, or new bytes for the same file),
// geometry.dispose() frees the GPU buffers. The CPU-side geometry stays in the
// WeakMap so showing the mesh again re-uploads it without decoding; the entry
// is garbage-collected together with its bytes once no Project holds them.
// The release waits one tick so React StrictMode's unmount-and-remount does
// not dispose a geometry that is used again right away.
import { Edges } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { meshBounds, readStl, type Bounds } from '../io/stl'
import { readThreeMf } from '../io/threemf'
import type { MeshItem } from '../model/sceneModel'
import { BACKGROUND, HIGHLIGHT, selectOnClick } from './interaction'

interface Entry {
  geometry: THREE.BufferGeometry
  bounds: Bounds | null
  users: number
}

const cache = new WeakMap<Uint8Array, Entry>()

function entryFor(name: string, bytes: Uint8Array): Entry {
  const hit = cache.get(bytes)
  if (hit) return hit
  const positions = /\.3mf$/i.test(name) ? readThreeMf(bytes, name).positions : readStl(bytes).positions
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  const entry: Entry = { geometry, bounds: meshBounds(positions), users: 0 }
  cache.set(bytes, entry)
  return entry
}

/** Bounds of the decoded mesh before any scene translation; null for an empty mesh. */
export function meshBoundsFor(name: string, bytes: Uint8Array): Bounds | null {
  return entryFor(name, bytes).bounds
}

function acquire(entry: Entry): void {
  entry.users++
}

function release(entry: Entry): void {
  entry.users--
  setTimeout(() => {
    if (entry.users === 0) entry.geometry.dispose()
  }, 0)
}

const STYLE: Record<MeshItem['kind'], { color: string; opacity: number }> = {
  housing: { color: '#9aa7b8', opacity: 0.35 },
  tray: { color: '#c9b48a', opacity: 1 },
  partMesh: { color: '#3f9c5a', opacity: 1 },
}

export default function MeshObject({
  item,
  bytes,
  selected,
}: {
  item: MeshItem
  bytes: Uint8Array | undefined
  selected: boolean
}) {
  const entry = useMemo(() => (bytes ? entryFor(item.file, bytes) : null), [item.file, bytes])
  useEffect(() => {
    if (!entry) return
    acquire(entry)
    return () => release(entry)
  }, [entry])

  if (!entry) return null
  const style = STYLE[item.kind]
  const transparent = style.opacity < 1
  const background = item.kind !== 'partMesh'
  return (
    <mesh
      geometry={entry.geometry}
      position={item.translation}
      userData={background ? BACKGROUND : {}}
      onClick={selectOnClick(item, background)}
    >
      <meshStandardMaterial
        color={style.color}
        transparent={transparent}
        opacity={style.opacity}
        depthWrite={!transparent}
        side={THREE.DoubleSide}
        emissive={selected ? HIGHLIGHT : '#000000'}
        emissiveIntensity={selected ? 0.35 : 0}
      />
      {selected && <Edges threshold={30} color={HIGHLIGHT} />}
    </mesh>
  )
}
