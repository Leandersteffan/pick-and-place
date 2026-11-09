// Importer (design section 4, Requirements 1.1 to 1.7, 3.1, 3.3).
//
// The core is `importFiles`, a pure async function over flat file names and raw
// bytes, so it runs in Node under Vitest. fixture.ts, folder.ts and
// `importBundle` below only collect bytes and hand them over.
//
// The gcode is kept as bytes in `project.files`. It is parsed here only to
// derive Bed_Space offsets when there is no Manifest.
import { unzipSync } from 'fflate'
import { deriveContactPoints } from '../model/contactPoints'
import { parseGcode } from '../gcode/parser'
import { deriveOffsetsFromGcode, isU1, offsetSpreadWarning, offsetsFromMeshes, type Bounds2 } from '../model/offsets'
import type { BedOffsets, ImportWarning, Manifest, Project } from '../model/project'
import type { Spec } from '../model/spec'
import { validateSpec } from '../schema/validate'
import { MANIFEST_NAME, readManifest } from './manifest'
import { sha256Hex } from './sha256'
import { meshBounds, readStl } from './stl'
import { readThreeMf } from './threemf'

export type ImportSource = 'fixture' | 'bundle' | 'folder'

export interface ImportOptions {
  /** Project name; defaults to a name derived from the source. */
  name?: string
  /** Shown in the "spec.json is missing from <input>" error; defaults to the source kind. */
  inputLabel?: string
  /** Without spec.json but with a gcode file, open a gcode-only Project instead of failing. */
  allowGcodeOnly?: boolean
}

export type ImportResult = { ok: true; project: Project } | { ok: false; error: string }

export const SPEC_NAME = 'spec.json'
export const TRAY_NAME = 'tray.stl'
export const GCODE_NAME = 'combined_output.gcode'
const HOUSING_NAMES = ['housing.3mf', 'housing.stl'] as const

/** Files the Project keeps: meshes and the gcode. spec.json lives in project.spec. */
function isProjectFile(name: string): boolean {
  return name === GCODE_NAME || /\.(stl|3mf)$/i.test(name)
}

/** Slicer leftovers of the pipeline; never the printer file. */
const NOT_COMBINED_GCODE = new Set(['setup.gcode', 'part.gcode'])

/**
 * The gcode file to show: `combined_output.gcode`, else the first other
 * `*.gcode` by name (e.g. `U1_output.gcode`), else null.
 */
export function pickGcodeName(files: Record<string, Uint8Array>): string | null {
  if (files[GCODE_NAME]) return GCODE_NAME
  const other = Object.keys(files)
    .filter((n) => /\.(gcode|gco)$/i.test(n) && !NOT_COMBINED_GCODE.has(n.toLowerCase()))
    .sort()
  return other[0] ?? null
}

/**
 * Placeholder Spec of a gcode-only Project: no parts, no meshes. It is never
 * validated or exported; `project.gcodeOnly` marks it.
 */
export function gcodeOnlySpec(): Spec {
  return {
    version: 1,
    printer: 'unknown',
    use_trace_braid: false,
    housing: 'housing.3mf',
    tray: 'generated',
    tray_spacing: 3,
    tray_origin: { x: 0, y: 0, z: 0 },
    parts: [],
  }
}

/**
 * A Project around a bare gcode file (any slicer). The gcode is stored as
 * `combined_output.gcode`; offsets are (0, 0) because the gcode is already in
 * Bed_Space and the scene shows only the bed and the toolpath.
 */
export function gcodeOnlyProject(bytes: Uint8Array, name: string, source: Project['source'] = 'gcode'): Project {
  const spec = gcodeOnlySpec()
  return {
    id: globalThis.crypto.randomUUID(),
    name,
    spec,
    partUids: [],
    files: { [GCODE_NAME]: bytes },
    gcodeStale: false,
    offsets: { tray: [0, 0], model: [0, 0], source: 'default' },
    contactPoints: [],
    baseline: { spec: structuredClone(spec), partUids: [] },
    warnings: [],
    source,
    gcodeOnly: true,
  }
}

/** Imports one bare `.gcode` file. Fails only on an empty file. */
export function importGcode(bytes: Uint8Array, fileName: string): ImportResult {
  if (bytes.length === 0) return { ok: false, error: `${fileName} is empty` }
  const name = fileName.replace(/^.*[\\/]/, '').replace(/\.(gcode|gco)$/i, '') || 'gcode'
  return { ok: true, project: gcodeOnlyProject(bytes, name) }
}

const SOURCE_LABEL: Record<ImportSource, string> = {
  fixture: 'the demo fixture',
  bundle: 'the bundle',
  folder: 'the folder',
}

/** Line and column of a character offset, 1-based. */
function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

/** Parses spec.json text; on failure the message names spec.json and the position. */
function parseSpecText(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  // Strip a UTF-8 BOM; JSON.parse rejects it.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  try {
    return { ok: true, value: JSON.parse(body) }
  } catch (err) {
    const message = (err as Error).message
    // V8: "... at position 123" and, in newer versions, "(line 4 column 5)".
    const lc = /line (\d+) column (\d+)/.exec(message)
    const pos = /position (\d+)/.exec(message)
    let where = ''
    if (lc) where = ` at line ${lc[1]}, column ${lc[2]}`
    else if (pos) {
      const { line, column } = lineColumn(body, Number(pos[1]))
      where = ` at line ${line}, column ${column}`
    }
    return { ok: false, error: `spec.json is not valid JSON${where}: ${message}` }
  }
}

async function checkHashes(
  files: Record<string, Uint8Array>,
  manifest: Manifest,
  warnings: ImportWarning[],
): Promise<void> {
  const listed = manifest.files
  const names = new Set([...Object.keys(listed), ...Object.keys(files)])
  names.delete(MANIFEST_NAME)
  for (const name of [...names].sort()) {
    const entry = listed[name]
    const bytes = files[name]
    if (!entry) {
      warnings.push({ kind: 'hash-mismatch', file: name, message: `${name} is not listed in ${MANIFEST_NAME}` })
    } else if (!bytes) {
      warnings.push({ kind: 'hash-mismatch', file: name, message: `${name} is listed in ${MANIFEST_NAME} but missing` })
    } else {
      const actual = await sha256Hex(bytes)
      if (actual !== entry.sha256.toLowerCase()) {
        warnings.push({
          kind: 'hash-mismatch',
          file: name,
          message: `${name} does not match its ${MANIFEST_NAME} hash (expected ${entry.sha256}, got ${actual})`,
        })
      }
    }
  }
}

/** Housing file to display: spec.housing, else the other format if present, else null. */
export function housingFile(spec: Pick<Spec, 'housing'>, files: Record<string, Uint8Array>): string | null {
  if (files[spec.housing]) return spec.housing
  return HOUSING_NAMES.find((name) => files[name]) ?? null
}

function checkMeshes(spec: Spec, files: Record<string, Uint8Array>, warnings: ImportWarning[]): void {
  const housing = housingFile(spec, files)
  if (!files[spec.housing]) {
    warnings.push({
      kind: 'missing-mesh',
      file: spec.housing,
      message: housing
        ? `${spec.housing} is missing; showing ${housing} instead`
        : `${spec.housing} is missing; the housing is not shown`,
    })
  }
  if (housing && /\.3mf$/i.test(housing)) {
    try {
      warnings.push(...readThreeMf(files[housing], housing).warnings)
    } catch (err) {
      warnings.push({ kind: 'missing-mesh', file: housing, message: `${housing} could not be read: ${(err as Error).message}` })
    }
  }
  const parts = Array.isArray(spec.parts) ? spec.parts : []
  const meshes = new Set<string>()
  for (const part of parts) {
    if ((part.type === 'pcb' || part.type === 'print') && typeof part.mesh === 'string') meshes.add(part.mesh)
  }
  meshes.add(TRAY_NAME)
  for (const name of meshes) {
    if (!files[name]) {
      warnings.push({ kind: 'missing-mesh', file: name, message: `${name} is missing; it is not shown` })
    }
  }
}

const THREEMF_VERTEX_RE = /vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g

/**
 * XY bounds of the raw vertices, read the way `geometry.mesh_bounds` reads
 * them: every `vertex` of every `*.model` entry for 3MF (doubles, unreferenced
 * vertices included, transforms ignored), every vertex record for STL.
 * Null when the file is missing, unreadable or empty.
 */
function fileBounds(files: Record<string, Uint8Array>, name: string | null): Bounds2 | null {
  const bytes = name ? files[name] : undefined
  if (!name || !bytes) return null
  try {
    if (/\.stl$/i.test(name)) {
      const b = meshBounds(readStl(bytes).positions)
      return b ? [b[0], b[1], b[2], b[3]] : null
    }
    const entries = unzipSync(bytes, { filter: (entry) => entry.name.endsWith('.model') })
    const decoder = new TextDecoder('utf-8')
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let count = 0
    for (const entry of Object.keys(entries)) {
      for (const m of decoder.decode(entries[entry]).matchAll(THREEMF_VERTEX_RE)) {
        const x = parseFloat(m[1])
        const y = parseFloat(m[2])
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        count++
      }
    }
    return count > 0 ? [minX, minY, maxX, maxY] : null
  } catch {
    return null
  }
}

/**
 * Offsets source priority: manifest, then gcode, then mesh-bounds (U1), then
 * default with a warning. The manifest comes first because it holds what the
 * backend computed when the bundle was made; the gcode is parsed only when
 * there are no manifest offsets.
 */
function initialOffsets(
  manifest: Manifest | undefined,
  spec: Spec,
  files: Record<string, Uint8Array>,
  warnings: ImportWarning[],
): BedOffsets {
  const o = manifest?.offsets
  if (o && o.tray && o.model) {
    return { tray: [o.tray[0], o.tray[1]], model: [o.model[0], o.model[1]], source: 'manifest' }
  }
  const gcode = files[GCODE_NAME]
  if (gcode) {
    try {
      const derived = deriveOffsetsFromGcode(spec, parseGcode(new TextDecoder('utf-8').decode(gcode)))
      if (derived) {
        const spread = offsetSpreadWarning(derived)
        if (spread) warnings.push(spread)
        return derived
      }
    } catch {
      // An unreadable gcode or a malformed Spec falls through to mesh-bounds.
    }
  }
  const tray = isU1(spec.printer) ? fileBounds(files, TRAY_NAME) : null
  const model = isU1(spec.printer) ? fileBounds(files, housingFile(spec, files)) : null
  const resolved = offsetsFromMeshes(spec.printer, tray, model)
  warnings.push(...resolved.warnings)
  return resolved.offsets
}

function defaultName(source: ImportSource, spec: Spec): string {
  if (source === 'fixture') return 'demo-v1'
  return typeof spec.printer === 'string' ? `${spec.printer} project` : 'project'
}

/**
 * Builds a Project from flat file names (`spec.json`, `housing.3mf`,
 * `part-2.stl`, `tray.stl`, `combined_output.gcode`, optional `manifest.json`).
 * Aborts only when spec.json is missing or not JSON. Schema errors, hash
 * mismatches and missing meshes become warnings.
 */
export async function importFiles(
  files: Record<string, Uint8Array>,
  source: ImportSource,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const specBytes = files[SPEC_NAME]
  const gcodeName = pickGcodeName(files)
  if (!specBytes) {
    if (opts.allowGcodeOnly && gcodeName) {
      const project = gcodeOnlyProject(files[gcodeName], opts.name ?? gcodeName.replace(/\.(gcode|gco)$/i, ''), source)
      // A gcode-only bundle from the Exporter carries a Manifest: check its hashes
      // and keep its stale flag and pipeline version.
      const manifestBytes = files[MANIFEST_NAME]
      if (manifestBytes) {
        const read = readManifest(manifestBytes)
        if (read.ok) {
          await checkHashes(files, read.manifest, project.warnings)
          project.manifest = read.manifest
          project.gcodeStale = read.manifest.gcode_stale ?? false
          if (typeof read.manifest.pipeline_version === 'string') project.pipelineVersion = read.manifest.pipeline_version
        } else {
          project.warnings.push({ kind: 'hash-mismatch', file: MANIFEST_NAME, message: `${read.error}; file hashes were not checked` })
        }
      }
      return { ok: true, project }
    }
    return { ok: false, error: `spec.json is missing from ${opts.inputLabel ?? SOURCE_LABEL[source]}` }
  }
  const parsed = parseSpecText(new TextDecoder('utf-8').decode(specBytes))
  if (!parsed.ok) return parsed
  if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
    return { ok: false, error: 'spec.json is not a JSON object' }
  }
  const spec = parsed.value as Spec
  const warnings: ImportWarning[] = []

  const verdict = validateSpec(spec)
  for (const e of verdict.errors) {
    warnings.push({ kind: 'schema', file: SPEC_NAME, message: `${e.pointer || '/'}: ${e.message}` })
  }

  let manifest: Manifest | undefined
  const manifestBytes = files[MANIFEST_NAME]
  if (manifestBytes) {
    const read = readManifest(manifestBytes)
    if (read.ok) {
      manifest = read.manifest
      await checkHashes(files, manifest, warnings)
    } else {
      warnings.push({ kind: 'hash-mismatch', file: MANIFEST_NAME, message: `${read.error}; file hashes were not checked` })
    }
  }

  const projectFiles: Record<string, Uint8Array> = {}
  for (const [name, bytes] of Object.entries(files)) {
    if (isProjectFile(name)) projectFiles[name] = bytes
  }
  // A gcode under another name (e.g. U1_output.gcode) is shown as the combined file.
  if (gcodeName && gcodeName !== GCODE_NAME) projectFiles[GCODE_NAME] = files[gcodeName]
  checkMeshes(spec, projectFiles, warnings)

  const parts = Array.isArray(spec.parts) ? spec.parts : []
  const partUids = parts.map(() => globalThis.crypto.randomUUID())
  let contactPoints: Project['contactPoints'] = []
  try {
    contactPoints = deriveContactPoints({ ...spec, parts })
  } catch {
    // A Spec that fails the schema can have any shape; contact points stay empty.
  }

  const project: Project = {
    id: globalThis.crypto.randomUUID(),
    name: opts.name ?? defaultName(source, spec),
    spec,
    partUids,
    files: projectFiles,
    gcodeStale: manifest?.gcode_stale ?? false,
    offsets: initialOffsets(manifest, spec, projectFiles, warnings),
    contactPoints,
    baseline: { spec: structuredClone(spec), partUids: [...partUids] },
    warnings,
    source,
  }
  if (manifest) project.manifest = manifest
  if (typeof manifest?.pipeline_version === 'string') project.pipelineVersion = manifest.pipeline_version
  return { ok: true, project }
}

/** Unzips a .pnp.zip (flat names) and imports it. */
export async function importBundle(bytes: Uint8Array, fileName = 'bundle.pnp.zip'): Promise<ImportResult> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch (err) {
    return { ok: false, error: `${fileName} is not a readable zip file: ${(err as Error).message}` }
  }
  const files: Record<string, Uint8Array> = {}
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/')) continue
    const name = path.split('/').pop() as string
    if (!(name in files)) files[name] = data
  }
  const name = fileName.replace(/\.pnp\.zip$/i, '').replace(/\.zip$/i, '')
  // A gcode-only bundle says so in its Manifest: it lists no spec.json. Any other
  // bundle without spec.json is a failed import.
  const manifestBytes = files[MANIFEST_NAME]
  const read = manifestBytes ? readManifest(manifestBytes) : null
  const allowGcodeOnly = read?.ok === true && !(SPEC_NAME in read.manifest.files)
  return importFiles(files, 'bundle', { name, inputLabel: fileName, allowGcodeOnly })
}
