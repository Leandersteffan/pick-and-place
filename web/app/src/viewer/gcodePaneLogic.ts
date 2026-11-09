// Pure helpers for the gcode text pane (GcodePane.tsx; Requirements 5.12, 9.1, 9.2, 9.3).
// No React, no DOM: line decoding, the light syntax tint, marker tints, the
// follow-pause rule and unhandled-line navigation. Runs under Vitest in Node.
import { splitLines } from '../gcode/lexer'
import { isTimelineMarker } from '../gcode/lookup'
import type { EventKind, GcodeEvent, MoveTable, MoveType } from '../gcode/types'
import { PALETTE } from './toolpathGeometry'

/** Fixed row height in px (design section 6). */
export const ROW_HEIGHT = 18

/** How long a wheel, drag or key scroll by the user pauses following the playhead. */
export const FOLLOW_PAUSE_MS = 2000

// ---------------------------------------------------------------------------
// Lines, decoded once per bytes object

const lineCache = new WeakMap<Uint8Array, string[]>()

/**
 * The source lines of a gcode file, index i = line i + 1. Decoded and split once per
 * Uint8Array (the Project replaces the array when the file changes), so re-renders and
 * remounts never split again. CRLF and LF give the same lines.
 */
export function linesForBytes(bytes: Uint8Array): string[] {
  let lines = lineCache.get(bytes)
  if (!lines) {
    // splitLines('') is [''] (one empty source line); the pane shows no rows for an empty file.
    lines = bytes.length === 0 ? [] : splitLines(new TextDecoder().decode(bytes))
    lineCache.set(bytes, lines)
  }
  return lines
}

// ---------------------------------------------------------------------------
// Syntax tint

export type LineClass =
  | 'gc-blank'
  | 'gc-comment'
  | 'gc-move'
  | 'gc-temp'
  | 'gc-fan'
  | 'gc-pause'
  | 'gc-cmd'
  | 'gc-macro'
  | 'gc-other'

const TEMP_CODES = new Set(['M104', 'M109', 'M140', 'M190'])
const TEMP_MACROS = new Set(['TEMPERATURE_WAIT', 'SET_HEATER_TEMPERATURE'])
const FAN_CODES = new Set(['M106', 'M107'])
const RE_CODE = /^([GMT])0*(\d+)(?![\d.])/i
const RE_MACRO = /^[A-Z_][A-Z0-9_]*(?=\s|$)/i

/** Splits a line into its code part and its `;` comment (comment includes the `;`, '' if none). */
export function splitComment(text: string): [code: string, comment: string] {
  const i = text.indexOf(';')
  return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i)]
}

/**
 * CSS class for the code part of a line: comments grey, G0 to G3 white, temperature,
 * fan and PAUSE coloured, other commands dimmer. Only the first word is inspected.
 */
export function lineClass(text: string): LineClass {
  const t = text.trimStart()
  if (t.length === 0) return 'gc-blank'
  if (t.charCodeAt(0) === 59 /* ; */) return 'gc-comment'
  const m = RE_CODE.exec(t)
  if (m) {
    const code = m[1].toUpperCase() + String(Number(m[2]))
    if (code === 'G0' || code === 'G1' || code === 'G2' || code === 'G3') return 'gc-move'
    if (TEMP_CODES.has(code)) return 'gc-temp'
    if (FAN_CODES.has(code)) return 'gc-fan'
    if (code === 'M601') return 'gc-pause'
    return 'gc-cmd'
  }
  const mm = RE_MACRO.exec(t)
  if (mm) {
    const name = mm[0].toUpperCase()
    if (name === 'PAUSE') return 'gc-pause'
    if (TEMP_MACROS.has(name)) return 'gc-temp'
    return 'gc-macro'
  }
  return 'gc-other'
}

// ---------------------------------------------------------------------------
// Marker lines

/** Marker kinds drawn in a Move_Type colour; the others use their Timeline marker colour. */
const MARKER_MOVE_TYPE: Partial<Record<EventKind, MoveType>> = {
  pick_seq: 'pick',
  place_seq: 'place',
  tamping: 'tamp',
  prinjection: 'prinjection',
  wipe: 'wipe',
}

/** Same colours as the `.event-*` Timeline markers in styles.css. */
const MARKER_FALLBACK: Partial<Record<EventKind, string>> = {
  pause: '#e05555',
  placement_group: '#e0b84f',
  placing: '#f2d27a',
  pnp_header: '#a58fd6',
}

/** Tint colour for a marker line of this Event kind. */
export function markerTint(kind: EventKind): string {
  const t = MARKER_MOVE_TYPE[kind]
  if (t) return PALETTE[t]
  return MARKER_FALLBACK[kind] ?? '#e0b84f'
}

/** Source line (1-based) to tint colour for every Timeline marker Event. First Event on a line wins. */
export function markerLineTints(events: readonly GcodeEvent[]): Map<number, string> {
  const out = new Map<number, string>()
  for (const e of events) {
    if (isTimelineMarker(e) && !out.has(e.line)) out.set(e.line, markerTint(e.kind))
  }
  return out
}

// ---------------------------------------------------------------------------
// Playhead and scrolling

/** Source line (1-based) of Move `playhead`, or 0 when there are no Moves. */
export function playheadLine(moves: MoveTable, playhead: number): number {
  if (moves.n === 0) return 0
  const i = Math.min(moves.n - 1, Math.max(0, Math.floor(playhead)))
  return moves.line[i]
}

/**
 * Whether following the playhead is allowed now: the toggle is on and the last manual
 * scroll (wheel, scrollbar drag, touch, key) is at least `pauseMs` ago.
 */
export function followAllowed(followOn: boolean, lastUserScroll: number, now: number, pauseMs = FOLLOW_PAUSE_MS): boolean {
  return followOn && now - lastUserScroll >= pauseMs
}

/**
 * Whether row `index` must be scrolled to: it is outside the visible rows
 * `[first, last]` shrunk by `margin` rows on both sides. A row already comfortably in
 * view is left alone, so playback reads smoothly instead of re-centring every line.
 */
export function needsScroll(index: number, first: number, last: number, margin = 2): boolean {
  if (last < first) return true
  const lo = first + margin
  const hi = last - margin
  if (hi < lo) return index < first || index > last
  return index < lo || index > hi
}

// ---------------------------------------------------------------------------
// Unhandled lines

/**
 * The next unhandled line after `currentLine`, wrapping to the first one; null if the
 * list is empty. `unhandled` is sorted ascending (the parser appends in source order).
 */
export function nextUnhandled(unhandled: readonly number[], currentLine: number): number | null {
  if (unhandled.length === 0) return null
  let lo = 0, hi = unhandled.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (unhandled[mid] <= currentLine) lo = mid + 1
    else hi = mid
  }
  return lo < unhandled.length ? unhandled[lo] : unhandled[0]
}

/** "1 unhandled line" / "N unhandled lines". */
export function unhandledLabel(count: number): string {
  return `${count.toLocaleString('en-US')} unhandled line${count === 1 ? '' : 's'}`
}
