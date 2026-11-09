import { describe, expect, it } from 'vitest'
import { getMove, MOVE_TYPES, type MoveTable } from './types'

function table(n: number): MoveTable {
  return {
    n,
    x0: new Float64Array(n), y0: new Float64Array(n), z0: new Float64Array(n),
    x1: new Float64Array(n), y1: new Float64Array(n), z1: new Float64Array(n),
    e: new Float32Array(n), f: new Float32Array(n),
    type: new Uint8Array(n), segment: new Uint8Array(n), layer: new Uint16Array(n),
    line: new Uint32Array(n), tStart: new Float64Array(n), duration: new Float32Array(n), arc: new Uint8Array(n),
  }
}

describe('MOVE_TYPES', () => {
  it('has the fixed code order used by MoveTable.type', () => {
    expect(MOVE_TYPES).toEqual(['extrude', 'travel', 'pick', 'place', 'tamp', 'prinjection', 'wipe', 'z_hop'])
  })
})

describe('getMove', () => {
  it('builds a view object from row i', () => {
    const t = table(2)
    t.x0[1] = 1; t.y0[1] = 2; t.z0[1] = 0.2
    t.x1[1] = 4; t.y1[1] = 6; t.z1[1] = 0.2
    t.e[1] = 0.5; t.f[1] = 1800
    t.type[1] = MOVE_TYPES.indexOf('tamp'); t.segment[1] = 2; t.layer[1] = 11
    t.line[1] = 1234; t.tStart[1] = 12.5; t.duration[1] = 0.25; t.arc[1] = 1

    expect(getMove(t, 1)).toEqual({
      index: 1, segment: 2, layer: 11, type: 'tamp',
      from: { x: 1, y: 2, z: expect.closeTo(0.2, 9) }, to: { x: 4, y: 6, z: expect.closeTo(0.2, 9) },
      e: 0.5, feedrate: 1800, line: 1234, tStart: 12.5, duration: 0.25, arc: true,
    })
    expect(getMove(t, 0).type).toBe('extrude')
    expect(getMove(t, 0).arc).toBe(false)
  })

  it('maps every type code to its MOVE_TYPES entry', () => {
    const t = table(MOVE_TYPES.length)
    MOVE_TYPES.forEach((_, k) => { t.type[k] = k })
    expect(MOVE_TYPES.map((_, k) => getMove(t, k).type)).toEqual([...MOVE_TYPES])
  })

  it('throws on out-of-range index or unknown type code', () => {
    const t = table(1)
    expect(() => getMove(t, 1)).toThrow(RangeError)
    expect(() => getMove(t, -1)).toThrow(RangeError)
    t.type[0] = 99
    expect(() => getMove(t, 0)).toThrow(RangeError)
  })
})
