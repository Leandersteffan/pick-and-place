import type { Overrides, Spec, Vec3 } from './spec'

export type XY = [number, number]

export type OffsetSource = 'backend' | 'manifest' | 'gcode' | 'mesh-bounds' | 'default'

/** Bed = Design + offset */
export interface BedOffsets {
  tray: XY
  model: XY
  source: OffsetSource
  /** max disagreement between parts when derived from gcode */
  spreadMm?: number
}

export interface ContactPoint extends Vec3 {
  overrides?: Overrides
  origin: 'prinjection' | 'tamp3'
}

export interface ImportWarning {
  kind: 'hash-mismatch' | 'missing-mesh' | 'schema' | '3mf-transform' | 'offset-spread' | 'offsets-default'
  file?: string
  message: string
}

export interface ManifestFileEntry {
  sha256: string
  bytes: number
}

/** manifest.json of a .pnp.zip bundle or of the Fixture. */
export interface Manifest {
  bundle_format: 1
  spec_version: 1
  web_app_version: string
  /** null if unknown */
  pipeline_version: string | null
  created_utc: string
  gcode_stale: boolean
  offsets: { tray: XY; model: XY; source: OffsetSource }
  /** keys sorted; manifest.json itself is not listed */
  files: Record<string, ManifestFileEntry>
}

export interface Project {
  /** uuid, kept across autosave */
  id: string
  name: string
  spec: Spec
  /** parallel to spec.parts, stable across edits */
  partUids: string[]
  /** raw bytes: housing.*, part-*.stl, tray.stl, combined_output.gcode */
  files: Record<string, Uint8Array>
  gcodeStale: boolean
  /**
   * Set by edits that change trace geometry (translate trace or pcb, add,
   * delete). Turns on `recompute_tamps` for the next Regenerate.
   */
  traceGeometryDirty?: boolean
  /**
   * Part indices of traces added in the Editor since the last Regenerate. Sent
   * as `options.auto_place` so the Intersection_Port picks a safe `place`.
   */
  autoPlace?: number[]
  offsets: BedOffsets
  /** Design_Space */
  contactPoints: ContactPoint[]
  /** spec at import or last successful Regenerate (for Diff_View) */
  baseline: { spec: Spec; partUids: string[] }
  manifest?: Manifest
  pipelineVersion?: string
  warnings: ImportWarning[]
  source: 'fixture' | 'bundle' | 'folder' | 'autosave' | 'gcode'
  /**
   * Opened from a bare gcode file without spec.json. `spec` is a placeholder
   * with no parts; the viewer shows only the bed and the toolpath.
   */
  gcodeOnly?: boolean
}
