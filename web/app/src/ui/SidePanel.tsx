// Side panel: the selected item's Spec fields as a read-only JSON tree, or the
// file name and size for the housing and tray (Requirement 4.8).
import { useStore } from 'zustand'
import EditorPanel from '../editor/EditorPanel'
import { selectionDetails } from '../scene/sceneHelpers'
import { projectStore } from '../store/projectStore'
import { uiStore } from '../store/uiStore'
import JsonTree from './JsonTree'
import { formatBytes } from './jsonTreeModel'

export default function SidePanel() {
  const project = useStore(projectStore, (s) => s.project)
  const selection = useStore(uiStore, (s) => s.selection)
  if (!project) return null

  const details = selection ? selectionDetails(project.spec, project.files, selection) : null

  return (
    <section className="side-panel">
      <EditorPanel />
      <h3 className="side-title">Selection</h3>
      {!selection && <p className="status-empty">Click a part, trace, tamp or marker in the 3D view.</p>}
      {selection && !details && <p className="status-empty">The selected item is no longer in the Spec.</p>}
      {details && (
        <>
          <div className="side-heading">{details.title}</div>
          {details.file && (
            <div className="side-file">
              <code className="pointer">{details.file.name}</code>{' '}
              {details.file.bytes === null ? (
                <span className="status-warn-text">missing</span>
              ) : (
                <span>
                  {formatBytes(details.file.bytes)} ({details.file.bytes.toLocaleString('en-US')} bytes)
                </span>
              )}
            </div>
          )}
          {details.sub && <JsonTree key={`sub-${details.title}`} name={details.sub.label} value={details.sub.value} />}
          {details.part !== undefined && (
            <JsonTree key={`part-${details.title}`} name={`parts[${selection?.partIndex}]`} value={details.part} />
          )}
        </>
      )}
    </section>
  )
}
