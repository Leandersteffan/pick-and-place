import { describe, expect, it } from 'vitest'
import type { Part, Spec } from '../model/spec'
import { diffSpecs, isEmptyDiff, type SpecState } from './diff'

function part(x: number, pause: number, type: Part['type'] = 'trace_cloth'): Part {
  return { type, place: { x, y: 0, z: 0 }, pause_layer: pause } as unknown as Part
}

function state(parts: Part[], uids: string[]): SpecState {
  return { spec: { version: 1, parts } as unknown as Spec, partUids: uids }
}

describe('diffSpecs', () => {
  it('reports no changes for identical specs and ignores moves within 0.001 mm', () => {
    const a = state([part(1, 3), part(2, 4)], ['u1', 'u2'])
    const b = state([part(1.0005, 3), part(2, 4)], ['u1', 'u2'])
    expect(isEmptyDiff(diffSpecs(a, a))).toBe(true)
    expect(isEmptyDiff(diffSpecs(a, b))).toBe(true)
  })

  it('lists added, removed, moved and pause_layer changes matched by partUid', () => {
    const before = state([part(1, 3), part(2, 4), part(5, 1, 'pcb')], ['u1', 'u2', 'u3'])
    // u2 removed, u4 added, u1 moved, u3 pause_layer changed and reordered
    const after = state([part(5, 2, 'pcb'), part(1.5, 3), part(9, 7)], ['u3', 'u1', 'u4'])
    const d = diffSpecs(before, after)
    expect(d.added).toEqual([{ uid: 'u4', index: 2, type: 'trace_cloth', place: { x: 9, y: 0, z: 0 } }])
    expect(d.removed).toEqual([{ uid: 'u2', type: 'trace_cloth', place: { x: 2, y: 0, z: 0 } }])
    expect(d.moved).toEqual([
      { uid: 'u1', index: 1, type: 'trace_cloth', from: { x: 1, y: 0, z: 0 }, to: { x: 1.5, y: 0, z: 0 } },
    ])
    expect(d.pauseLayers).toEqual([{ uid: 'u3', index: 0, type: 'pcb', from: 1, to: 2 }])
  })
})
