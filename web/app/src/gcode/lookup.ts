// Lookups over a parse result (design section 5, "Lookups"). Pure: no DOM, no three.js.
//
// Every lookup accepts either a ParseResult or its MoveTable.

import { ASSEMBLY_MARKER_KINDS } from './markers'
import type { EventKind, GcodeEvent, MoveTable, ParseResult } from './types'

type MovesLike = MoveTable | ParseResult

function tableOf(x: MovesLike): MoveTable {
  return 'moves' in x ? x.moves : x
}

/**
 * Smallest Move index whose source line is at least `line`, or the last index if there is
 * none (-1 on an empty table). Binary search; `moves.line` is non-decreasing.
 */
export function firstMoveAtOrAfterLine(x: MovesLike, line: number): number {
  const m = tableOf(x)
  let lo = 0, hi = m.n
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (m.line[mid] < line) lo = mid + 1
    else hi = mid
  }
  return lo < m.n ? lo : m.n - 1
}

/**
 * The Move being executed at time `t` seconds: the largest index with `tStart <= t`
 * (clamped to [0, n - 1]) and the fraction of its duration done (0..1; 1 for a
 * zero-duration Move that has started). `{ index: -1, frac: 0 }` on an empty table.
 */
export function moveAtTime(x: MovesLike, t: number): { index: number; frac: number } {
  const m = tableOf(x)
  if (m.n === 0) return { index: -1, frac: 0 }
  if (!(t >= m.tStart[0])) return { index: 0, frac: 0 } // also NaN
  let lo = 0, hi = m.n
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (m.tStart[mid] <= t) lo = mid + 1
    else hi = mid
  }
  const index = lo - 1
  const d = m.duration[index]
  const frac = d > 0 ? Math.min(1, Math.max(0, (t - m.tStart[index]) / d)) : 1
  return { index, frac }
}

/** Event kinds that get a Timeline marker: the Assembly_Marker kinds plus `pause` (Requirement 7.1). */
export const TIMELINE_MARKER_KINDS: readonly EventKind[] = [...ASSEMBLY_MARKER_KINDS, 'pause']

const MARKER_SET = new Set<EventKind>(TIMELINE_MARKER_KINDS)

export function isTimelineMarker(e: GcodeEvent): boolean {
  return MARKER_SET.has(e.kind)
}

/** Timeline marker Events, sorted by `moveIndex` then line. */
export function timelineMarkers(events: readonly GcodeEvent[]): GcodeEvent[] {
  return events.filter(isTimelineMarker).sort((a, b) => a.moveIndex - b.moveIndex || a.line - b.line)
}

/** Sorted, deduplicated marker Move indices. */
export function markerIndices(events: readonly GcodeEvent[]): number[] {
  const out: number[] = []
  for (const e of timelineMarkers(events)) if (out[out.length - 1] !== e.moveIndex) out.push(e.moveIndex)
  return out
}

/**
 * Next marker after the playhead: the marker with the smallest `moveIndex` greater than
 * `playhead`, or null at the end.
 *
 * Given Events (any order, non-marker kinds ignored) it returns the Event; when several
 * markers share that Move index, the one with the lowest line. Given sorted marker indices
 * (`markerIndices`) it returns the index.
 */
export function nextMarker(events: readonly GcodeEvent[], playhead: number): GcodeEvent | null
export function nextMarker(markers: readonly number[], playhead: number): number | null
export function nextMarker(list: readonly GcodeEvent[] | readonly number[], playhead: number): GcodeEvent | number | null {
  let best: GcodeEvent | number | null = null
  for (const item of list) {
    if (typeof item === 'number') {
      if (item > playhead && (best === null || item < (best as number))) best = item
    } else if (isTimelineMarker(item) && item.moveIndex > playhead) {
      const b = best as GcodeEvent | null
      if (b === null || item.moveIndex < b.moveIndex || (item.moveIndex === b.moveIndex && item.line < b.line)) best = item
    }
  }
  return best
}

/**
 * Previous marker before the playhead: the marker with the largest `moveIndex` less than
 * `playhead`, or null at the start. Ties as in `nextMarker` (lowest line).
 */
export function prevMarker(events: readonly GcodeEvent[], playhead: number): GcodeEvent | null
export function prevMarker(markers: readonly number[], playhead: number): number | null
export function prevMarker(list: readonly GcodeEvent[] | readonly number[], playhead: number): GcodeEvent | number | null {
  let best: GcodeEvent | number | null = null
  for (const item of list) {
    if (typeof item === 'number') {
      if (item < playhead && (best === null || item > (best as number))) best = item
    } else if (isTimelineMarker(item) && item.moveIndex < playhead) {
      const b = best as GcodeEvent | null
      if (b === null || item.moveIndex > b.moveIndex || (item.moveIndex === b.moveIndex && item.line < b.line)) best = item
    }
  }
  return best
}
