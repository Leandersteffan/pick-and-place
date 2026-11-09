// Toolpath renderer (design section 6; Requirements 6.1, 6.2, 6.4, 6.8, 6.9, 10.3).
//
// One LineSegments over the geometry from buildToolpathGeometry, drawn in Bed_Space
// exactly as the gcode says (no transform). Playhead and filters are applied
// imperatively from viewerStore subscriptions: the draw range, one end vertex and
// two uniforms change, React does not re-render and the geometry is not rebuilt.
// In Design_Space the toolpath is hidden and a note says where it is.
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { useStore } from 'zustand'
import { Color, LineBasicMaterial, type Mesh, type MeshBasicMaterial } from 'three'
import { MOVE_TYPES } from '../gcode/types'
import { uiStore } from '../store/uiStore'
import { viewerStore, type ViewerState } from '../store/viewerStore'
import { PALETTE, PlayheadPatch, buildToolpathGeometry, playheadIndex } from './toolpathGeometry'
import { layerRangeUniform, typeMaskUniform } from './visibility'

export const BED_SPACE_NOTE = 'Toolpath is shown in Bed_Space'

const CONE_HEIGHT = 1.2
const CONE_RADIUS = 0.5
const PALETTE_COLORS = MOVE_TYPES.map((t) => new Color(PALETTE[t]))

/** LineBasicMaterial with the uTypeMask / uLayerRange discard filter. */
function createToolpathMaterial() {
  const uniforms = {
    uTypeMask: { value: new Float32Array(8).fill(1) },
    uLayerRange: { value: layerRangeUniform([]) },
  }
  const material = new LineBasicMaterial({ vertexColors: true })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTypeMask = uniforms.uTypeMask
    shader.uniforms.uLayerRange = uniforms.uLayerRange
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aType;
attribute float aSeg;
attribute float aLayer;
uniform float uTypeMask[8];
uniform vec2 uLayerRange[8];
varying float vVisible;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
int tpType = clamp(int(aType + 0.5), 0, 7);
int tpSeg = clamp(int(aSeg + 0.5), 0, 7);
vec2 tpRange = uLayerRange[tpSeg];
vVisible = (uTypeMask[tpType] > 0.5 && aLayer >= tpRange.x - 0.5 && aLayer <= tpRange.y + 0.5) ? 1.0 : 0.0;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vVisible;')
      .replace('#include <clipping_planes_fragment>', 'if (vVisible < 0.5) discard;\n#include <clipping_planes_fragment>')
  }
  material.customProgramCacheKey = () => 'pnp-toolpath'
  return { material, uniforms }
}

/** Plain DOM note over the canvas (the Canvas wrapper is position: relative). */
function useBedSpaceNote(show: boolean) {
  const container = useThree((s) => s.gl.domElement.parentElement)
  const note = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!container) return
    const el = document.createElement('div')
    el.className = 'toolpath-note'
    el.textContent = BED_SPACE_NOTE
    el.setAttribute('role', 'note')
    container.appendChild(el)
    note.current = el
    return () => {
      el.remove()
      note.current = null
    }
  }, [container])
  useEffect(() => {
    if (note.current) note.current.style.display = show ? '' : 'none'
  }, [show, container])
}

export default function Toolpath() {
  const parse = useStore(viewerStore, (s) => s.parse)
  const space = useStore(uiStore, (s) => s.space)
  const inBed = space === 'bed'

  const geometry = useMemo(() => (parse ? buildToolpathGeometry(parse.moves) : null), [parse])
  useEffect(() => () => geometry?.dispose(), [geometry])

  const { material, uniforms } = useMemo(createToolpathMaterial, [])
  useEffect(() => () => material.dispose(), [material])

  const cone = useRef<Mesh>(null)

  useBedSpaceNote(!inBed && parse !== null)

  useEffect(() => {
    if (!geometry || !parse) return
    const moves = parse.moves
    const patch = new PlayheadPatch(geometry, moves)

    const applyPlayhead = (s: ViewerState) => {
      const point = patch.apply(s.playhead, s.frac)
      const mesh = cone.current
      if (!mesh) return
      mesh.visible = point !== null
      if (!point) return
      mesh.position.set(point[0], point[1], point[2] + CONE_HEIGHT / 2)
      const type = moves.type[playheadIndex(s.playhead, moves.n)]
      ;(mesh.material as MeshBasicMaterial).color.copy(PALETTE_COLORS[type] ?? PALETTE_COLORS[0])
    }
    const applyFilters = (s: ViewerState) => {
      uniforms.uTypeMask.value.set(typeMaskUniform(s.typeMask))
      uniforms.uLayerRange.value.set(layerRangeUniform(s.layerRanges))
    }

    const initial = viewerStore.getState()
    applyPlayhead(initial)
    applyFilters(initial)
    return viewerStore.subscribe((s, prev) => {
      if (s.playhead !== prev.playhead || s.frac !== prev.frac) applyPlayhead(s)
      if (s.typeMask !== prev.typeMask || s.layerRanges !== prev.layerRanges) applyFilters(s)
    })
  }, [geometry, parse, uniforms])

  if (!geometry) return null

  return (
    <group visible={inBed} name="toolpath">
      <lineSegments geometry={geometry} material={material} frustumCulled={false} />
      {/* Playhead marker: apex down at the playhead point (ConeGeometry points +Y). */}
      <mesh ref={cone} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <coneGeometry args={[CONE_RADIUS, CONE_HEIGHT, 16]} />
        <meshBasicMaterial color={PALETTE.extrude} depthTest={false} />
      </mesh>
    </group>
  )
}
