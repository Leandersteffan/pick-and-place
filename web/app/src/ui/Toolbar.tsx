// Toolbar: import actions (Requirements 1.1, 1.2, 1.3) and the Spec status chip (3.3, 3.4).
import { useEffect, useRef, type ChangeEvent } from 'react'
import { useStore } from 'zustand'
import { downloadBundle } from '../io/exporter'
import { projectStore } from '../store/projectStore'
import { RegenerateButton } from './BackendPanels'

export const GCODE_ONLY_LABEL = 'gcode only – no spec.json'

export function SpecStatusChip() {
  const validation = useStore(projectStore, (s) => s.validation)
  const gcodeOnly = useStore(projectStore, (s) => s.project?.gcodeOnly === true)
  if (gcodeOnly) return <span className="status-chip">{GCODE_ONLY_LABEL}</span>
  if (!validation) return null
  return validation.valid ? (
    <span className="status-chip status-ok">valid Spec v1</span>
  ) : (
    <span className="status-chip status-bad">
      invalid Spec v1 ({validation.errors.length} {validation.errors.length === 1 ? 'error' : 'errors'})
    </span>
  )
}

export default function Toolbar() {
  const loading = useStore(projectStore, (s) => s.loading)
  const name = useStore(projectStore, (s) => s.project?.name)
  const hasProject = useStore(projectStore, (s) => s.project !== null)
  const bundleInput = useRef<HTMLInputElement>(null)
  const gcodeInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  // `webkitdirectory` is not in React's input typings; set it on the element.
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [])

  const onBundle = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void projectStore.getState().openBundle(file)
  }

  const onGcode = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void projectStore.getState().openGcode(file)
  }

  const onFolder = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    e.target.value = ''
    if (files.length > 0) void projectStore.getState().openFolder(files)
  }

  const onDownload = () => {
    const project = projectStore.getState().project
    if (!project) return
    downloadBundle(project).catch((err: unknown) => {
      projectStore.setState({ error: `Download bundle failed: ${(err as Error).message}` })
    })
  }

  const busy = loading !== null
  return (
    <header className="app-toolbar">
      <strong>Pick-and-Place Designer</strong>
      <span className="toolbar-sep" />
      <button type="button" disabled={busy} onClick={() => void projectStore.getState().loadDemo()}>
        Load demo
      </button>
      <button type="button" disabled={busy} onClick={() => bundleInput.current?.click()}>
        Open bundle
      </button>
      <button type="button" disabled={busy} onClick={() => folderInput.current?.click()}>
        Open Rhino folder
      </button>
      <button type="button" disabled={busy} onClick={() => gcodeInput.current?.click()}>
        Open gcode
      </button>
      <span className="toolbar-sep" />
      <button type="button" disabled={busy || !hasProject} onClick={onDownload} title="Save the Project as a .pnp.zip bundle">
        Download bundle
      </button>
      <RegenerateButton />
      <input ref={bundleInput} type="file" accept=".zip,.pnp.zip" hidden onChange={onBundle} />
      <input ref={gcodeInput} type="file" accept=".gcode,.gco" hidden onChange={onGcode} />
      <input ref={folderInput} type="file" multiple hidden onChange={onFolder} />
      <span className="toolbar-fill" />
      {busy ? <span className="toolbar-muted">{loading}…</span> : name ? <span className="toolbar-muted">{name}</span> : null}
      <SpecStatusChip />
    </header>
  )
}
