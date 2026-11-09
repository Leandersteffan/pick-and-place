// Temperature and fan step tracks (design section 5, "Tracks"). Pure: no DOM, no three.js.

import type { GcodeEvent, StepTrack } from './types'

/** Builds a StepTrack from entries in Move order. */
export function buildTrack(entries: readonly { moveIndex: number; value: number }[]): StepTrack {
  const moveIndex = new Uint32Array(entries.length)
  const value = new Float32Array(entries.length)
  for (let k = 0; k < entries.length; k++) {
    moveIndex[k] = entries[k].moveIndex
    value[k] = entries[k].value
  }
  return { moveIndex, value }
}

/** `(moveIndex, target)` for every T0 `M104`/`M109` Event, in Event order. */
export function tempTrack(events: readonly GcodeEvent[]): StepTrack {
  const entries: { moveIndex: number; value: number }[] = []
  for (const e of events) {
    if (e.data.kind === 'temperature' && e.data.tool === 0) entries.push({ moveIndex: e.moveIndex, value: e.data.target })
  }
  return buildTrack(entries)
}

/** `(moveIndex, value 0..1)` for every part-fan `M106`/`M107` Event, in Event order. */
export function fanTrack(events: readonly GcodeEvent[]): StepTrack {
  const entries: { moveIndex: number; value: number }[] = []
  for (const e of events) {
    if (e.data.kind === 'fan') entries.push({ moveIndex: e.moveIndex, value: e.data.value })
  }
  return buildTrack(entries)
}

/**
 * Step value at Move `i`: the value of the last entry with `moveIndex <= i` (the last one
 * wins when several share a Move index). Before the first entry, or on an empty track,
 * returns `before`, which defaults to NaN ("not set yet"). Pass 0 for the design's
 * "default is 0" reading.
 */
export function valueAt(track: StepTrack, i: number, before = NaN): number {
  const idx = track.moveIndex
  // Upper bound: first k with idx[k] > i.
  let lo = 0, hi = idx.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (idx[mid] <= i) lo = mid + 1
    else hi = mid
  }
  return lo === 0 ? before : track.value[lo - 1]
}
