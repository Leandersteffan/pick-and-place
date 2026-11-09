import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { importFiles } from '../io/importer'
import type { Project } from '../model/project'
import { healthView, type Health } from './health'
import { applySliceResponse, regenerate, type SliceResponse } from './regenerate'

const NAMES = ['manifest.json', 'spec.json', 'housing.3mf', 'housing.stl', 'part-2.stl', 'tray.stl', 'combined_output.gcode']
let base: Project

beforeAll(async () => {
  const files = Object.fromEntries(
    NAMES.map((n) => [n, new Uint8Array(readFileSync(new URL(`../../../fixtures/demo-v1/${n}`, import.meta.url)))]),
  )
  const r = await importFiles(files, 'fixture')
  if (!r.ok) throw new Error(r.error)
  base = r.project
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('regenerate', () => {
  it('uploads spec, options, housing and meshes and applies the result', async () => {
    let form: FormData | null = null
    let url = ''
    const response: SliceResponse = {
      gcode: ';new gcode\n',
      tray_stl_b64: btoa('tray'),
      spec: base.spec,
      offsets: { tray: [1, 2], model: [3, 4], extra_y: 0, housing_clearance: 0, source: 'backend' },
      pipeline_version: 'abc',
      duration_s: 1.5,
      log_tail: '',
    }
    const fetchImpl = async (input: string, init?: RequestInit) => {
      url = input
      form = init?.body as FormData
      return jsonResponse(200, response)
    }
    const project = { ...base, gcodeStale: true, traceGeometryDirty: true }
    const r = await regenerate(project, { fetchImpl })
    expect(r.ok).toBe(true)
    expect(url).toBe('/api/slice')
    const f = form as unknown as FormData
    expect(JSON.parse(f.get('options') as string)).toEqual({
      recompute_tamps: true,
      contact_points: project.contactPoints.map(({ x, y, z }) => ({ x, y, z })),
      auto_place: [],
    })
    expect((f.get('housing') as File).name).toBe(base.spec.housing)
    expect(f.getAll('meshes').map((m) => (m as File).name)).toEqual(['part-2.stl'])
    expect(JSON.parse(f.get('spec') as string)).toEqual(JSON.parse(JSON.stringify(base.spec)))

    if (!r.ok) return
    const next = applySliceResponse(project, r.response)
    expect(next.gcodeStale).toBe(false)
    expect(next.traceGeometryDirty).toBe(false)
    expect(next.offsets).toEqual({ tray: [1, 2], model: [3, 4], source: 'backend' })
    expect(new TextDecoder().decode(next.files['tray.stl'])).toBe('tray')
    expect(new TextDecoder().decode(next.files['combined_output.gcode'])).toBe(';new gcode\n')
    expect(next.pipelineVersion).toBe('abc')
    expect(next.partUids).toEqual(base.partUids)
    expect(next.baseline.spec).toBe(next.spec)
    expect(next.spec).toEqual(response.spec)
  })

  it('reports 500 stage, message and log tail, and 409 as busy', async () => {
    const r500 = await regenerate(base, {
      fetchImpl: async () => jsonResponse(500, { stage: 'slice', message: 'orca died', log_tail: 'tail' }),
    })
    expect(r500).toEqual({ ok: false, failure: { stage: 'slice', message: 'orca died', logTail: 'tail', status: 500 } })
    const r409 = await regenerate(base, { fetchImpl: async () => jsonResponse(409, { detail: 'busy' }) })
    expect(r409.ok === false && r409.failure.message).toBe('A regenerate is already running')
  })

  it('blocks an invalid Spec before any request', async () => {
    let called = false
    const bad = { ...base, spec: { ...base.spec, version: 2 as unknown as 1 } }
    const r = await regenerate(bad, {
      fetchImpl: async () => {
        called = true
        return jsonResponse(200, {})
      },
    })
    expect(called).toBe(false)
    expect(r.ok === false && r.failure.stage).toBe('validate')
  })

  it('cancels through the AbortSignal', async () => {
    const ctl = new AbortController()
    const fetchImpl = (_: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const pending = regenerate(base, { fetchImpl, signal: ctl.signal })
    ctl.abort()
    const r = await pending
    expect(r.ok === false && r.failure.stage).toBe('cancelled')
  })
})

describe('healthView', () => {
  it('disables Regenerate when offline or when Orca is missing', () => {
    expect(healthView(null).canRegenerate).toBe(false)
    const h: Health = {
      version: '0.1.0',
      python: '3.10.2',
      pipeline_dir: 'x',
      pipeline_version: null,
      orca_path: 'C:/Orca/orca-slicer.exe',
      orca_exists: false,
      orca_candidates: ['C:/a.exe'],
      manifold3d: { ok: false, version: null, error: 'ImportError: no' },
      intersection_port: true,
      busy: false,
    }
    const v = healthView(h)
    expect(v.canRegenerate).toBe(false)
    expect(v.problems.join(' ')).toContain('C:/Orca/orca-slicer.exe')
    expect(v.problems.join(' ')).toContain('C:/a.exe')
    expect(v.problems.join(' ')).toContain('ImportError')
  })
})
