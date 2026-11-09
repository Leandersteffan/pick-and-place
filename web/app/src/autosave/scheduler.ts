// Debounce with maxWait for autosave (design section 12, Requirement 17.1).
//
// `trigger()` (re)starts a `wait` ms quiet timer. A run also starts once
// `maxWait` ms have passed since the first trigger of a burst, so a steady
// stream of changes still saves at least every `maxWait` ms.
// Pure apart from setTimeout/clearTimeout, so it runs under vi.useFakeTimers.

export interface DebounceScheduler {
  /** Notes a change; schedules a run. */
  trigger(): void
  /** Runs now if a run is pending. */
  flush(): void
  /** Drops a pending run. */
  cancel(): void
  pending(): boolean
}

export function createDebounceScheduler(run: () => void, wait = 1000, maxWait = 2000): DebounceScheduler {
  let waitTimer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (waitTimer !== null) clearTimeout(waitTimer)
    if (maxTimer !== null) clearTimeout(maxTimer)
    waitTimer = null
    maxTimer = null
  }

  const fire = () => {
    clear()
    run()
  }

  return {
    trigger() {
      if (waitTimer !== null) clearTimeout(waitTimer)
      waitTimer = setTimeout(fire, wait)
      if (maxTimer === null) maxTimer = setTimeout(fire, maxWait)
    },
    flush() {
      if (waitTimer !== null || maxTimer !== null) fire()
    },
    cancel: clear,
    pending() {
      return waitTimer !== null || maxTimer !== null
    },
  }
}
