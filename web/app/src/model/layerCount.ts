// Housing layer count for the pause_layer range check (Requirement 12.4).
//
// The Spec has no layer count field. With gcode loaded, the count is the
// number of `;LAYER_CHANGE` lines in Segment 2 (the housing). Without gcode it
// is ceil(housing mesh Z max / 0.2).
import type { Segment } from '../gcode/types'
import { readThreeMf } from '../io/threemf'
import { meshBounds, readStl } from '../io/stl'

export const LAYER_HEIGHT_MM = 0.2

/** Layer count from the housing's Z max; the 1e-9 keeps 5.0 / 0.2 at 25. */
export function layersFromZMax(zMax: number): number {
  return Math.ceil(zMax / LAYER_HEIGHT_MM - 1e-9)
}

const zMaxCache = new WeakMap<Uint8Array, number | null>()

/** Z max of a housing file (3MF or STL), or null if it has no vertices. Cached per byte array. */
export function housingZMax(name: string, bytes: Uint8Array): number | null {
  if (zMaxCache.has(bytes)) return zMaxCache.get(bytes) ?? null
  let z: number | null = null
  try {
    const positions = /\.3mf$/i.test(name) ? readThreeMf(bytes, name).positions : readStl(bytes).positions
    const b = meshBounds(positions)
    z = b ? b[5] : null
  } catch {
    z = null
  }
  zMaxCache.set(bytes, z)
  return z
}

/**
 * Segment 2 `layerCount` if the gcode has a Segment 2, else the count from
 * the housing Z max, else 0 (unknown).
 */
export function layerCount(segments: readonly Segment[] | null | undefined, zMax: number | null): number {
  const housing = segments?.find((s) => s.index === 2)
  if (housing) return housing.layerCount
  if (zMax !== null && Number.isFinite(zMax) && zMax > 0) return layersFromZMax(zMax)
  return 0
}
