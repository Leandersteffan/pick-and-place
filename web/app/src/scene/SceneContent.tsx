// Everything inside the Canvas: bed, meshes, traces and markers built from the
// pure scene model, filtered by the visibility toggles.
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { buildSceneModel, type SceneItem } from '../model/sceneModel'
import { projectStore } from '../store/projectStore'
import { uiStore } from '../store/uiStore'
import Toolpath from '../viewer/Toolpath'
import Bed from './Bed'
import CameraFit from './CameraFit'
import MeshObject from './MeshObject'
import PointMarker from './PointMarkers'
import { isSelected } from './sceneHelpers'
import TraceBox from './TraceBoxes'

const NO_FILES: Record<string, Uint8Array> = {}

function itemKey(item: SceneItem, n: number): string {
  switch (item.kind) {
    case 'housing':
    case 'tray':
      return item.kind
    case 'tamp':
      return `tamp-${item.partIndex}-${item.tampIndex}`
    case 'prinjection':
      return `prinjection-${item.partIndex}-${item.holeIndex}`
    default:
      return `${item.kind}-${item.partIndex ?? n}`
  }
}

export default function SceneContent() {
  const project = useStore(projectStore, (s) => s.project)
  const space = useStore(uiStore, (s) => s.space)
  const visibility = useStore(uiStore, (s) => s.visibility)
  const selection = useStore(uiStore, (s) => s.selection)

  const items = useMemo(
    // A gcode-only Project has no housing, tray or parts: only the bed and the toolpath.
    () => (project && !project.gcodeOnly ? buildSceneModel(project.spec, project.offsets, space, project.partUids) : []),
    [project, space],
  )

  const visible = useMemo(() => items.filter((item) => visibility[item.kind]), [items, visibility])

  return (
    <>
      <Bed showReach={space === 'bed'} />
      <CameraFit projectId={project?.id ?? null} items={visible} files={project?.files ?? NO_FILES} />
      {visible.map((item, n) => {
        const key = itemKey(item, n)
        const selected = isSelected(item, selection)
        switch (item.kind) {
          case 'housing':
          case 'tray':
          case 'partMesh':
            return <MeshObject key={key} item={item} bytes={project?.files[item.file]} selected={selected} />
          case 'trace':
            return <TraceBox key={key} item={item} selected={selected} />
          default:
            return <PointMarker key={key} item={item} selected={selected} />
        }
      })}
      {/* Gcode coordinates are Bed_Space: drawn untransformed, hidden in Design_Space. */}
      <Toolpath />
    </>
  )
}
