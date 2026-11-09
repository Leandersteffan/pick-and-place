// Toolpath visibility filters (design section 6; Requirements 6.8, 6.9).
//
// The shader decides visibility from two uniforms, `uTypeMask[8]` and
// `uLayerRange[8]`. `isVisible` is the CPU reference the tests pin, and
// `uniformVisible` evaluates the uniforms exactly as the shader does, so the two
// can be compared. Pure, no three.js.
import { MOVE_TYPES, type Segment } from '../gcode/types'

/** Uniform array length; segment indices above this clamp to the last slot. */
export const MAX_SEGMENTS = 8
/** Upper bound used for "all layers" (MoveTable.layer is Uint16). */
export const ALL_LAYERS_MAX = 65535

/** Inclusive [min, max] layer. */
export type LayerRange = readonly [number, number]
/** Indexed by segment index (1-based); a missing entry shows every layer. */
export type LayerRanges = readonly (LayerRange | undefined)[]

/** All 8 Move_Types on. */
export function allTypesVisible(): boolean[] {
  return MOVE_TYPES.map(() => true)
}

/** Default per-segment ranges: 0 (prelude, post-PAUSE wipe) to layerCount. */
export function defaultLayerRanges(segments: readonly Segment[]): LayerRange[] {
  const out: LayerRange[] = []
  for (const s of segments) out[s.index] = [0, s.layerCount]
  return out
}

/** CPU reference: type enabled and layer inside its own segment's range. */
export function isVisible(type: number, seg: number, layer: number, mask: readonly boolean[], ranges: LayerRanges): boolean {
  if (!mask[type]) return false
  const r = ranges[seg]
  if (!r) return true
  return layer >= r[0] && layer <= r[1]
}

/** `uTypeMask[8]`: 1 for an enabled type, else 0. */
export function typeMaskUniform(mask: readonly boolean[]): Float32Array {
  const out = new Float32Array(MOVE_TYPES.length)
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? 1 : 0
  return out
}

/** `uLayerRange[8]` flattened as 16 floats (min, max per segment slot). */
export function layerRangeUniform(ranges: LayerRanges): Float32Array {
  const out = new Float32Array(2 * MAX_SEGMENTS)
  for (let s = 0; s < MAX_SEGMENTS; s++) {
    const r = ranges[s]
    out[2 * s] = r ? r[0] : 0
    out[2 * s + 1] = r ? r[1] : ALL_LAYERS_MAX
  }
  return out
}

/** The shader's test, run on the CPU against built uniforms. */
export function uniformVisible(type: number, seg: number, layer: number, typeMask: Float32Array, layerRange: Float32Array): boolean {
  const ti = Math.min(MOVE_TYPES.length - 1, Math.max(0, Math.round(type)))
  const si = Math.min(MAX_SEGMENTS - 1, Math.max(0, Math.round(seg)))
  const min = layerRange[2 * si]
  const max = layerRange[2 * si + 1]
  return typeMask[ti] > 0.5 && layer >= min - 0.5 && layer <= max + 0.5
}

/** Slider label for a segment: 1 is the tray, 2 the housing. */
export function segmentLabel(index: number): string {
  return index === 1 ? 'Tray' : index === 2 ? 'Housing' : `Segment ${index}`
}

/**
 * Sets the min (`bound` 0) or max (`bound` 1) of a layer range, rounded and clamped to
 * [0, layerCount]. The other bound moves along when they would cross, so min <= max.
 */
export function withLayerBound(range: LayerRange, bound: 0 | 1, value: number, layerCount: number): LayerRange {
  const top = Math.max(0, layerCount)
  const v = Math.min(top, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))
  if (bound === 0) return [v, Math.max(v, Math.min(top, range[1]))]
  return [Math.min(v, Math.max(0, range[0])), v]
}
