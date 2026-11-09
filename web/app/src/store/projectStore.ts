// Project store (design sections 4 and "Data ownership"; Requirements 1.1 to 1.7, 3.3, 3.4).
//
// A vanilla zustand store with no React import, so it runs in Node under
// Vitest. Components read it with `useStore(projectStore, selector)`.
//
// Rules:
// - `validation` is always `validateSpec(project.spec)`, recomputed on every set.
// - A Spec that fails the schema still loads; the errors are shown, not fatal.
// - A failed import (no spec.json, bad JSON, unreadable zip) sets `error` and
//   keeps the previous Project.
// - When imports overlap, only the newest one is applied.
import { createStore } from 'zustand/vanilla'
import { loadFixture } from '../io/fixture'
import { readDataTransfer, readFileList } from '../io/folder'
import { importBundle, importGcode, type ImportResult } from '../io/importer'
import type { Project } from '../model/project'
import { validateSpec, type SpecVerdict } from '../schema/validate'

/** The part of `File` the bundle import needs; a real File satisfies it. */
export type NamedBytes = Pick<File, 'name' | 'arrayBuffer'>

export interface ProjectState {
  project: Project | null
  /** Label of the import in progress, e.g. "Loading demo", or null. */
  loading: string | null
  /** Message of the last failed import, or null. */
  error: string | null
  /** validateSpec(project.spec), or null without a Project. */
  validation: SpecVerdict | null

  setProject(project: Project | null): void
  clearError(): void
  /** Runs an import; on success the result replaces the Project. */
  runImport(label: string, start: () => Promise<ImportResult>): Promise<boolean>
  loadDemo(): Promise<boolean>
  openBundle(file: NamedBytes): Promise<boolean>
  openFolder(files: FileList | File[]): Promise<boolean>
  openDrop(items: DataTransferItemList): Promise<boolean>
  /** Opens a bare gcode file (any slicer) as a gcode-only Project. */
  openGcode(file: NamedBytes): Promise<boolean>
}

export function isBundleName(name: string): boolean {
  return /\.zip$/i.test(name)
}

export function isGcodeName(name: string): boolean {
  return /\.(gcode|gco)$/i.test(name)
}

export function createProjectStore() {
  let ticket = 0

  return createStore<ProjectState>()((set, get) => ({
    project: null,
    loading: null,
    error: null,
    validation: null,

    setProject(project) {
      // A gcode-only Project has a placeholder spec; it is not validated.
      set({ project, validation: project && !project.gcodeOnly ? validateSpec(project.spec) : null })
    },

    clearError() {
      set({ error: null })
    },

    async runImport(label, start) {
      const mine = ++ticket
      set({ loading: label, error: null })
      let result: ImportResult
      try {
        result = await start()
      } catch (err) {
        result = { ok: false, error: `${label} failed: ${(err as Error).message}` }
      }
      if (mine !== ticket) return false
      if (result.ok) {
        get().setProject(result.project)
        set({ loading: null, error: null })
        return true
      }
      set({ loading: null, error: result.error })
      return false
    },

    loadDemo() {
      return get().runImport('Loading demo', () => loadFixture())
    },

    openBundle(file) {
      return get().runImport(`Opening ${file.name}`, async () =>
        importBundle(new Uint8Array(await file.arrayBuffer()), file.name),
      )
    },

    openGcode(file) {
      return get().runImport(`Opening ${file.name}`, async () =>
        importGcode(new Uint8Array(await file.arrayBuffer()), file.name),
      )
    },

    openFolder(files) {
      return get().runImport('Opening Rhino folder', () => readFileList(files))
    },

    openDrop(items) {
      // Everything taken from the DataTransfer must be read synchronously,
      // before the drop event ends. readDataTransfer does so on its first line.
      const list = Array.from(items).filter((item) => item.kind === 'file')
      if (list.length === 1) {
        const entry = list[0].webkitGetAsEntry()
        const file = list[0].getAsFile()
        if (file && !entry?.isDirectory && isBundleName(file.name)) {
          return get().openBundle(file)
        }
        if (file && !entry?.isDirectory && isGcodeName(file.name)) {
          return get().openGcode(file)
        }
      }
      if (list.length === 0) {
        set({ error: 'Drop a .pnp.zip bundle, a Rhino output folder or a .gcode file' })
        return Promise.resolve(false)
      }
      const pending = readDataTransfer(items)
      return get().runImport('Opening dropped folder', () => pending)
    },
  }))
}

export type ProjectStore = ReturnType<typeof createProjectStore>

/** The app's single Project store. */
export const projectStore: ProjectStore = createProjectStore()
