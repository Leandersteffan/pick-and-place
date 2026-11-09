import { describe, expect, it } from 'vitest'
import fixtureSpec from '../../../fixtures/demo-v1/spec.json'
import { buildSceneModel } from '../model/sceneModel'
import type { Spec } from '../model/spec'
import { uiStore } from '../store/uiStore'
import {
  allVisible,
  BED_REACH,
  bedBox,
  fitCamera,
  sceneBounds,
  formatOffset,
  isSelected,
  selectionDetails,
  selectionOf,
  spaceLabel,
  VISIBILITY_KINDS,
} from './sceneHelpers'

const spec = fixtureSpec as unknown as Spec
const offsets = { tray: [0.5, 1.0] as [number, number], model: [0.5, 23.615634] as [number, number] }
const files: Record<string, Uint8Array> = { 'housing.3mf': new Uint8Array(1234), 'part-2.stl': new Uint8Array(84) }

describe('space label', () => {
  it('formats offsets with 1 to 3 decimals and a sign', () => {
    expect(formatOffset(0.5)).toBe('+0.5')
    expect(formatOffset(1)).toBe('+1.0')
    expect(formatOffset(23.615634)).toBe('+23.616')
    expect(formatOffset(-2.25)).toBe('-2.25')
    expect(formatOffset(-0.0001)).toBe('+0.0')
  })

  it('names the space, the offsets and their source', () => {
    expect(spaceLabel('bed', { ...offsets, source: 'manifest' })).toBe(
      'Bed_Space (tray +0.5, +1.0 / model +0.5, +23.616) · source: manifest',
    )
    expect(spaceLabel('design', { ...offsets, source: 'manifest' })).toBe('Design_Space')
    expect(spaceLabel('bed', null)).toBe('Bed_Space')
  })
})

describe('visibility', () => {
  it('allVisible turns on exactly the toggled kinds', () => {
    const v = allVisible()
    expect(Object.keys(v).sort()).toEqual(VISIBILITY_KINDS.map((k) => k.kind).sort())
    expect(Object.values(v).every(Boolean)).toBe(true)
  })

  it('has a toggle for every scene kind, all on by default', () => {
    const items = buildSceneModel(spec, offsets, 'bed')
    const kinds = new Set(VISIBILITY_KINDS.map((v) => v.kind))
    for (const item of items) expect(kinds.has(item.kind)).toBe(true)
    expect(Object.values(uiStore.getState().visibility).every(Boolean)).toBe(true)
    uiStore.getState().setVisible('tamp', false)
    expect(uiStore.getState().visibility.tamp).toBe(false)
    expect(uiStore.getState().visibility.trace).toBe(true)
    uiStore.getState().setVisible('tamp', true)
  })
})

describe('selection', () => {
  const items = buildSceneModel(spec, offsets, 'bed')

  it('selects exactly the clicked item', () => {
    for (const item of items) {
      const sel = selectionOf(item)
      expect(items.filter((other) => isSelected(other, sel))).toEqual([item])
    }
  })

  it('looks up the part and the sub-item in the Spec', () => {
    const tamp = items.find((i) => i.kind === 'tamp')
    if (tamp?.kind !== 'tamp') throw new Error('fixture has tamps')
    const d = selectionDetails(spec, files, selectionOf(tamp))
    expect(d?.part).toBe(spec.parts[tamp.partIndex])
    expect(d?.sub?.label).toBe(`tamps[${tamp.tampIndex}]`)
    expect(d?.sub?.value).toBe(spec.parts[tamp.partIndex].tamps?.[tamp.tampIndex])

    const hole = selectionDetails(spec, files, { kind: 'prinjection', partIndex: 2, holeIndex: 1 })
    expect(hole?.title).toContain('prinjection 1')
    expect(hole?.sub?.label).toBe('prinjection[1]')

    const mesh = selectionDetails(spec, files, { kind: 'partMesh', partIndex: 2 })
    expect(mesh?.part).toBe(spec.parts[2])
    expect(mesh?.file).toEqual({ name: 'part-2.stl', bytes: 84 })

    const pick = selectionDetails(spec, files, { kind: 'pick', partIndex: 0 })
    expect(pick?.sub).toEqual({ label: 'pick', value: spec.parts[0].pick })
  })

  it('gives file name and bytes for housing and tray', () => {
    expect(selectionDetails(spec, files, { kind: 'housing' })).toEqual({
      title: 'Housing',
      file: { name: 'housing.3mf', bytes: 1234 },
    })
    expect(selectionDetails(spec, files, { kind: 'tray' })?.file).toEqual({ name: 'tray.stl', bytes: null })
  })

  it('returns null for a selection the Spec does not have', () => {
    expect(selectionDetails(spec, files, { kind: 'trace', partIndex: 99 })).toBeNull()
    expect(selectionDetails(spec, files, { kind: 'trace', partIndex: 2 })).toBeNull()
    expect(selectionDetails(spec, files, { kind: 'tamp', partIndex: 0, tampIndex: 99 })).toBeNull()
  })
})

describe('scene bounds and camera fit', () => {
  it('returns null without items and the bed reach as fallback box', () => {
    expect(sceneBounds([], () => null)).toBeNull()
    expect(bedBox()).toEqual({
      min: { x: BED_REACH.x0, y: BED_REACH.y0, z: 0 },
      max: { x: BED_REACH.x1, y: BED_REACH.y1, z: 0 },
    })
  })

  it('adds the mesh translation and skips missing meshes', () => {
    const box = sceneBounds(
      [
        { kind: 'housing', file: 'housing.3mf', translation: [10, 20, 0] },
        { kind: 'tray', file: 'tray.stl', translation: [0, 0, 0] },
      ],
      (item) => (item.kind === 'housing' ? [0, 0, 5, 6, 0, 3] : null),
    )
    expect(box).toEqual({ min: { x: 10, y: 20, z: 0 }, max: { x: 15, y: 26, z: 3 } })
  })

  it('uses the rotated footprint of a trace box', () => {
    const box = sceneBounds(
      [{ kind: 'trace', partIndex: 0, center: { x: 0, y: 0, z: 1 }, length: 10, width: 2, height: 0.4, rotZ: Math.PI / 2 }],
      () => null,
    )
    expect(box?.min.x).toBeCloseTo(-1)
    expect(box?.max.x).toBeCloseTo(1)
    expect(box?.min.y).toBeCloseTo(-5)
    expect(box?.max.y).toBeCloseTo(5)
    expect(box?.min.z).toBeCloseTo(0.8)
    expect(box?.max.z).toBeCloseTo(1.2)
  })

  it('contains every marker and trace of the Fixture scene', () => {
    const items = buildSceneModel(spec, offsets, 'bed')
    const box = sceneBounds(items, () => null)
    if (!box) throw new Error('fixture has items')
    for (const item of items) {
      const p = item.kind === 'trace' ? item.center : 'pos' in item ? item.pos : null
      if (!p) continue
      expect(p.x).toBeGreaterThanOrEqual(box.min.x)
      expect(p.x).toBeLessThanOrEqual(box.max.x)
      expect(p.y).toBeGreaterThanOrEqual(box.min.y)
      expect(p.y).toBeLessThanOrEqual(box.max.y)
    }
  })

  it('targets the box centre and backs off until the bounding sphere fits', () => {
    const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 40, y: 30, z: 0 } }
    const fit = fitCamera(box, 45)
    expect(fit.target).toEqual([20, 15, 0])
    const d = Math.hypot(fit.position[0] - 20, fit.position[1] - 15, fit.position[2])
    const radius = 25
    expect(radius / d).toBeLessThan(Math.sin((22.5 * Math.PI) / 180))
    expect(fit.position[1]).toBeLessThan(15)
    expect(fit.position[2]).toBeGreaterThan(0)
    expect(fit.near).toBeGreaterThan(0)
    expect(fit.far).toBeGreaterThan(d)
  })
})
