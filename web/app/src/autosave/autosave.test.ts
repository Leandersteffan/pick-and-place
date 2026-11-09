import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../model/project'
import { createProjectStore } from '../store/projectStore'
import {
  QUOTA_MESSAGE,
  formatSavedAt,
  indexedDbBackend,
  startAutosave,
  type AutosaveBackend,
  type AutosaveRecord,
  type RestoreOffer,
} from './autosave'
import { createDebounceScheduler } from './scheduler'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createDebounceScheduler', () => {
  it('runs once, 1000 ms after the last trigger of a short burst', () => {
    const run = vi.fn()
    const s = createDebounceScheduler(run, 1000, 2000)
    s.trigger()
    vi.advanceTimersByTime(500)
    s.trigger()
    vi.advanceTimersByTime(999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(s.pending()).toBe(false)
  })

  it('runs at maxWait 2000 ms under a steady stream of triggers', () => {
    const run = vi.fn()
    const s = createDebounceScheduler(run, 1000, 2000)
    for (let t = 0; t < 1999; t += 400) {
      s.trigger()
      vi.advanceTimersByTime(400)
    }
    // triggers at 0, 400, ..., 1600; time is now 2000
    expect(run).toHaveBeenCalledTimes(1)
    // a fresh burst starts its own maxWait window
    s.trigger()
    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('never lets a change wait more than 2000 ms', () => {
    const run = vi.fn()
    const s = createDebounceScheduler(run, 1000, 2000)
    const runs: number[] = []
    run.mockImplementation(() => runs.push(Date.now()))
    const start = Date.now()
    const changes: number[] = []
    for (let i = 0; i < 40; i++) {
      changes.push(Date.now())
      s.trigger()
      vi.advanceTimersByTime(((i * 37) % 900) + 50)
    }
    vi.advanceTimersByTime(3000)
    for (const c of changes) {
      const next = runs.find((r) => r >= c)
      expect(next).toBeDefined()
      expect(next! - c).toBeLessThanOrEqual(2000)
    }
    expect(runs[0] - start).toBeLessThanOrEqual(2000)
  })

  it('flush runs a pending call now; cancel drops it', () => {
    const run = vi.fn()
    const s = createDebounceScheduler(run, 1000, 2000)
    s.flush()
    expect(run).not.toHaveBeenCalled()
    s.trigger()
    s.flush()
    expect(run).toHaveBeenCalledTimes(1)
    s.trigger()
    s.cancel()
    vi.advanceTimersByTime(5000)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

function project(id: string, name = `P ${id}`): Project {
  return {
    id,
    name,
    spec: { version: 1, parts: [] } as unknown as Project['spec'],
    partUids: [],
    files: { 'housing.stl': new Uint8Array([1, 2, 3]) },
    gcodeStale: false,
    offsets: { tray: [0, 0], model: [0, 0], source: 'default' },
    contactPoints: [],
    baseline: { spec: { version: 1, parts: [] } as unknown as Project['spec'], partUids: [] },
    warnings: [],
    source: 'fixture',
    gcodeOnly: true, // skips schema validation in setProject
  }
}

function memoryBackend(initial: AutosaveRecord | null = null) {
  let value = initial
  let active = 0
  let maxActive = 0
  const writes: AutosaveRecord[] = []
  let failWith: unknown = null
  const backend: AutosaveBackend = {
    async read() {
      return value
    },
    async write(record) {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 300)) // a slow write
      active--
      if (failWith) throw failWith
      writes.push(record)
      value = record
    },
    async clear() {
      value = null
    },
  }
  return {
    backend,
    writes,
    get value() {
      return value
    },
    get maxActive() {
      return maxActive
    },
    fail(err: unknown) {
      failWith = err
    },
  }
}

describe('startAutosave', () => {
  it('saves the latest Project, never two writes at once', async () => {
    const store = createProjectStore()
    const mem = memoryBackend()
    const auto = startAutosave(store, { backend: mem.backend })
    await auto.ready
    for (let i = 0; i < 12; i++) {
      store.getState().setProject(project(String(i)))
      await vi.advanceTimersByTimeAsync(450)
    }
    await vi.advanceTimersByTimeAsync(3000)
    await auto.idle()
    expect(mem.maxActive).toBe(1)
    expect(mem.writes.length).toBeGreaterThan(1)
    expect(mem.value?.project.id).toBe('11')
    expect(mem.value?.format).toBe(1)
    expect(mem.value?.project.files['housing.stl']).toEqual(new Uint8Array([1, 2, 3]))
    auto.stop()
  })

  it('offers a saved Project at startup; restore loads it without saving again', async () => {
    const store = createProjectStore()
    const saved: AutosaveRecord = { format: 1, savedAt: '2026-11-09T08:05:00.000Z', project: project('a', 'Lamp') }
    const mem = memoryBackend(saved)
    const offers: (RestoreOffer | null)[] = []
    const auto = startAutosave(store, { backend: mem.backend, onOffer: (o) => offers.push(o) })
    await auto.ready
    expect(offers).toEqual([{ name: 'Lamp', savedAt: saved.savedAt }])
    expect(await auto.restore()).toBe(true)
    expect(store.getState().project?.id).toBe('a')
    expect(store.getState().project?.source).toBe('autosave')
    expect(offers.at(-1)).toBeNull()
    await vi.advanceTimersByTimeAsync(5000)
    await auto.idle()
    expect(mem.writes).toHaveLength(0)
    // a later edit is saved
    store.getState().setProject({ ...store.getState().project!, name: 'Lamp 2' })
    await vi.advanceTimersByTimeAsync(2000)
    await auto.idle()
    expect(mem.value?.project.name).toBe('Lamp 2')
    auto.stop()
  })

  it('discard deletes the saved Project; no offer when a Project is loaded', async () => {
    const saved: AutosaveRecord = { format: 1, savedAt: '2026-11-09T08:05:00.000Z', project: project('a') }
    const mem = memoryBackend(saved)
    const offers: (RestoreOffer | null)[] = []
    const store = createProjectStore()
    const auto = startAutosave(store, { backend: mem.backend, onOffer: (o) => offers.push(o) })
    await auto.discard()
    expect(mem.value).toBeNull()
    expect(offers.at(-1)).toBeNull()
    expect(await auto.restore()).toBe(false)
    auto.stop()

    const loaded = createProjectStore()
    loaded.getState().setProject(project('b'))
    const offers2: (RestoreOffer | null)[] = []
    const auto2 = startAutosave(loaded, { backend: memoryBackend(saved).backend, onOffer: (o) => offers2.push(o) })
    await auto2.ready
    expect(offers2).toHaveLength(0)
    auto2.stop()
  })

  it('a full storage gives the quota warning and keeps working', async () => {
    const store = createProjectStore()
    const mem = memoryBackend()
    mem.fail(Object.assign(new Error('full'), { name: 'QuotaExceededError' }))
    const warnings: string[] = []
    const auto = startAutosave(store, { backend: mem.backend, onWarning: (m) => warnings.push(m) })
    store.getState().setProject(project('q'))
    await vi.advanceTimersByTimeAsync(2000)
    await auto.idle()
    expect(warnings).toEqual([QUOTA_MESSAGE])
    expect(store.getState().project?.id).toBe('q')
    auto.stop()
  })

  it('does nothing without IndexedDB', async () => {
    expect(indexedDbBackend()).toBeNull()
    const store = createProjectStore()
    const auto = startAutosave(store)
    await auto.ready
    expect(await auto.restore()).toBe(false)
    auto.stop()
  })

  it('formats savedAt as hh:mm', () => {
    const d = new Date(2026, 10, 9, 7, 4)
    expect(formatSavedAt(d.toISOString())).toBe('07:04')
    expect(formatSavedAt('nonsense')).toBe('nonsense')
  })
})
