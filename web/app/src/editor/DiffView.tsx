// Diff_View: what changed in parts and pause layers after the last successful
// Regenerate (Requirement 14.3). The baseline itself was moved to the new Spec
// by applySliceResponse; this panel shows the stored before/after pair.
import { useMemo } from 'react'
import { useStore } from 'zustand'
import type { Part, Vec3 } from '../model/spec'
import type { SceneItemKind } from '../model/sceneModel'
import { backendStore } from '../store/backendStore'
import { uiStore } from '../store/uiStore'
import { diffSpecs, isEmptyDiff } from './diff'

function fmt(v: Vec3): string {
  return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`
}

function selectionKind(type: Part['type']): SceneItemKind {
  if (type === 'pcb' || type === 'print') return 'partMesh'
  if (type === 'plug') return 'pick'
  return 'trace'
}

function select(index: number, type: Part['type']) {
  uiStore.getState().setSelection({ kind: selectionKind(type), partIndex: index })
}

export default function DiffView() {
  const lastDiff = useStore(backendStore, (s) => s.lastDiff)
  const diff = useMemo(() => (lastDiff ? diffSpecs(lastDiff.before, lastDiff.after) : null), [lastDiff])
  if (!diff) return null
  return (
    <div className="diff-view" role="status">
      <strong>Changes from Regenerate</strong>
      {isEmptyDiff(diff) ? (
        <div className="toolbar-muted">No changes</div>
      ) : (
        <ul>
          {diff.added.map((d) => (
            <li key={`a-${d.uid}`} onClick={() => select(d.index, d.type)} style={{ cursor: 'pointer' }}>
              Added part {d.index} ({d.type}) at {fmt(d.place)}
            </li>
          ))}
          {diff.removed.map((d) => (
            <li key={`r-${d.uid}`}>
              Removed {d.type} at {fmt(d.place)}
            </li>
          ))}
          {diff.moved.map((d) => (
            <li key={`m-${d.uid}`} onClick={() => select(d.index, d.type)} style={{ cursor: 'pointer' }}>
              Moved part {d.index} ({d.type}) {fmt(d.from)} → {fmt(d.to)}
            </li>
          ))}
          {diff.pauseLayers.map((d) => (
            <li key={`p-${d.uid}`} onClick={() => select(d.index, d.type)} style={{ cursor: 'pointer' }}>
              Part {d.index} ({d.type}) pause_layer {d.from} → {d.to}
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => backendStore.getState().clearDiff()}>
        Close
      </button>
    </div>
  )
}
