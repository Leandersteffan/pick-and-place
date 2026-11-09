// Edit controls in the side panel (Requirements 12.1 to 12.4, 12.8 to 12.10):
// translate by dx/dy, set pause_layer, undo and redo (buttons, Ctrl+Z, Ctrl+Y)
// and the stale-gcode indicator. Hidden for gcode-only Projects.
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { canRedo, canUndo } from './history'
import { housingFile } from '../io/importer'
import { housingZMax } from '../model/layerCount'
import { backendStore } from '../store/backendStore'
import { currentLayerCount, editorStore } from '../store/editorStore'
import { projectStore } from '../store/projectStore'
import { uiStore } from '../store/uiStore'
import { viewerStore } from '../store/viewerStore'

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export default function EditorPanel() {
  const project = useStore(projectStore, (s) => s.project)
  const selection = useStore(uiStore, (s) => s.selection)
  const history = useStore(editorStore, (s) => s.history)
  const error = useStore(editorStore, (s) => s.error)
  // Re-render when the parsed gcode changes, since the layer count comes from Segment 2.
  useStore(viewerStore, (s) => s.parse)

  const [dx, setDx] = useState('0')
  const [dy, setDy] = useState('0')
  const [layer, setLayer] = useState('')
  // Add trace and delete trace only exist with the Intersection_Port (Requirement 13.3).
  const portAvailable = useStore(backendStore, (s) => s.health?.intersection_port === true)
  const [fromX, setFromX] = useState('')
  const [fromY, setFromY] = useState('')
  const [toX, setToX] = useState('')
  const [toY, setToY] = useState('')
  const [traceZ, setTraceZ] = useState('')

  // Default Z of an added trace: the top of the housing, else 1.4 mm.
  useEffect(() => {
    if (!project || project.gcodeOnly) return
    const name = housingFile(project.spec, project.files)
    const zMax = name ? housingZMax(name, project.files[name]) : null
    setTraceZ(String(zMax !== null && Number.isFinite(zMax) ? Math.round(zMax * 1000) / 1000 : 1.4))
    // Only on a new Project, not after each edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  const partIndex = selection?.partIndex
  const part = project && partIndex !== undefined ? project.spec.parts[partIndex] : undefined

  useEffect(() => {
    setLayer(part ? String(part.pause_layer) : '')
  }, [part])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || isTextInput(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        editorStore.getState().undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        editorStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!project || project.gcodeOnly) return null
  const layers = currentLayerCount()
  const { run } = editorStore.getState()

  return (
    <div className="editor-panel">
      {project.gcodeStale && (
        <p className="status-warn-text editor-stale">The gcode is stale. Press Regenerate to rebuild it.</p>
      )}
      <div className="editor-row">
        <button type="button" disabled={!canUndo(history)} onClick={() => editorStore.getState().undo()}
          title={canUndo(history) ? `Undo: ${history.past[history.past.length - 1].label} (Ctrl+Z)` : 'Nothing to undo'}>
          Undo
        </button>{' '}
        <button type="button" disabled={!canRedo(history)} onClick={() => editorStore.getState().redo()}
          title={canRedo(history) ? `Redo: ${history.future[history.future.length - 1].label} (Ctrl+Y)` : 'Nothing to redo'}>
          Redo
        </button>
      </div>
      {part && partIndex !== undefined && (
        <>
          <form
            className="editor-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (run({ kind: 'translate', partIndex, dx: Number(dx), dy: Number(dy) })) {
                setDx('0')
                setDy('0')
              }
            }}
          >
            <label>
              dx <input type="number" step="any" value={dx} onChange={(e) => setDx(e.target.value)} style={{ width: '5em' }} />
            </label>{' '}
            <label>
              dy <input type="number" step="any" value={dy} onChange={(e) => setDy(e.target.value)} style={{ width: '5em' }} />
            </label>{' '}
            <button type="submit">Move</button>
          </form>
          {part.type === 'pcb' && (
            <p className="status-empty">Moving a pcb moves its mesh and pocket, but not the housing cavity.</p>
          )}
          <form
            className="editor-row"
            onSubmit={(e) => {
              e.preventDefault()
              run({ kind: 'setPauseLayer', partIndex, value: layer.trim() === '' ? NaN : Number(layer) })
            }}
          >
            <label>
              pause_layer{' '}
              <input type="number" step="1" min={1} max={layers || undefined} value={layer}
                onChange={(e) => setLayer(e.target.value)} style={{ width: '5em' }} />
            </label>{' '}
            <button type="submit">Set</button>{' '}
            <span className="status-empty">{layers > 0 ? `1 to ${layers}` : 'layer count unknown'}</span>
          </form>
          {portAvailable && (part.type === 'trace_cloth' || part.type === 'trace_braid') && (
            <div className="editor-row">
              <button
                type="button"
                onClick={() => {
                  if (run({ kind: 'deleteTrace', partIndex }, { portAvailable })) uiStore.getState().setSelection(null)
                }}
              >
                Delete trace
              </button>
            </div>
          )}
        </>
      )}
      {portAvailable && (
        <form
          className="editor-row"
          onSubmit={(e) => {
            e.preventDefault()
            const n = (s: string) => (s.trim() === '' ? NaN : Number(s))
            run(
              {
                kind: 'addTrace',
                from: [n(fromX), n(fromY)],
                to: [n(toX), n(toY)],
                z: n(traceZ),
                partType: project.spec.use_trace_braid ? 'trace_braid' : 'trace_cloth',
              },
              { portAvailable },
            )
          }}
        >
          <span>Add trace (nominal endpoints, straight along X or Y)</span>
          <br />
          <label>
            from x <input type="number" step="any" value={fromX} onChange={(e) => setFromX(e.target.value)} style={{ width: '5em' }} />
          </label>{' '}
          <label>
            y <input type="number" step="any" value={fromY} onChange={(e) => setFromY(e.target.value)} style={{ width: '5em' }} />
          </label>
          <br />
          <label>
            to x <input type="number" step="any" value={toX} onChange={(e) => setToX(e.target.value)} style={{ width: '5em' }} />
          </label>{' '}
          <label>
            y <input type="number" step="any" value={toY} onChange={(e) => setToY(e.target.value)} style={{ width: '5em' }} />
          </label>
          <br />
          <label>
            z <input type="number" step="any" value={traceZ} onChange={(e) => setTraceZ(e.target.value)} style={{ width: '5em' }} />
          </label>{' '}
          <button type="submit">Add trace</button>
        </form>
      )}
      {error && <p className="status-warn-text editor-error" role="alert">{error}</p>}
    </div>
  )
}
