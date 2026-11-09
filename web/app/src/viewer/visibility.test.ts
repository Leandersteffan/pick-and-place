import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/demo-v1/combined_output.gcode?raw'
import { parseGcode } from '../gcode/parser'
import { MOVE_TYPES } from '../gcode/types'
import {
  ALL_LAYERS_MAX,
  allTypesVisible,
  defaultLayerRanges,
  isVisible,
  layerRangeUniform,
  typeMaskUniform,
  uniformVisible,
  type LayerRange,
} from './visibility'

const parsed = parseGcode(fixture)
const moves = parsed.moves
const TRAVEL = MOVE_TYPES.indexOf('travel')
const EXTRUDE = MOVE_TYPES.indexOf('extrude')

function countVisible(mask: boolean[], ranges: (LayerRange | undefined)[]): number {
  let c = 0
  for (let i = 0; i < moves.n; i++) if (isVisible(moves.type[i], moves.segment[i], moves.layer[i], mask, ranges)) c++
  return c
}

/** isVisible and the shader test on built uniforms agree for every Fixture Move. */
function agrees(mask: boolean[], ranges: (LayerRange | undefined)[]): boolean {
  const tm = typeMaskUniform(mask)
  const lr = layerRangeUniform(ranges)
  for (let i = 0; i < moves.n; i++) {
    const t = moves.type[i], s = moves.segment[i], l = moves.layer[i]
    if (isVisible(t, s, l, mask, ranges) !== uniformVisible(t, s, l, tm, lr)) return false
  }
  return true
}

describe('isVisible', () => {
  it('needs the type enabled and the layer inside its own segment range', () => {
    const mask = allTypesVisible()
    const ranges: LayerRange[] = []
    ranges[1] = [2, 4]
    ranges[2] = [0, 25]
    expect(isVisible(EXTRUDE, 1, 3, mask, ranges)).toBe(true)
    expect(isVisible(EXTRUDE, 1, 2, mask, ranges)).toBe(true)
    expect(isVisible(EXTRUDE, 1, 4, mask, ranges)).toBe(true)
    expect(isVisible(EXTRUDE, 1, 5, mask, ranges)).toBe(false)
    expect(isVisible(EXTRUDE, 1, 1, mask, ranges)).toBe(false)
    // Layer 5 is fine in segment 2: each segment uses its own range.
    expect(isVisible(EXTRUDE, 2, 5, mask, ranges)).toBe(true)
    // A segment without a range shows every layer.
    expect(isVisible(EXTRUDE, 3, 999, mask, ranges)).toBe(true)
    mask[EXTRUDE] = false
    expect(isVisible(EXTRUDE, 1, 3, mask, ranges)).toBe(false)
    expect(isVisible(TRAVEL, 1, 3, mask, ranges)).toBe(true)
  })

  it('shows the whole Fixture with defaults and hides travel when masked', () => {
    const ranges = defaultLayerRanges(parsed.segments)
    expect(ranges[1]).toEqual([0, 7])
    expect(ranges[2]).toEqual([0, 25])
    expect(countVisible(allTypesVisible(), ranges)).toBe(moves.n)

    const mask = allTypesVisible()
    mask[TRAVEL] = false
    let travel = 0
    for (let i = 0; i < moves.n; i++) if (moves.type[i] === TRAVEL) travel++
    expect(travel).toBeGreaterThan(0)
    expect(countVisible(mask, ranges)).toBe(moves.n - travel)
  })

  it('a segment 2 layer range keeps the placement group at layer 11 and drops layer 12', () => {
    const ranges = defaultLayerRanges(parsed.segments)
    ranges[2] = [0, 11]
    const [g11, g12] = parsed.events.filter((e) => e.kind === 'placement_group')
    const at = (i: number) => isVisible(moves.type[i], moves.segment[i], moves.layer[i], allTypesVisible(), ranges)
    expect(at(g11.moveIndex)).toBe(true)
    expect(at(g12.moveIndex)).toBe(false)
  })
})

describe('uniform builders', () => {
  it('build uTypeMask[8] and uLayerRange[8]', () => {
    const mask = allTypesVisible()
    mask[TRAVEL] = false
    expect(Array.from(typeMaskUniform(mask))).toEqual(MOVE_TYPES.map((_, i) => (i === TRAVEL ? 0 : 1)))

    const ranges: LayerRange[] = []
    ranges[1] = [1, 7]
    const lr = layerRangeUniform(ranges)
    expect(lr).toHaveLength(16)
    expect(Array.from(lr.slice(2, 4))).toEqual([1, 7])
    expect(Array.from(lr.slice(4, 6))).toEqual([0, ALL_LAYERS_MAX])
  })

  it('agree with isVisible on every Fixture Move', () => {
    const ranges = defaultLayerRanges(parsed.segments)
    expect(agrees(allTypesVisible(), ranges)).toBe(true)

    const mask = allTypesVisible()
    mask[TRAVEL] = false
    mask[MOVE_TYPES.indexOf('z_hop')] = false
    const narrow: LayerRange[] = []
    narrow[1] = [3, 5]
    narrow[2] = [10, 12]
    expect(agrees(mask, narrow)).toBe(true)
    expect(agrees(mask, [])).toBe(true)
  })
})
