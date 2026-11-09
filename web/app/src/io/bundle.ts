// Deterministic .pnp.zip writer (design section 11, Requirement 15.1).
//
// Entry order: spec.json, housing.3mf, housing.stl, part-*.stl in natural
// order, other meshes by name, tray.stl, combined_output.gcode, other files by
// name, manifest.json last (it is written after the hashes of everything else).
// Every entry gets the same fixed mtime, so two zips of the same files are
// byte-identical.
import { zipSync, type Zippable } from 'fflate'
import { MANIFEST_NAME } from './manifest'

export const BUNDLE_EXTENSION = '.pnp.zip'
export const ZIP_LEVEL = 6

/**
 * 1980-01-01 00:00, the earliest DOS date. fflate encodes mtime with local-time
 * getters, so the Date is built in local time: every timezone then writes the
 * same DOS timestamp (a UTC midnight would be 1979 west of Greenwich, which
 * DOS time cannot hold).
 */
export function fixedMtime(): Date {
  return new Date(1980, 0, 1, 0, 0, 0)
}

const PART_RE = /^part-(\d+)\.stl$/i

function rank(name: string): number {
  const lower = name.toLowerCase()
  if (lower === 'spec.json') return 0
  if (lower === 'housing.3mf') return 1
  if (lower === 'housing.stl') return 2
  if (PART_RE.test(name)) return 3
  if (lower === 'tray.stl') return 5
  if (/\.(stl|3mf)$/i.test(name)) return 4
  if (lower === 'combined_output.gcode') return 6
  if (lower === MANIFEST_NAME) return 8
  return 7
}

function compareNames(a: string, b: string): number {
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  const pa = PART_RE.exec(a)
  const pb = PART_RE.exec(b)
  if (pa && pb && pa[1] !== pb[1]) return Number(pa[1]) - Number(pb[1])
  return a < b ? -1 : a > b ? 1 : 0
}

/** Bundle entry names in their fixed order. */
export function orderBundleNames(names: Iterable<string>): string[] {
  return [...names].sort(compareNames)
}

/** Zips flat files in the fixed order, level 6, fixed mtime. Bytes are stored as given. */
export function writeZip(files: Record<string, Uint8Array>): Uint8Array {
  const entries: Zippable = {}
  for (const name of orderBundleNames(Object.keys(files))) entries[name] = files[name]
  return zipSync(entries, { level: ZIP_LEVEL, mtime: fixedMtime() })
}
