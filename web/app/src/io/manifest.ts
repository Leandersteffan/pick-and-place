// manifest.json of a .pnp.zip bundle or of the Fixture (design section 11).
// The type lives in model/project.ts so the Project can carry it; this module
// reads, checks and writes it.
import { canonicalJson } from '../model/canonicalJson'
import type { Manifest, ManifestFileEntry, OffsetSource, XY } from '../model/project'
import { sha256Hex } from './sha256'

export type { Manifest, ManifestFileEntry } from '../model/project'

export const MANIFEST_NAME = 'manifest.json'

export type ManifestRead = { ok: true; manifest: Manifest } | { ok: false; error: string }

const OFFSET_SOURCES: readonly OffsetSource[] = ['backend', 'manifest', 'gcode', 'mesh-bounds', 'default']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isXY(value: unknown): value is XY {
  return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number' && Number.isFinite(v))
}

function isFileEntry(value: unknown): value is ManifestFileEntry {
  return (
    isRecord(value) &&
    typeof value.sha256 === 'string' &&
    /^[0-9a-f]{64}$/i.test(value.sha256) &&
    typeof value.bytes === 'number'
  )
}

/** Parses manifest.json bytes. Checks only the fields the Importer relies on. */
export function readManifest(bytes: Uint8Array): ManifestRead {
  let data: unknown
  try {
    data = JSON.parse(new TextDecoder('utf-8').decode(bytes))
  } catch (err) {
    return { ok: false, error: `${MANIFEST_NAME} is not valid JSON: ${(err as Error).message}` }
  }
  if (!isRecord(data)) return { ok: false, error: `${MANIFEST_NAME} is not a JSON object` }
  if (data.bundle_format !== 1) {
    return { ok: false, error: `${MANIFEST_NAME}: unsupported bundle_format ${JSON.stringify(data.bundle_format)}` }
  }
  if (!isRecord(data.files)) return { ok: false, error: `${MANIFEST_NAME}: "files" is missing or not an object` }
  for (const [name, entry] of Object.entries(data.files)) {
    if (!isFileEntry(entry)) return { ok: false, error: `${MANIFEST_NAME}: bad entry for "${name}" in "files"` }
  }
  const offsets = data.offsets
  if (offsets !== undefined) {
    if (!isRecord(offsets) || !isXY(offsets.tray) || !isXY(offsets.model)) {
      return { ok: false, error: `${MANIFEST_NAME}: "offsets" needs tray and model as [x, y]` }
    }
    if (offsets.source !== undefined && !OFFSET_SOURCES.includes(offsets.source as OffsetSource)) {
      return { ok: false, error: `${MANIFEST_NAME}: unknown offsets source ${JSON.stringify(offsets.source)}` }
    }
  }
  return { ok: true, manifest: data as unknown as Manifest }
}

/** Keys whose values the manifest writes as integers (no `.0`). */
export const MANIFEST_INTEGER_KEYS = ['bundle_format', 'spec_version', 'bytes'] as const

/** ISO 8601 UTC to the second, e.g. `2026-11-08T10:36:00Z`. */
export function isoUtc(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('isoUtc: invalid date')
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export interface ManifestInput {
  webAppVersion: string
  /** null when unknown (Requirement 15.2). */
  pipelineVersion: string | null
  createdUtc: Date
  gcodeStale: boolean
  offsets: { tray: XY; model: XY; source: OffsetSource }
  /** Every bundle file except manifest.json. */
  files: Record<string, Uint8Array>
}

/** Builds the Manifest: SHA-256 and byte count of every file, keys sorted. */
export async function buildManifest(input: ManifestInput): Promise<Manifest> {
  const files: Record<string, ManifestFileEntry> = {}
  for (const name of Object.keys(input.files).filter((n) => n !== MANIFEST_NAME).sort()) {
    const bytes = input.files[name]
    files[name] = { sha256: await sha256Hex(bytes), bytes: bytes.length }
  }
  const { tray, model, source } = input.offsets
  return {
    bundle_format: 1,
    spec_version: 1,
    web_app_version: input.webAppVersion,
    pipeline_version: input.pipelineVersion,
    created_utc: isoUtc(input.createdUtc),
    gcode_stale: input.gcodeStale,
    offsets: { tray: [tray[0], tray[1]], model: [model[0], model[1]], source },
    files,
  }
}

/** manifest.json bytes: canonicalJson with LF line endings. */
export function writeManifest(manifest: Manifest): Uint8Array {
  return new TextEncoder().encode(canonicalJson(manifest, { integerKeys: MANIFEST_INTEGER_KEYS }))
}
