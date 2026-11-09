import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { importFiles } from '../io/importer'
import { meshBounds, readStl } from '../io/stl'
import { parseGcode } from '../gcode/parser'
import {
  deriveOffsetsFromGcode,
  housingClearance,
  offsetSpreadWarning,
  meshBoundsOffsets,
  offsetsFromMeshes,
  sharedBedShift,
  toBed,
  toDesign,
  type Bounds2,
  type OffsetKind,
} from './offsets'
import type { BedOffsets } from './project'
import type { Spec } from './spec'

const FIXTURE = '../../../fixtures/demo-v1/'
const NAMES = ['spec.json', 'housing.3mf', 'housing.stl', 'part-2.stl', 'tray.stl', 'combined_output.gcode']

let fixture: Record<string, Uint8Array> = {}
beforeAll(() => {
  fixture = Object.fromEntries(
    NAMES.map((n) => [n, new Uint8Array(readFileSync(new URL(FIXTURE + n, import.meta.url)))]),
  )
})

// From Scripts/pipeline/geometry.py on the Fixture files (py -3, see task 5.1).
const HOUSING_3MF_BOUNDS: Bounds2 = [3.870019, 7.30703, 22.218784, 21.271576]

function trayBounds(): Bounds2 {
  const b = meshBounds(readStl(fixture['tray.stl']).positions)
  if (!b) throw new Error('empty tray.stl')
  return [b[0], b[1], b[2], b[3]]
}

describe('toBed and toDesign', () => {
  const offsets: BedOffsets = { tray: [0.5, 1.0], model: [-3.25, 23.615634], source: 'manifest' }
  const kinds: OffsetKind[] = ['pick', 'tray', 'model']

  it.each(kinds)('are inverse for %s', (kind) => {
    const p = { x: 12.345, y: -6.789, z: 2.5 }
    const bed = toBed(p, kind, offsets)
    const [dx, dy] = kind === 'model' ? offsets.model : offsets.tray
    expect(bed.x).toBeCloseTo(p.x + dx, 12)
    expect(bed.y).toBeCloseTo(p.y + dy, 12)
    expect(bed.z).toBe(p.z)
    const back = toDesign(bed, kind, offsets)
    expect(back.x).toBeCloseTo(p.x, 12)
    expect(back.y).toBeCloseTo(p.y, 12)
    expect(back.z).toBe(p.z)
  })
})

describe('geometry.py port', () => {
  it('housingClearance is 0 when apart in X or already clear', () => {
    expect(housingClearance([0, 0, 10, 10], [20, 0, 30, 5])).toBe(0)
    expect(housingClearance([0, 0, 10, 10], [5, 25, 15, 30])).toBe(0)
    expect(housingClearance([0, 0, 10, 10], [5, 12, 15, 20])).toBeCloseTo(8, 12)
    expect(housingClearance(null, [5, 12, 15, 20])).toBe(0)
  })

  it('sharedBedShift nudges onto the bed and rejects what does not fit', () => {
    expect(sharedBedShift([[0, 0, 10, 10]])).toEqual([0.5, 1.0])
    expect(sharedBedShift([[100, 100, 110, 110]])).toEqual([0, 0])
    expect(sharedBedShift([[0, 0, 300, 10]])).toBeNull()
  })
})

describe('mesh-bounds offsets on the Fixture', () => {
  it('give tray (0.5, 1.0) and model (0.5, 23.615634)', () => {
    const o = meshBoundsOffsets(trayBounds(), HOUSING_3MF_BOUNDS)
    expect(o).not.toBeNull()
    expect(o!.source).toBe('mesh-bounds')
    expect(Math.abs(o!.tray[0] - 0.5)).toBeLessThan(1e-5)
    expect(Math.abs(o!.tray[1] - 1.0)).toBeLessThan(1e-5)
    expect(Math.abs(o!.model[0] - 0.5)).toBeLessThan(1e-5)
    expect(Math.abs(o!.model[1] - 23.615634)).toBeLessThan(1e-5)
  })

  it('a Prusa printer gives (0, 0) with a warning', () => {
    const r = offsetsFromMeshes('prusa mini', trayBounds(), HOUSING_3MF_BOUNDS)
    expect(r.offsets).toEqual({ tray: [0, 0], model: [0, 0], source: 'default' })
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0].kind).toBe('offsets-default')
  })

  it('a U1 without tray.stl gives (0, 0) with a warning', () => {
    const r = offsetsFromMeshes('snapmaker u1', null, HOUSING_3MF_BOUNDS)
    expect(r.offsets.source).toBe('default')
    expect(r.warnings[0].kind).toBe('offsets-default')
  })

  it('importing the Fixture without manifest.json or gcode uses mesh-bounds', async () => {
    const files = { ...fixture }
    delete files['combined_output.gcode']
    const result = await importFiles(files, 'folder')
    if (!result.ok) throw new Error(result.error)
    const o = result.project.offsets
    expect(o.source).toBe('mesh-bounds')
    expect(Math.abs(o.tray[0] - 0.5)).toBeLessThan(1e-5)
    expect(Math.abs(o.tray[1] - 1.0)).toBeLessThan(1e-5)
    expect(Math.abs(o.model[0] - 0.5)).toBeLessThan(1e-5)
    expect(Math.abs(o.model[1] - 23.615634)).toBeLessThan(1e-5)
    expect(result.project.warnings).toEqual([])
  })

  it('importing a Prusa spec without manifest.json warns and uses (0, 0)', async () => {
    const spec = JSON.parse(new TextDecoder().decode(fixture['spec.json'])) as Record<string, unknown>
    spec.printer = 'prusa mini'
    const files: Record<string, Uint8Array> = { ...fixture, 'spec.json': new TextEncoder().encode(JSON.stringify(spec)) }
    // Without gcode, so the mesh-bounds and default path is the one under test.
    delete files['combined_output.gcode']
    const result = await importFiles(files, 'folder')
    if (!result.ok) throw new Error(result.error)
    expect(result.project.offsets).toEqual({ tray: [0, 0], model: [0, 0], source: 'default' })
    expect(result.project.warnings.some((w) => w.kind === 'offsets-default')).toBe(true)
  })
})

describe('gcode-derived offsets on the Fixture', () => {
  const gcodeText = (): string => new TextDecoder().decode(fixture['combined_output.gcode'])
  const fixtureSpec = (): Spec => JSON.parse(new TextDecoder().decode(fixture['spec.json'])) as Spec

  it('give tray (0.5, 1.0) and model (0.5, 23.615634) with no spread', () => {
    const o = deriveOffsetsFromGcode(fixtureSpec(), parseGcode(gcodeText()))
    expect(o).not.toBeNull()
    expect(o!.source).toBe('gcode')
    expect(Math.abs(o!.tray[0] - 0.5)).toBeLessThan(1e-6)
    expect(Math.abs(o!.tray[1] - 1.0)).toBeLessThan(1e-6)
    expect(Math.abs(o!.model[0] - 0.5)).toBeLessThan(1e-6)
    expect(Math.abs(o!.model[1] - 23.615634)).toBeLessThan(1e-6)
    expect(o!.spreadMm).toBeLessThan(1e-6)
    expect(offsetSpreadWarning(o!)).toBeNull()
  })

  it('importing the Fixture without manifest.json uses the gcode', async () => {
    const result = await importFiles({ ...fixture }, 'folder')
    if (!result.ok) throw new Error(result.error)
    const o = result.project.offsets
    expect(o.source).toBe('gcode')
    expect(Math.abs(o.tray[0] - 0.5)).toBeLessThan(1e-6)
    expect(Math.abs(o.tray[1] - 1.0)).toBeLessThan(1e-6)
    expect(Math.abs(o.model[0] - 0.5)).toBeLessThan(1e-6)
    expect(Math.abs(o.model[1] - 23.615634)).toBeLessThan(1e-6)
    expect(result.project.warnings).toEqual([])
  })

  it('warns offset-spread when one part is placed 0.5 mm off', async () => {
    // PCB #3 place: X12.516004 -> X13.016004.
    const text = gcodeText()
    const shifted = text.replace('G1 X12.516004 Y37.796685', 'G1 X13.016004 Y37.796685')
    expect(shifted).not.toBe(text)
    const o = deriveOffsetsFromGcode(fixtureSpec(), parseGcode(shifted))
    expect(o).not.toBeNull()
    expect(Math.abs(o!.model[0] - 0.5)).toBeLessThan(1e-6)
    expect(Math.abs(o!.spreadMm! - 0.5)).toBeLessThan(1e-5)
    expect(offsetSpreadWarning(o!)?.kind).toBe('offset-spread')

    const files = { ...fixture, 'combined_output.gcode': new TextEncoder().encode(shifted) }
    const result = await importFiles(files, 'folder')
    if (!result.ok) throw new Error(result.error)
    expect(result.project.offsets.source).toBe('gcode')
    expect(result.project.warnings.map((w) => w.kind)).toEqual(['offset-spread'])
  })
})
