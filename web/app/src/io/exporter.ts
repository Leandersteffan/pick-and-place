// Exporter (design section 11, Requirements 15.1 to 15.4).
//
// A Project becomes a flat .pnp.zip: spec.json written by canonicalJson, the
// meshes and the gcode exactly as the Project holds them, and manifest.json.
// A gcode-only Project exports its gcode and the manifest; the Importer opens
// such a bundle back as gcode-only because its manifest lists no spec.json.
import pkg from '../../package.json'
import { canonicalJson } from '../model/canonicalJson'
import type { Project } from '../model/project'
import { BUNDLE_EXTENSION, writeZip } from './bundle'
import { GCODE_NAME, SPEC_NAME } from './importer'
import { buildManifest, MANIFEST_NAME, writeManifest } from './manifest'

export const WEB_APP_VERSION: string = typeof pkg.version === 'string' ? pkg.version : '0.1.0'

export interface ExportOptions {
  /** Creation time for the Manifest; defaults to now. Injected by tests. */
  createdUtc?: Date
}

/** spec.json bytes: canonical key order and Python json formatting, LF line endings. */
export function specJsonBytes(project: Pick<Project, 'spec'>): Uint8Array {
  return new TextEncoder().encode(canonicalJson(project.spec, { normalize: true }))
}

/** The files of the bundle except manifest.json. */
export function bundleFiles(project: Project): Record<string, Uint8Array> {
  if (project.gcodeOnly) {
    const gcode = project.files[GCODE_NAME]
    return gcode ? { [GCODE_NAME]: gcode } : {}
  }
  const files: Record<string, Uint8Array> = { [SPEC_NAME]: specJsonBytes(project) }
  for (const [name, bytes] of Object.entries(project.files)) {
    if (name === SPEC_NAME || name === MANIFEST_NAME) continue
    files[name] = bytes
  }
  return files
}

/** Builds the .pnp.zip bytes of a Project. */
export async function exportBundle(project: Project, opts: ExportOptions = {}): Promise<Uint8Array> {
  const files = bundleFiles(project)
  const manifest = await buildManifest({
    webAppVersion: WEB_APP_VERSION,
    pipelineVersion: project.pipelineVersion ?? null,
    createdUtc: opts.createdUtc ?? new Date(),
    gcodeStale: project.gcodeStale,
    offsets: project.offsets,
    files,
  })
  return writeZip({ ...files, [MANIFEST_NAME]: writeManifest(manifest) })
}

/** `<name>.pnp.zip` with characters that are unsafe in file names replaced by `_`. */
export function bundleFileName(name: string): string {
  let base = name
    .replace(/\.pnp\.zip$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
  if (!base) base = 'project'
  return base.slice(0, 120) + BUNDLE_EXTENSION
}

/** Saves bytes as a file through a temporary `<a download>`. */
export function downloadBytes(bytes: Uint8Array, fileName: string, type = 'application/zip'): void {
  const blob = new Blob([bytes as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    // Revoke after the click has been handled, so the download can start.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/** Exports the Project and downloads it as `<name>.pnp.zip`. */
export async function downloadBundle(project: Project): Promise<string> {
  const fileName = bundleFileName(project.name)
  downloadBytes(await exportBundle(project), fileName)
  return fileName
}
