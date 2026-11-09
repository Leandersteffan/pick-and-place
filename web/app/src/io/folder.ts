// Rhino_Output_Folder import (Requirement 1.3).
//
// The Rhino Slice button writes `output/` with `spec/spec.json`,
// `spec/housing.3mf|stl`, `spec/part-*.stl`, `spec/tray.stl` and
// `combined_output.gcode` at the root. `setup.gcode`, `part.gcode`, `*_orca/`
// directories and `slice_log.txt` are slicer leftovers and are ignored.
//
// `mapFolderFiles` is the pure path mapping (tested in Node). `readFileList`
// (from `<input webkitdirectory>`) and `readDataTransfer` (a dropped directory)
// are thin DOM wrappers that collect relative paths and bytes.
import { importFiles, type ImportResult } from './importer'

const IGNORED_NAMES = new Set(['setup.gcode', 'part.gcode', 'slice_log.txt'])
const SPEC_DIR_FILE = /^(spec\.json|.+\.stl|.+\.3mf)$/i
const ROOT_FILE = 'combined_output.gcode'
/** Any other gcode at the root (e.g. `U1_output.gcode`); used when combined_output.gcode is absent. */
const GCODE_FILE = /\.(gcode|gco)$/i

function isIgnoredDir(segment: string): boolean {
  return /_orca$/i.test(segment)
}

function splitPath(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.')
}

/**
 * Maps relative paths to the Importer's flat names. Paths may still start with
 * the selected folder's own name (as `webkitRelativePath` does); a first
 * segment shared by every path is dropped. The user may also select the
 * `spec/` folder itself, in which case its files sit at the root.
 */
export function mapFolderFiles(entries: Record<string, Uint8Array>): Record<string, Uint8Array> {
  let paths = Object.keys(entries).map((p) => ({ parts: splitPath(p), bytes: entries[p] }))
  const first = paths[0]?.parts[0]
  if (first !== undefined && paths.every((p) => p.parts.length >= 2 && p.parts[0] === first) && first !== 'spec') {
    paths = paths.map((p) => ({ parts: p.parts.slice(1), bytes: p.bytes }))
  }
  paths = paths.filter((p) => p.parts.length > 0 && !p.parts.slice(0, -1).some(isIgnoredDir))

  const hasSpecDir = paths.some((p) => p.parts.length === 2 && p.parts[0].toLowerCase() === 'spec')
  const out: Record<string, Uint8Array> = {}
  for (const { parts, bytes } of paths) {
    const name = parts[parts.length - 1]
    if (IGNORED_NAMES.has(name.toLowerCase())) continue
    if (parts.length === 2 && parts[0].toLowerCase() === 'spec' && SPEC_DIR_FILE.test(name)) {
      out[name] = bytes
    } else if (parts.length === 1 && GCODE_FILE.test(name)) {
      out[name] = bytes
    } else if (parts.length === 1 && !hasSpecDir && SPEC_DIR_FILE.test(name)) {
      // The spec/ folder itself was selected.
      if (!(name in out)) out[name] = bytes
    }
  }
  return out
}

/** Imports already collected `{ relativePath: bytes }` of a Rhino_Output_Folder. */
export function importFolderEntries(entries: Record<string, Uint8Array>, folderName?: string): Promise<ImportResult> {
  const label = folderName ? `the folder "${folderName}" (expected spec/spec.json)` : 'the folder (expected spec/spec.json)'
  const files = mapFolderFiles(entries)
  // A folder holding only gcode opens gcode-only. A Rhino folder with meshes but
  // no spec.json is still a failed import (Requirement 1.4).
  const allowGcodeOnly = !Object.keys(files).some((n) => /\.(stl|3mf)$/i.test(n))
  return importFiles(files, 'folder', { name: folderName, inputLabel: label, allowGcodeOnly })
}

function wanted(path: string): boolean {
  const parts = splitPath(path)
  const name = parts[parts.length - 1] ?? ''
  if (parts.slice(0, -1).some(isIgnoredDir) || IGNORED_NAMES.has(name.toLowerCase())) return false
  return name === ROOT_FILE || GCODE_FILE.test(name) || SPEC_DIR_FILE.test(name)
}

/** `<input type="file" webkitdirectory>` selection. */
export async function readFileList(list: FileList | File[]): Promise<ImportResult> {
  const files = Array.from(list)
  const entries: Record<string, Uint8Array> = {}
  await Promise.all(
    files.map(async (file) => {
      const path = file.webkitRelativePath || file.name
      if (!wanted(path)) return
      entries[path] = new Uint8Array(await file.arrayBuffer())
    }),
  )
  const folderName = splitPath(files[0]?.webkitRelativePath ?? '')[0]
  return importFolderEntries(entries, folderName)
}

function readDirectory(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader()
  const all: FileSystemEntry[] = []
  return new Promise((resolve, reject) => {
    // readEntries returns batches (Chrome: 100) until an empty batch.
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all)
        else {
          all.push(...batch)
          next()
        }
      }, reject)
    next()
  })
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function walk(entry: FileSystemEntry, prefix: string, out: Record<string, Uint8Array>): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name
  if (entry.isDirectory) {
    if (isIgnoredDir(entry.name)) return
    const children = await readDirectory(entry as FileSystemDirectoryEntry)
    await Promise.all(children.map((child) => walk(child, path, out)))
  } else if (entry.isFile && wanted(path)) {
    const file = await entryFile(entry as FileSystemFileEntry)
    out[path] = new Uint8Array(await file.arrayBuffer())
  }
}

/** A directory dropped onto the page (`DataTransferItem.webkitGetAsEntry`). */
export async function readDataTransfer(items: DataTransferItemList): Promise<ImportResult> {
  // Entries must be taken synchronously, before the drop event ends.
  const roots = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null)
  const entries: Record<string, Uint8Array> = {}
  await Promise.all(roots.map((root) => walk(root, '', entries)))
  const folderName = roots.length === 1 && roots[0].isDirectory ? roots[0].name : undefined
  return importFolderEntries(entries, folderName)
}
