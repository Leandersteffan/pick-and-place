// Autosave (design section 12, Requirements 17.1 and 17.2).
//
// - IndexedDB database `pnp-web`, store `autosave`, key `latest`.
//   Value: { format: 1, savedAt: ISO, project }. Structured clone keeps the
//   Uint8Array files as they are. Undo history is not saved.
// - Every new Project in the store schedules a save, debounced 1000 ms with
//   maxWait 2000 ms. Writes are serialised: at most one runs and at most one
//   waits, and the waiting one takes the newest Project when it starts.
// - At startup a saved Project is offered for restore when nothing is loaded.
// - A full browser storage gives a warning; the app keeps working.
// - Without IndexedDB (Node, some private modes) autosave does nothing.
import type { Project } from '../model/project'
import type { ProjectStore } from '../store/projectStore'
import { createDebounceScheduler } from './scheduler'

export const DB_NAME = 'pnp-web'
export const STORE_NAME = 'autosave'
export const KEY = 'latest'
export const SAVE_WAIT_MS = 1000
export const SAVE_MAX_WAIT_MS = 2000
export const QUOTA_MESSAGE = 'Autosave failed: browser storage full'

export interface AutosaveRecord {
  format: 1
  savedAt: string
  project: Project
}

/** Where records go. The IndexedDB one is the default; tests pass a Map. */
export interface AutosaveBackend {
  read(): Promise<AutosaveRecord | null>
  write(record: AutosaveRecord): Promise<void>
  clear(): Promise<void>
}

export interface RestoreOffer {
  name: string
  savedAt: string
}

// ---------- IndexedDB, with a tiny promise wrapper ----------

function requestPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  const req = factory.open(DB_NAME, 1)
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME)
  }
  return requestPromise(req)
}

/** Runs one request in its own transaction and waits for the commit. */
async function inStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const tx = db.transaction(STORE_NAME, mode)
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
  const result = await requestPromise(fn(tx.objectStore(STORE_NAME)))
  await done
  return result
}

/** The IndexedDB backend, or null where IndexedDB is unavailable. */
export function indexedDbBackend(): AutosaveBackend | null {
  let factory: IDBFactory | undefined
  try {
    factory = typeof indexedDB === 'undefined' ? undefined : indexedDB
  } catch {
    factory = undefined // some browsers throw on access in private mode
  }
  if (!factory) return null
  const f = factory
  let db: Promise<IDBDatabase> | null = null
  const getDb = () => {
    if (!db) {
      db = openDb(f)
      db.catch(() => {
        db = null // retry on the next call
      })
    }
    return db
  }
  return {
    async read() {
      const value = await inStore(await getDb(), 'readonly', (s) => s.get(KEY))
      const rec = value as AutosaveRecord | undefined
      return rec && rec.format === 1 && rec.project ? rec : null
    },
    async write(record) {
      await inStore(await getDb(), 'readwrite', (s) => s.put(record, KEY))
    },
    async clear() {
      await inStore(await getDb(), 'readwrite', (s) => s.delete(KEY))
    },
  }
}

export function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

/** "hh:mm" in local time, or the raw string if it is not a date. */
export function formatSavedAt(savedAt: string): string {
  const d = new Date(savedAt)
  if (Number.isNaN(d.getTime())) return savedAt
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------- Wiring to the project store ----------

export interface AutosaveOptions {
  /** Defaults to IndexedDB; null disables autosave. */
  backend?: AutosaveBackend | null
  /** Shows or hides the restore banner. */
  onOffer?: (offer: RestoreOffer | null) => void
  /** Shows a warning, e.g. on a full storage. */
  onWarning?: (message: string) => void
  now?: () => Date
  wait?: number
  maxWait?: number
}

export interface AutosaveHandle {
  /** Resolves once the startup read is done (and the offer is shown, if any). */
  ready: Promise<void>
  /** Loads the saved Project into the store; false if none. */
  restore(): Promise<boolean>
  /** Deletes the saved Project and hides the offer. */
  discard(): Promise<void>
  /** Starts a pending save now. */
  flush(): void
  /** Resolves when no write is running or waiting. */
  idle(): Promise<void>
  stop(): void
}

export function startAutosave(store: ProjectStore, options: AutosaveOptions = {}): AutosaveHandle {
  const backend = options.backend === undefined ? indexedDbBackend() : options.backend
  const onOffer = options.onOffer ?? (() => {})
  const onWarning = options.onWarning ?? (() => {})
  const now = options.now ?? (() => new Date())

  if (!backend) {
    return {
      ready: Promise.resolve(),
      restore: async () => false,
      discard: async () => {},
      flush() {},
      idle: async () => {},
      stop() {},
    }
  }

  let offered: AutosaveRecord | null = null
  /** The Project last read from or written to storage; no need to save it again. */
  let stored: Project | null = null
  let chain: Promise<void> = Promise.resolve()
  let queued = false
  let stopped = false

  const hideOffer = () => {
    if (offered) {
      offered = null
      onOffer(null)
    }
  }

  const enqueueWrite = () => {
    if (queued || stopped) return
    queued = true
    chain = chain.then(async () => {
      queued = false
      const project = store.getState().project
      if (!project || project === stored) return
      try {
        await backend.write({ format: 1, savedAt: now().toISOString(), project })
        stored = project
      } catch (err) {
        onWarning(isQuotaError(err) ? QUOTA_MESSAGE : `Autosave failed: ${(err as Error)?.message ?? String(err)}`)
      }
    })
  }

  const scheduler = createDebounceScheduler(enqueueWrite, options.wait ?? SAVE_WAIT_MS, options.maxWait ?? SAVE_MAX_WAIT_MS)

  const unsubscribe = store.subscribe((state, prev) => {
    if (state.project === prev.project || !state.project) return
    // Something else was loaded; the old save is about to be replaced.
    hideOffer()
    if (state.project === stored) return
    scheduler.trigger()
  })

  const ready = (async () => {
    let rec: AutosaveRecord | null = null
    try {
      rec = await backend.read()
    } catch {
      rec = null
    }
    if (rec && !stopped && !store.getState().project) {
      offered = rec
      onOffer({ name: rec.project.name, savedAt: rec.savedAt })
    }
  })()

  const onHide = () => {
    if (document.visibilityState === 'hidden') scheduler.flush()
  }
  const hasDocument = typeof document !== 'undefined'
  if (hasDocument) document.addEventListener('visibilitychange', onHide)

  return {
    ready,
    async restore() {
      await ready
      const rec = offered
      if (!rec) return false
      const project: Project = { ...rec.project, source: 'autosave' }
      // Same content as storage: setting it must not schedule a save.
      stored = project
      hideOffer()
      store.getState().setProject(project)
      return true
    },
    async discard() {
      await ready
      hideOffer()
      try {
        await backend.clear()
      } catch {
        // nothing saved is lost by a failed delete
      }
    },
    flush() {
      scheduler.flush()
    },
    async idle() {
      let current: Promise<void>
      do {
        current = chain
        await current
      } while (current !== chain)
    },
    stop() {
      stopped = true
      scheduler.cancel()
      unsubscribe()
      if (hasDocument) document.removeEventListener('visibilitychange', onHide)
    },
  }
}
