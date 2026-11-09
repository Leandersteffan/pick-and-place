// Pure path building for the temperature and fan track (design section 6, Requirements 8.1 to 8.4).
// No DOM, no React. X uses the same mapping as the Event markers: moveIndex / (n - 1) of the width.

import type { GcodeEvent, StepTrack } from '../gcode/types'

/** Default top of the temperature axis, in °C. */
export const TEMP_AXIS_MAX = 250
/** Minimum pixel gap between two TEMPERATURE_WAIT labels; closer dots stay unlabelled. */
export const WAIT_LABEL_GAP = 30

/** X in pixels for Move `i` on a strip `width` wide over `n` Moves, clamped to [0, width]. */
export function xOf(i: number, n: number, width: number): number {
  const span = Math.max(1, n - 1)
  const x = (i / span) * width
  return x < 0 ? 0 : x > width ? width : x
}

/** Y in pixels (0 at the top) for `v` on an axis 0..yMax, clamped to the strip. */
export function yOf(v: number, yMax: number, height: number): number {
  const t = yMax > 0 ? v / yMax : 0
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  return height - c * height
}

/**
 * Top of the temperature axis: 250 °C, or the highest finite value plus 10 when anything
 * (a target or a wait bound) goes above 250.
 */
export function tempAxisMax(track: StepTrack, extra: readonly number[] = [], base = TEMP_AXIS_MAX): number {
  let max = -Infinity
  for (let k = 0; k < track.value.length; k++) {
    const v = track.value[k]
    if (Number.isFinite(v) && v > max) max = v
  }
  for (const v of extra) if (Number.isFinite(v) && v > max) max = v
  return max > base ? max + 10 : base
}

export interface StepPathOptions {
  /** Number of Moves on the Timeline. */
  n: number
  width: number
  height: number
  /** Value at the top of the strip. */
  yMax: number
  /** Value before the first entry. NaN (default) means "not set": the line starts at the first entry. */
  before?: number
}

/**
 * Step polyline in pixel coordinates as a flat `[x0, y0, x1, y1, ...]` array.
 *
 * Downsampled per pixel column: all entries that round to the same column collapse into one
 * vertical run that still reaches their lowest and highest value, so a file with millions
 * of entries yields at most 4 points per column (usually 2) and short spikes stay visible.
 * Non-finite values are skipped. An empty track gives a flat line at `before`, or nothing.
 */
export function stepPoints(track: StepTrack, o: StepPathOptions): number[] {
  const pts: number[] = []
  const width = Math.max(0, o.width)
  if (width === 0 || o.height <= 0 || o.n <= 0) return pts
  const push = (x: number, v: number) => {
    const y = yOf(v, o.yMax, o.height)
    const m = pts.length
    if (m >= 2 && pts[m - 2] === x && pts[m - 1] === y) return
    pts.push(x, y)
  }

  const before = o.before ?? NaN
  let cur = before
  let started = Number.isFinite(cur)
  if (started) push(0, cur)

  const idx = track.moveIndex
  const val = track.value
  const len = idx.length
  let k = 0
  while (k < len) {
    const col = Math.round(xOf(idx[k], o.n, width))
    let lo = Infinity
    let hi = -Infinity
    let first = NaN
    let last = NaN
    while (k < len && Math.round(xOf(idx[k], o.n, width)) === col) {
      const v = val[k]
      if (Number.isFinite(v)) {
        if (Number.isNaN(first)) first = v
        if (v < lo) lo = v
        if (v > hi) hi = v
        last = v
      }
      k++
    }
    if (Number.isNaN(last)) continue
    let s: number
    if (started) {
      push(col, cur)
      s = cur
    } else {
      push(col, first)
      s = first
      started = true
    }
    const a = Math.min(s, last)
    const b = Math.max(s, last)
    // Visit the extremes outside [s, last], the nearer one to s first.
    const outs: number[] = []
    if (lo < a) outs.push(lo)
    if (hi > b) outs.push(hi)
    if (outs.length === 2 && Math.abs(outs[1] - s) < Math.abs(outs[0] - s)) outs.reverse()
    for (const v of outs) push(col, v)
    push(col, last)
    cur = last
  }
  if (started) push(width, cur)
  return pts
}

/** Flat point array to an SVG `points` attribute. */
export function pointsAttr(pts: readonly number[]): string {
  let s = ''
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (i > 0) s += ' '
    s += `${round2(pts[i])},${round2(pts[i + 1])}`
  }
  return s
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export interface WaitMark {
  x: number
  /** The bound drawn as the dot's height, in °C. */
  value: number
  /** "≤102", "≥208", or "100–104" when both bounds are set. */
  label: string
  /** False when the dot is too close to the previous labelled one. */
  labelled: boolean
  title: string
  line: number
}

/** Bound label of a TEMPERATURE_WAIT: MAXIMUM gives "≤max", MINIMUM gives "≥min". */
export function waitLabel(min: number | undefined, max: number | undefined): string | null {
  const hasMin = min !== undefined && Number.isFinite(min)
  const hasMax = max !== undefined && Number.isFinite(max)
  if (hasMin && hasMax) return `${fmt(min)}–${fmt(max)}`
  if (hasMax) return `≤${fmt(max)}`
  if (hasMin) return `≥${fmt(min)}`
  return null
}

function fmt(v: number): string {
  return String(Math.round(v * 10) / 10)
}

/** Every TEMPERATURE_WAIT bound, for the temperature axis range. */
export function waitBounds(events: readonly GcodeEvent[]): number[] {
  const out: number[] = []
  for (const e of events) {
    if (e.data.kind !== 'temperature_wait') continue
    if (e.data.min !== undefined) out.push(e.data.min)
    if (e.data.max !== undefined) out.push(e.data.max)
  }
  return out
}

/**
 * Dots for TEMPERATURE_WAIT Events. Waits without a bound are skipped. At most one dot per
 * pixel column and label; labels closer than `gap` pixels to the previous label are hidden
 * (the title still carries them).
 */
export function waitMarks(events: readonly GcodeEvent[], n: number, width: number, gap = WAIT_LABEL_GAP): WaitMark[] {
  const out: WaitMark[] = []
  if (width <= 0 || n <= 0) return out
  let lastLabelX = -Infinity
  const seen = new Set<string>()
  for (const e of events) {
    if (e.data.kind !== 'temperature_wait') continue
    const { min, max, sensor } = e.data
    const label = waitLabel(min, max)
    if (label === null) continue
    const x = xOf(Math.min(e.moveIndex, n - 1), n, width)
    const key = `${Math.round(x)}|${label}`
    if (seen.has(key)) continue
    seen.add(key)
    const value = max !== undefined && Number.isFinite(max) ? max : (min as number)
    const labelled = x - lastLabelX >= gap
    if (labelled) lastLabelX = x
    out.push({ x, value, label, labelled, title: `TEMPERATURE_WAIT ${sensor} ${label} °C (line ${e.line})`, line: e.line })
  }
  return out
}

/** Readout text for the temperature target, NaN meaning "not set yet". */
export function formatTemp(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v)} °C` : '— °C'
}

/** Readout text for a fan value 0..1. */
export function formatFan(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v * 100)} %` : '— %'
}
