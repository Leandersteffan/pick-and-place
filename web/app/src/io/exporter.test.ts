import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Project } from '../model/project'
import { orderBundleNames } from './bundle'
import { bundleFileName, exportBundle, WEB_APP_VERSION } from './exporter'
import { importBundle, importFiles, importGcode, type ImportResult } from './importer'
import { readManifest } from './manifest'

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

const CREATED = new Date('2026-11-09T18:42:07.123Z')

let fixture: Record<string, Uint8Array> = {}

beforeAll(() => {
  fixture = Object.fromEntries(
    FIXTURE_NAMES.map((name) => [
      name,
      new Uint8Array(readFileSync(new URL(`../../../fixtures/demo-v1/${name}`, import.meta.url))),
    ]),
  )
})

function project(result: ImportResult): Project {
  if (!result.ok) throw new Error(`import failed: ${result.error}`)
  return result.project
}

async function fixtureProject(): Promise<Project> {
  return project(await importFiles({ ...fixture }, 'fixture'))
}

function manifestOf(zip: Uint8Array) {
  const read = readManifest(unzipSync(zip)['manifest.json'])
  if (!read.ok) throw new Error(read.error)
  return read.manifest
}

describe('exportBundle', () => {
  it('round-trips the Fixture: same Spec, same file bytes, no warnings', async () => {
    const before = await fixtureProject()
    const zip = await exportBundle(before, { createdUtc: CREATED })
    const after = project(await importBundle(zip, 'demo-v1.pnp.zip'))

    expect(after.warnings).toEqual([])
    expect(after.spec).toEqual(before.spec)
    expect(Object.keys(after.files).sort()).toEqual(Object.keys(before.files).sort())
    for (const [name, bytes] of Object.entries(before.files)) expect(after.files[name]).toEqual(bytes)
    expect(after.offsets).toEqual({ ...before.offsets, source: 'manifest' })
    expect(after.gcodeStale).toBe(false)
    expect(after.name).toBe('demo-v1')
  }, 30000)

  it('writes the entries in the fixed order and a complete Manifest', async () => {
    const zip = await exportBundle(await fixtureProject(), { createdUtc: CREATED })
    const entries = unzipSync(zip)
    expect(Object.keys(entries)).toEqual([
      'spec.json',
      'housing.3mf',
      'housing.stl',
      'part-2.stl',
      'tray.stl',
      'combined_output.gcode',
      'manifest.json',
    ])
    const spec = new TextDecoder().decode(entries['spec.json'])
    expect(spec).not.toContain('\r')
    expect(spec.startsWith('{\n  "version": 1,\n')).toBe(true)

    const m = manifestOf(zip)
    expect(m.bundle_format).toBe(1)
    expect(m.spec_version).toBe(1)
    expect(m.web_app_version).toBe(WEB_APP_VERSION)
    expect(m.pipeline_version).toBeNull()
    expect(m.created_utc).toBe('2026-11-09T18:42:07Z')
    expect(m.gcode_stale).toBe(false)
    expect(m.offsets).toEqual({ tray: [0.5, 1.0], model: [0.5, 23.615634], source: 'manifest' })
    expect(Object.keys(m.files)).toEqual([...Object.keys(m.files)].sort())
    expect(Object.keys(m.files)).not.toContain('manifest.json')
    expect(m.files['part-2.stl'].bytes).toBe(fixture['part-2.stl'].length)

    const text = new TextDecoder().decode(entries['manifest.json'])
    expect(text).toContain('"bundle_format": 1,')
    expect(text).toContain('"pipeline_version": null,')
    expect(text).toMatch(/"tray": \[\n {6}0\.5,\n {6}1\.0\n {4}\]/)
  }, 30000)

  it('is byte-identical across two exports with the same creation time', async () => {
    const p = await fixtureProject()
    const a = await exportBundle(p, { createdUtc: CREATED })
    const b = await exportBundle(p, { createdUtc: CREATED })
    expect(b).toEqual(a)
  }, 30000)

  it('records gcode_stale true for a stale Project and the Importer keeps it', async () => {
    const p = { ...(await fixtureProject()), gcodeStale: true }
    const zip = await exportBundle(p, { createdUtc: CREATED })
    expect(manifestOf(zip).gcode_stale).toBe(true)
    expect(project(await importBundle(zip)).gcodeStale).toBe(true)
  }, 30000)

  it('exports a gcode-only Project as gcode plus Manifest and reopens it gcode-only', async () => {
    const p = project(importGcode(fixture['combined_output.gcode'], 'U1_output.gcode'))
    const zip = await exportBundle(p, { createdUtc: CREATED })
    expect(Object.keys(unzipSync(zip))).toEqual(['combined_output.gcode', 'manifest.json'])
    const back = project(await importBundle(zip, 'U1_output.pnp.zip'))
    expect(back.gcodeOnly).toBe(true)
    expect(back.warnings).toEqual([])
    expect(back.files['combined_output.gcode']).toEqual(fixture['combined_output.gcode'])
    expect(back.name).toBe('U1_output')
  }, 30000)
})

describe('bundle names', () => {
  it('orders part meshes naturally', () => {
    expect(orderBundleNames(['manifest.json', 'part-10.stl', 'tray.stl', 'part-2.stl', 'spec.json'])).toEqual([
      'spec.json',
      'part-2.stl',
      'part-10.stl',
      'tray.stl',
      'manifest.json',
    ])
  })

  it('sanitizes the Project name', () => {
    expect(bundleFileName('demo-v1')).toBe('demo-v1.pnp.zip')
    expect(bundleFileName('a/b:c*?')).toBe('a_b_c_.pnp.zip')
    expect(bundleFileName('  ')).toBe('project.pnp.zip')
    expect(bundleFileName('x.pnp.zip')).toBe('x.pnp.zip')
  })
})
