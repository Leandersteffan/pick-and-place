// Add and delete trace (Requirements 12.5 to 12.9, 13.3).
import { describe, expect, it } from 'vitest'
import fixtureSpec from '../../../fixtures/demo-v1/spec.json'
import { sliceOptions } from '../backend/regenerate'
import type { Project } from '../model/project'
import type { Spec, TracePart } from '../model/spec'
import { validateSpec } from '../schema/validate'
import { AXIS_ERROR, PORT_ERROR, applyCommand, roundHalfEven, type Command } from './commands'
import { redo, undo } from './history'

const ctx = { layerCount: 30, portAvailable: true }

function makeProject(): Project {
  const spec = JSON.parse(JSON.stringify(fixtureSpec)) as Spec
  return {
    id: 'p', name: 'p', spec, partUids: ['a', 'b', 'c'], files: {}, gcodeStale: false,
    offsets: { tray: [0, 0], model: [0, 0], source: 'default' }, contactPoints: [],
    baseline: { spec, partUids: ['a', 'b', 'c'] }, warnings: [], source: 'fixture',
  }
}

const trace1 = (fixtureSpec as unknown as Spec).parts[0] as TracePart

function addCmd(from: [number, number], to: [number, number], z = trace1.place.z): Command {
  return { kind: 'addTrace', from, to, z, partType: 'trace_cloth' }
}

describe('roundHalfEven', () => {
  it('rounds halves to the even neighbour like C# Math.Round', () => {
    expect([0.5, 1.5, 2.5, 11.03, -0.5].map(roundHalfEven)).toEqual([0, 2, 2, 11, 0])
  })
})

describe('addTrace', () => {
  it("reproduces Fixture trace 1 from its nominal endpoints", () => {
    const [start, end] = [trace1.tamps![1], trace1.tamps![0]]
    const r = applyCommand(makeProject(), addCmd([start.x, start.y], [end.x, end.y]), ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const added = r.project.spec.parts[2] as TracePart
    expect(added.line_from.y).toBeCloseTo(trace1.line_from.y, 9)
    expect(added.line_to.y).toBeCloseTo(trace1.line_to.y, 9)
    expect(added.length).toBeCloseTo(trace1.length, 9)
    expect(added.place.y).toBeCloseTo(trace1.place.y, 9)
    expect(added.pause_layer).toBe(trace1.pause_layer)
    expect(added.horizontal).toBe(false)
    expect([added.width, added.height]).toEqual([2.8, 0.2])
    expect(added.tamps).toEqual([
      { x: start.x, y: start.y, z: trace1.place.z, type: 0 },
      { x: end.x, y: end.y, z: trace1.place.z, type: 0 },
    ])
    // Inserted after the last trace, before the pcb.
    expect(r.project.spec.parts.map((p) => p.type)).toEqual(['trace_cloth', 'trace_cloth', 'trace_cloth', 'pcb'])
    expect(r.project.partUids.slice(0, 2)).toEqual(['a', 'b'])
    expect(r.project.partUids[3]).toBe('c')
    expect(r.project.autoPlace).toEqual([2])
    expect(r.project.gcodeStale).toBe(true)
    expect(r.project.traceGeometryDirty).toBe(true)
    expect(validateSpec(r.project.spec).valid).toBe(true)
  })

  it('builds a horizontal trace along X', () => {
    const r = applyCommand(makeProject(), addCmd([10, 5], [0, 5], 1.4), ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const t = r.project.spec.parts[2] as TracePart
    expect(t.horizontal).toBe(true)
    expect(t.line_from.x).toBeCloseTo(11.55, 9)
    expect(t.line_to.x).toBeCloseTo(-1.55, 9)
    expect(t.length).toBeCloseTo(13.1, 9)
    expect(t.pause_layer).toBe(8)
  })

  it('rejects diagonal, too short, out-of-range and port-less adds without changing the Project', () => {
    const p = makeProject()
    const cases: [Command, typeof ctx, string | RegExp][] = [
      [addCmd([0, 0], [5, 5]), ctx, AXIS_ERROR],
      [addCmd([0, 0], [0, 0]), ctx, AXIS_ERROR],
      [addCmd([0, 0], [2, 0]), ctx, /at least 2.8/],
      [addCmd([0, 0], [10, 0], 10), ctx, /pause_layer must be an integer from 1 to 30/],
      [addCmd([0, 0], [10, 0]), { layerCount: 30, portAvailable: false }, PORT_ERROR],
    ]
    for (const [cmd, c, err] of cases) {
      const r = applyCommand(p, cmd, c)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(err)
    }
    expect(p.spec.parts).toHaveLength(3)
  })
})

describe('deleteTrace', () => {
  it('removes the trace, its tamps and its uid, and undo/redo restore it', () => {
    const p = makeProject()
    const r = applyCommand(p, { kind: 'deleteTrace', partIndex: 0 }, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.project.spec.parts).toEqual([p.spec.parts[1], p.spec.parts[2]])
    expect(r.project.partUids).toEqual(['b', 'c'])
    expect(r.project.traceGeometryDirty).toBe(true)
    expect(r.project.gcodeStale).toBe(true)
    const history = { past: [r.entry], future: [] }
    const [back, h2] = undo(r.project, history)
    expect(back.spec).toEqual(p.spec)
    expect(back.partUids).toEqual(p.partUids)
    expect(back.gcodeStale).toBe(false)
    const [again] = redo(back, h2)
    expect(again.spec.parts).toHaveLength(2)
  })

  it('refuses a non-trace part', () => {
    const r = applyCommand(makeProject(), { kind: 'deleteTrace', partIndex: 2 }, ctx)
    expect(r.ok).toBe(false)
  })

  it('shifts auto_place indices and drops the deleted one', () => {
    const p = makeProject()
    const a = applyCommand(p, addCmd([0, 0], [10, 0], 1.4), ctx)
    if (!a.ok) throw new Error(a.error)
    const b = applyCommand(a.project, addCmd([0, 0], [0, 10], 1.4), ctx)
    if (!b.ok) throw new Error(b.error)
    expect(b.project.autoPlace).toEqual([2, 3])
    const c = applyCommand(b.project, { kind: 'deleteTrace', partIndex: 2 }, ctx)
    if (!c.ok) throw new Error(c.error)
    expect(c.project.autoPlace).toEqual([2])
    expect((c.project.spec.parts[2] as TracePart).horizontal).toBe(false)
    const d = applyCommand(c.project, { kind: 'deleteTrace', partIndex: 0 }, ctx)
    if (!d.ok) throw new Error(d.error)
    expect(d.project.autoPlace).toEqual([1])
  })
})

describe('sliceOptions', () => {
  it('sends recompute_tamps, contact_points without origin and auto_place', () => {
    const p = makeProject()
    p.traceGeometryDirty = true
    p.autoPlace = [3, 2]
    p.contactPoints = [{ x: 1, y: 2, z: 3, origin: 'prinjection' }, { x: 4, y: 5, z: 6, origin: 'tamp3', overrides: { a: 1 } as never }]
    expect(sliceOptions(p)).toEqual({
      recompute_tamps: true,
      contact_points: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6, overrides: { a: 1 } }],
      auto_place: [2, 3],
    })
  })
})
