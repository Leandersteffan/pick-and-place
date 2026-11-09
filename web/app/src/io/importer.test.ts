import { readFileSync } from 'node:fs'
import { zipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { deriveContactPoints } from '../model/contactPoints'
import type { Project } from '../model/project'
import type { Spec } from '../model/spec'
import { mapFolderFiles, importFolderEntries } from './folder'
import { housingFile, importBundle, importFiles, importGcode, pickGcodeName, type ImportResult } from './importer'

const FIXTURE_NAMES = [
  'manifest.json',
  'spec.json',
  'spec.export.json',
  'README.md',
  'housing.3mf',
  'housing.stl',
  'part-2.stl',
  'tray.stl',
  'combined_output.gcode',
]

let fixture: Record<string, Uint8Array> = {}

beforeAll(() => {
  fixture = Object.fromEntries(
    FIXTURE_NAMES.map((name) => [
      name,
      new Uint8Array(readFileSync(new URL(`../../../fixtures/demo-v1/${name}`, import.meta.url))),
    ]),
  )
})

function copy(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Uint8Array(v)]))
}

function project(result: ImportResult): Project {
  if (!result.ok) throw new Error(`import failed: ${result.error}`)
  return result.project
}

describe('importFiles on the demo-v1 Fixture', () => {
  it('loads a valid spec with no warnings and the Manifest offsets', async () => {
    const p = project(await importFiles(copy(fixture), 'fixture'))
    expect(p.warnings).toEqual([])
    expect(p.spec.parts).toHaveLength(3)
    expect(p.offsets).toEqual({ tray: [0.5, 1.0], model: [0.5, 23.615634], source: 'manifest' })
    expect(p.gcodeStale).toBe(false)
    expect(p.partUids).toHaveLength(3)
    expect(new Set(p.partUids).size).toBe(3)
    expect(p.baseline.partUids).toEqual(p.partUids)
    expect(p.baseline.spec).toEqual(p.spec)
    expect(p.baseline.spec).not.toBe(p.spec)
    expect(p.source).toBe('fixture')
    // Meshes and gcode stay as bytes; spec, manifest and docs are not project files.
    expect(Object.keys(p.files).sort()).toEqual(
      ['combined_output.gcode', 'housing.3mf', 'housing.stl', 'part-2.stl', 'tray.stl'],
    )
    expect(p.files['combined_output.gcode']).toEqual(fixture['combined_output.gcode'])
  }, 20000)

  it('derives the two Fixture contact points', async () => {
    const p = project(await importFiles(copy(fixture), 'fixture'))
    const expected = [
      [8.523757, 14.183616, 2.006187],
      [15.508442, 14.179259, 2.006187],
    ]
    expect(p.contactPoints).toHaveLength(2)
    p.contactPoints.forEach((c, i) => {
      expect(Math.abs(c.x - expected[i][0])).toBeLessThan(1e-5)
      expect(Math.abs(c.y - expected[i][1])).toBeLessThan(1e-5)
      expect(Math.abs(c.z - expected[i][2])).toBeLessThan(1e-5)
      expect(c.origin).toBe('prinjection')
    })
  })

  it('warns about a tampered file and names it', async () => {
    const files = copy(fixture)
    files['tray.stl'][100] ^= 0xff
    const p = project(await importFiles(files, 'bundle'))
    expect(p.warnings).toHaveLength(1)
    expect(p.warnings[0].kind).toBe('hash-mismatch')
    expect(p.warnings[0].file).toBe('tray.stl')
    expect(p.warnings[0].message).toContain('tray.stl')
  })

  it('aborts when spec.json is missing, naming the file', async () => {
    const files = copy(fixture)
    delete files['spec.json']
    const result = await importFiles(files, 'bundle')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('spec.json')
  })

  it('aborts when spec.json is not valid JSON, with the position', async () => {
    const files = copy(fixture)
    files['spec.json'] = new TextEncoder().encode('{\n  "version": 1,\n  oops\n}')
    const result = await importFiles(files, 'bundle')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('spec.json')
      expect(result.error).toMatch(/line 3/)
    }
  })

  it('warns per missing mesh and still loads', async () => {
    const files = copy(fixture)
    delete files['manifest.json']
    delete files['part-2.stl']
    const p = project(await importFiles(files, 'folder'))
    expect(p.warnings).toEqual([
      { kind: 'missing-mesh', file: 'part-2.stl', message: expect.stringContaining('part-2.stl') },
    ])
    expect(p.offsets.source).toBe('gcode')
  })

  it('falls back to the other housing format and says so', async () => {
    const files = copy(fixture)
    delete files['manifest.json']
    delete files['housing.3mf']
    const p = project(await importFiles(files, 'folder'))
    expect(p.warnings).toHaveLength(1)
    expect(p.warnings[0]).toMatchObject({ kind: 'missing-mesh', file: 'housing.3mf' })
    expect(p.warnings[0].message).toContain('housing.stl')
    expect(housingFile(p.spec, p.files)).toBe('housing.stl')
  })

  it('turns schema errors into warnings and keeps the Project', async () => {
    const files = copy(fixture)
    delete files['manifest.json']
    const spec = JSON.parse(new TextDecoder().decode(files['spec.json'])) as Spec & { extra?: number }
    spec.extra = 1
    files['spec.json'] = new TextEncoder().encode(JSON.stringify(spec))
    const p = project(await importFiles(files, 'folder'))
    expect(p.warnings.length).toBeGreaterThan(0)
    expect(p.warnings.every((w) => w.kind === 'schema')).toBe(true)
  })
})

describe('importBundle', () => {
  it('reads a flat .pnp.zip', async () => {
    const files = copy(fixture)
    const zip = zipSync(files)
    const p = project(await importBundle(zip, 'demo.pnp.zip'))
    expect(p.warnings).toEqual([])
    expect(p.name).toBe('demo')
    expect(p.source).toBe('bundle')
  })
})

describe('Rhino_Output_Folder layout', () => {
  function rhinoFolder(): Record<string, Uint8Array> {
    return {
      'output/spec/spec.json': fixture['spec.json'],
      'output/spec/housing.3mf': fixture['housing.3mf'],
      'output/spec/housing.stl': fixture['housing.stl'],
      'output/spec/housing.step': new Uint8Array(4),
      'output/spec/part-2.stl': fixture['part-2.stl'],
      'output/spec/tray.stl': fixture['tray.stl'],
      'output/combined_output.gcode': fixture['combined_output.gcode'],
      'output/setup.gcode': new Uint8Array(3),
      'output/part.gcode': new Uint8Array(3),
      'output/slice_log.txt': new Uint8Array(3),
      'output/housing_orca/plate_1.gcode': new Uint8Array(3),
      'output/housing_orca/tray.stl': new Uint8Array(3),
    }
  }

  it('maps spec/ to flat names and ignores slicer leftovers', () => {
    expect(Object.keys(mapFolderFiles(rhinoFolder())).sort()).toEqual(
      ['combined_output.gcode', 'housing.3mf', 'housing.stl', 'part-2.stl', 'spec.json', 'tray.stl'],
    )
  })

  it('imports the folder without warnings', async () => {
    const p = project(await importFolderEntries(rhinoFolder(), 'output'))
    expect(p.warnings).toEqual([])
    expect(p.source).toBe('folder')
    expect(p.offsets.source).toBe('gcode')
    expect(p.files['tray.stl']).toBe(fixture['tray.stl'])
    expect(p.files['setup.gcode']).toBeUndefined()
  })

  it('names spec.json when the folder has none', async () => {
    const entries = rhinoFolder()
    delete entries['output/spec/spec.json']
    const result = await importFolderEntries(entries, 'output')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('spec.json')
  })
})

describe('deriveContactPoints merging', () => {
  const base = JSON.parse('{"version":1,"parts":[]}') as Spec
  it('merges equal XY within 0.001 mm, keeping the lower Z and tamp overrides', () => {
    const spec = {
      ...base,
      parts: [
        {
          type: 'pcb',
          prinjection: [{ x: 1, y: 2, z: 1.5, overrides: { a: 'p', b: 'p' } }],
        },
        {
          type: 'trace_cloth',
          tamps: [
            { x: 1.0005, y: 2, z: 1.7, type: 3, overrides: { b: 't' } },
            { x: 5, y: 5, z: 1.7, type: 0 },
            { x: 9, y: 9, z: 1.7, type: 3 },
          ],
        },
      ],
    } as unknown as Spec
    expect(deriveContactPoints(spec)).toEqual([
      { x: 1, y: 2, z: 1.5, origin: 'prinjection', overrides: { a: 'p', b: 't' } },
      { x: 9, y: 9, z: 1.7, origin: 'tamp3' },
    ])
  })
})

describe('gcode-only import', () => {
  it('opens a bare gcode file of any name as a gcode-only Project', () => {
    const p = project(importGcode(fixture['combined_output.gcode'], 'U1_output.gcode'))
    expect(p.gcodeOnly).toBe(true)
    expect(p.name).toBe('U1_output')
    expect(p.source).toBe('gcode')
    expect(p.spec.parts).toEqual([])
    expect(p.offsets).toEqual({ tray: [0, 0], model: [0, 0], source: 'default' })
    expect(Object.keys(p.files)).toEqual(['combined_output.gcode'])
    expect(p.warnings).toEqual([])
  })

  it('rejects an empty gcode file', () => {
    expect(importGcode(new Uint8Array(0), 'x.gcode').ok).toBe(false)
  })

  it('a folder with only a gcode opens gcode-only', async () => {
    const p = project(await importFolderEntries({ 'out/print.gcode': fixture['combined_output.gcode'] }, 'out'))
    expect(p.gcodeOnly).toBe(true)
    expect(p.files['combined_output.gcode']).toBe(fixture['combined_output.gcode'])
  })

  it('uses another gcode name when combined_output.gcode is absent', async () => {
    const files = copy(fixture)
    files['U1_output.gcode'] = files['combined_output.gcode']
    delete files['combined_output.gcode']
    delete files['manifest.json']
    expect(pickGcodeName(files)).toBe('U1_output.gcode')
    const p = project(await importFiles(files, 'folder'))
    expect(p.gcodeOnly).toBeUndefined()
    expect(p.files['combined_output.gcode']).toBe(files['U1_output.gcode'])
    expect(p.offsets.source).toBe('gcode')
  })

  it('prefers combined_output.gcode and never picks setup.gcode', () => {
    expect(pickGcodeName({ 'a.gcode': new Uint8Array(1), 'combined_output.gcode': new Uint8Array(1) })).toBe('combined_output.gcode')
    expect(pickGcodeName({ 'setup.gcode': new Uint8Array(1) })).toBeNull()
  })
})
