import { readFileSync } from 'node:fs'
import { zipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { importFiles } from '../io/importer'
import type { Project } from '../model/project'
import type { Spec } from '../model/spec'
import { createProjectStore, isBundleName } from './projectStore'

const NAMES = ['manifest.json', 'spec.json', 'housing.3mf', 'housing.stl', 'part-2.stl', 'tray.stl', 'combined_output.gcode']
let fixture: Record<string, Uint8Array> = {}

beforeAll(() => {
  fixture = Object.fromEntries(
    NAMES.map((name) => [name, new Uint8Array(readFileSync(new URL(`../../../fixtures/demo-v1/${name}`, import.meta.url)))]),
  )
})

async function fixtureProject(): Promise<Project> {
  const result = await importFiles({ ...fixture }, 'fixture')
  if (!result.ok) throw new Error(result.error)
  return result.project
}

function bytesFile(name: string, bytes: Uint8Array) {
  return { name, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }
}

describe('projectStore', () => {
  it('setProject with the Fixture spec gives a valid verdict', async () => {
    const store = createProjectStore()
    const project = await fixtureProject()
    store.getState().setProject(project)
    const s = store.getState()
    expect(s.project).toBe(project)
    expect(s.validation).toEqual({ valid: true, errors: [] })
  })

  it('setProject with a broken spec keeps the Project and lists errors with pointers', async () => {
    const store = createProjectStore()
    const project = await fixtureProject()
    const spec = structuredClone(project.spec) as Spec & Record<string, unknown>
    ;(spec.parts[0] as unknown as Record<string, unknown>).pause_layer = 'eleven'
    delete (spec as Record<string, unknown>).housing
    const broken = { ...project, spec }
    store.getState().setProject(broken)
    const s = store.getState()
    expect(s.project).toBe(broken)
    expect(s.validation?.valid).toBe(false)
    const pointers = s.validation!.errors.map((e) => e.pointer)
    expect(pointers).toContain('/parts/0/pause_layer')
    expect(pointers).toContain('')
  })

  it('setProject(null) clears the verdict', () => {
    const store = createProjectStore()
    store.getState().setProject(null)
    expect(store.getState().validation).toBeNull()
  })

  it('openBundle loads a zipped Fixture', async () => {
    const store = createProjectStore()
    const zip = zipSync({ ...fixture })
    const ok = await store.getState().openBundle(bytesFile('demo.pnp.zip', zip))
    const s = store.getState()
    expect(ok).toBe(true)
    expect(s.error).toBeNull()
    expect(s.loading).toBeNull()
    expect(s.project?.name).toBe('demo')
    expect(s.validation?.valid).toBe(true)
  })

  it('a failed import sets error and keeps the previous Project', async () => {
    const store = createProjectStore()
    const project = await fixtureProject()
    store.getState().setProject(project)

    const ok = await store.getState().openBundle(bytesFile('junk.pnp.zip', new Uint8Array([1, 2, 3, 4])))
    let s = store.getState()
    expect(ok).toBe(false)
    expect(s.error).toMatch(/junk\.pnp\.zip is not a readable zip file/)
    expect(s.loading).toBeNull()
    expect(s.project).toBe(project)
    expect(s.validation?.valid).toBe(true)

    // A bundle without spec.json is also a failed import.
    const noSpec = { ...fixture }
    delete noSpec['spec.json']
    await store.getState().openBundle(bytesFile('empty.pnp.zip', zipSync(noSpec)))
    s = store.getState()
    expect(s.error).toBe('spec.json is missing from empty.pnp.zip')
    expect(s.project).toBe(project)
  })

  it('only the newest of overlapping imports is applied', async () => {
    const store = createProjectStore()
    const a = await fixtureProject()
    const b = await fixtureProject()
    let release: () => void = () => {}
    const slow = store.getState().runImport('slow', () => new Promise((r) => (release = () => r({ ok: true, project: a }))))
    const fast = store.getState().runImport('fast', async () => ({ ok: true, project: b }))
    expect(await fast).toBe(true)
    release()
    expect(await slow).toBe(false)
    expect(store.getState().project).toBe(b)
  })

  it('recognises bundle names', () => {
    expect(isBundleName('x.pnp.zip')).toBe(true)
    expect(isBundleName('X.ZIP')).toBe(true)
    expect(isBundleName('spec.json')).toBe(false)
  })
})
