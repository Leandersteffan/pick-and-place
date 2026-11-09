import { describe, expect, it } from 'vitest'
import { translateStl } from '../io/meshTransform'
import { readStl, writeBinaryStl } from '../io/stl'
import { layerCount, layersFromZMax } from '../model/layerCount'
import type { Project } from '../model/project'
import type { Spec } from '../model/spec'
import { applyCommand } from './commands'
import { HISTORY_LIMIT, emptyHistory, pushEntry, redo, undo } from './history'

function makeProject(): Project {
  const spec: Spec = {
    version: 1,
    printer: 'U1',
    use_trace_braid: false,
    housing: 'housing.stl',
    tray: 'generated',
    tray_spacing: 3,
    tray_origin: { x: 0, y: 0, z: 0 },
    parts: [
      {
        type: 'trace_cloth', place: { x: 10, y: 10, z: 1 }, pause_layer: 5, length: 20, width: 2.8, height: 0.2,
        horizontal: true, line_from: { x: 0, y: 10, z: 1 }, line_to: { x: 20, y: 10, z: 1 },
        tamps: [{ x: 1.55, y: 10, z: 1, type: 0 }, { x: 18.45, y: 10, z: 1, type: 3 }],
        pick: { x: 50, y: 5, z: 0.4 },
      },
      {
        type: 'pcb', place: { x: 30, y: 30, z: 2 }, pause_layer: 8, size: { x: 4, y: 4, z: 2 },
        bbox_center: { x: 30, y: 30, z: 1 }, bbox_min: { x: 28, y: 28, z: 0 }, tray_offset: 2, mesh: 'part-1.stl',
        prinjection: [{ x: 29, y: 30, z: 2 }],
      },
    ],
  }
  const tri = new Float32Array([28, 28, 0, 32, 28, 0, 30, 32, 2])
  return {
    id: 'p1', name: 'test', spec, partUids: ['a', 'b'],
    files: { 'part-1.stl': writeBinaryStl(tri) },
    gcodeStale: false,
    offsets: { tray: [0, 0], model: [0, 0], source: 'default' },
    contactPoints: [{ x: 29, y: 30, z: 2, origin: 'prinjection' }, { x: 18.45, y: 10, z: 1, origin: 'tamp3' }],
    baseline: { spec, partUids: ['a', 'b'] }, warnings: [], source: 'fixture',
  }
}

describe('translate', () => {
  it('moves every trace position and marks gcode stale and trace geometry dirty', () => {
    const p = makeProject()
    const r = applyCommand(p, { kind: 'translate', partIndex: 0, dx: 2, dy: -1 }, { layerCount: 25 })
    if (!r.ok) throw new Error(r.error)
    const t = r.project.spec.parts[0]
    if (t.type !== 'trace_cloth') throw new Error('type')
    expect(t.place).toEqual({ x: 12, y: 9, z: 1 })
    expect(t.line_from).toEqual({ x: 2, y: 9, z: 1 })
    expect(t.line_to).toEqual({ x: 22, y: 9, z: 1 })
    expect(t.tamps![0].x).toBeCloseTo(3.55, 9)
    expect(t.tamps![1].x).toBeCloseTo(20.45, 9)
    expect(t.tamps!.map((m) => m.y)).toEqual([9, 9])
    expect(t.pick).toEqual({ x: 50, y: 5, z: 0.4 })
    expect(r.project.gcodeStale).toBe(true)
    expect(r.project.traceGeometryDirty).toBe(true)
    expect(p.spec.parts[0].place).toEqual({ x: 10, y: 10, z: 1 })
  })

  it('moves a pcb with its mesh bytes and prinjection contact point, and undo restores everything', () => {
    const p = makeProject()
    const r = applyCommand(p, { kind: 'translate', partIndex: 1, dx: 5, dy: 3 }, { layerCount: 25 })
    if (!r.ok) throw new Error(r.error)
    const c = r.project.spec.parts[1]
    if (c.type !== 'pcb') throw new Error('type')
    expect(c.bbox_center).toEqual({ x: 35, y: 33, z: 1 })
    expect(c.bbox_min).toEqual({ x: 33, y: 31, z: 0 })
    expect(c.prinjection![0]).toEqual({ x: 34, y: 33, z: 2 })
    expect(r.project.contactPoints[0]).toMatchObject({ x: 34, y: 33 })
    expect(r.project.contactPoints[1]).toMatchObject({ x: 18.45, y: 10 })
    expect(Array.from(readStl(r.project.files['part-1.stl']).positions)).toEqual([33, 31, 0, 37, 31, 0, 35, 35, 2])

    const h = pushEntry(emptyHistory(), r.entry)
    const [back, h2] = undo(r.project, h)
    expect(back.spec).toEqual(p.spec)
    expect(back.contactPoints).toEqual(p.contactPoints)
    expect(back.files['part-1.stl']).toBe(p.files['part-1.stl'])
    expect(back.gcodeStale).toBe(false)
    expect(back.traceGeometryDirty).toBe(false)
    const [again] = redo(back, h2)
    expect(again.spec).toEqual(r.project.spec)
    expect(again.files['part-1.stl']).toBe(r.project.files['part-1.stl'])
  })
})

describe('setPauseLayer', () => {
  it('stores an integer in range and rejects others with the allowed range', () => {
    const p = makeProject()
    const ok = applyCommand(p, { kind: 'setPauseLayer', partIndex: 0, value: 12 }, { layerCount: 25 })
    if (!ok.ok) throw new Error(ok.error)
    expect(ok.project.spec.parts[0].pause_layer).toBe(12)
    expect(ok.project.gcodeStale).toBe(true)
    for (const value of [0, 26, 2.5]) {
      const bad = applyCommand(p, { kind: 'setPauseLayer', partIndex: 0, value }, { layerCount: 25 })
      expect(bad).toEqual({ ok: false, error: 'pause_layer must be an integer from 1 to 25' })
    }
  })
})

describe('history and helpers', () => {
  it('caps past at 200 and clears future on push', () => {
    const entry = { label: 'x', patches: [], inverse: [] }
    let h = { past: [], future: [entry] } as ReturnType<typeof emptyHistory>
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = pushEntry(h, entry)
    expect(h.past.length).toBe(HISTORY_LIMIT)
    expect(h.future.length).toBe(0)
  })

  it('layer count prefers Segment 2, else ceil(zMax / 0.2)', () => {
    const seg = { index: 2, layerCount: 25 } as never
    expect(layerCount([seg], 9)).toBe(25)
    expect(layerCount(null, 5)).toBe(25)
    expect(layersFromZMax(5.01)).toBe(26)
    expect(layerCount(null, null)).toBe(0)
  })

  it('translateStl leaves the input bytes untouched', () => {
    const bytes = writeBinaryStl(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    const copy = bytes.slice()
    translateStl(bytes, 1, 1)
    expect(bytes).toEqual(copy)
  })
})
