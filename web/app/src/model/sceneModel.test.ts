import { describe, expect, it } from 'vitest'
import fixtureSpec from '../../../fixtures/demo-v1/spec.json'
import { buildSceneModel, type SceneItem, type SceneItemKind } from './sceneModel'
import type { Spec, TracePart } from './spec'

const spec = fixtureSpec as unknown as Spec
const offsets = { tray: [0.5, 1.0] as [number, number], model: [0.5, 23.615634] as [number, number] }

function count(items: SceneItem[], kind: SceneItemKind): number {
  return items.filter((i) => i.kind === kind).length
}

function delta(items: SceneItem[], kind: SceneItemKind, design: SceneItem[]): [number, number][] {
  const bed = items.filter((i) => i.kind === kind)
  const des = design.filter((i) => i.kind === kind)
  return bed.map((b, n) => {
    const d = des[n]
    if ('translation' in b && 'translation' in d) return [b.translation[0] - d.translation[0], b.translation[1] - d.translation[1]]
    if ('pos' in b && 'pos' in d) return [b.pos.x - d.pos.x, b.pos.y - d.pos.y]
    if ('center' in b && 'center' in d) return [b.center.x - d.center.x, b.center.y - d.center.y]
    throw new Error(`no position on ${kind}`)
  })
}

describe('buildSceneModel on the demo-v1 Fixture', () => {
  it('has one item per Spec element', () => {
    const items = buildSceneModel(spec, offsets, 'bed')
    expect(count(items, 'housing')).toBe(1)
    expect(count(items, 'tray')).toBe(1)
    expect(count(items, 'partMesh')).toBe(1)
    expect(count(items, 'trace')).toBe(2)
    expect(count(items, 'tamp')).toBe(4)
    expect(count(items, 'prinjection')).toBe(2)
    expect(count(items, 'pick')).toBe(3)
    expect(items).toHaveLength(14)
    const housing = items.find((i) => i.kind === 'housing')
    const mesh = items.find((i) => i.kind === 'partMesh')
    expect(housing && 'file' in housing && housing.file).toBe('housing.3mf')
    expect(mesh && 'file' in mesh && mesh.file).toBe('part-2.stl')
    expect(mesh?.partIndex).toBe(2)
    const tamps = items.filter((i) => i.kind === 'tamp')
    expect(tamps.map((t) => t.kind === 'tamp' && t.tampType)).toEqual([0, 3, 0, 3])
  })

  it('applies the tray offset to tray and picks, the model offset to the rest', () => {
    const bed = buildSceneModel(spec, offsets, 'bed')
    const design = buildSceneModel(spec, offsets, 'design')
    const close = (got: [number, number][], want: [number, number]) => {
      expect(got.length).toBeGreaterThan(0)
      for (const [x, y] of got) {
        expect(x).toBeCloseTo(want[0], 9)
        expect(y).toBeCloseTo(want[1], 9)
      }
    }
    close(delta(bed, 'tray', design), offsets.tray)
    close(delta(bed, 'pick', design), offsets.tray)
    for (const kind of ['housing', 'partMesh', 'trace', 'tamp', 'prinjection'] as const) close(delta(bed, kind, design), offsets.model)
    const tray = bed.find((i) => i.kind === 'tray')
    expect(tray && 'translation' in tray && tray.translation).toEqual([0.5, 1.0, 0])
  })

  it('design space has zero translations and Spec positions', () => {
    const items = buildSceneModel(spec, offsets, 'design')
    for (const i of items) if ('translation' in i) expect(i.translation).toEqual([0, 0, 0])
    const pick = items.find((i) => i.kind === 'pick')
    expect(pick && 'pos' in pick && pick.pos).toEqual(spec.parts[0].pick)
    const hole = items.find((i) => i.kind === 'prinjection')
    const pcb = spec.parts[2]
    expect(pcb.type).toBe('pcb')
    if (pcb.type === 'pcb' && hole && 'pos' in hole) expect(hole.pos).toEqual({ x: pcb.prinjection![0].x, y: pcb.prinjection![0].y, z: pcb.prinjection![0].z })
  })

  it('builds a vertical trace box along line_from to line_to with its top at line Z', () => {
    const t = spec.parts[0] as TracePart
    const item = buildSceneModel(spec, offsets, 'design').find((i) => i.kind === 'trace' && i.partIndex === 0)
    if (!item || item.kind !== 'trace') throw new Error('trace missing')
    expect(Math.abs(item.rotZ)).toBeCloseTo(Math.PI / 2, 12)
    expect(item.length).toBeCloseTo(t.line_to.y - t.line_from.y, 9)
    expect(item.width).toBe(2.8)
    expect(item.height).toBe(0.2)
    expect(item.center.x).toBeCloseTo(t.line_from.x, 12)
    expect(item.center.y).toBeCloseTo((t.line_from.y + t.line_to.y) / 2, 12)
    expect(item.center.z + item.height / 2).toBeCloseTo(t.line_from.z, 12)
  })

  it('carries partUid when passed', () => {
    const items = buildSceneModel(spec, offsets, 'bed', ['a', 'b', 'c'])
    for (const i of items) {
      if (i.partIndex === undefined) expect(i.partUid).toBeUndefined()
      else expect(i.partUid).toBe(['a', 'b', 'c'][i.partIndex])
    }
  })
})
