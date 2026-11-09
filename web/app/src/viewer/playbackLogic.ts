// Pure playback logic (design section 6, "Playback"; Requirements 6.3 to 6.7, 6.10).
// No React, no DOM, no three.js: playback.ts runs the rAF loop on top of this.
import { moveAtTime } from '../gcode/lookup'
import type { MoveTable } from '../gcode/types'

/** Speed factors offered next to the Timeline (Requirement 6.6). */
export const SPEEDS: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200]
export const DEFAULT_SPEED = 10

/** Longest wall-clock step one frame may take, so a hidden tab does not jump ahead. */
export const MAX_FRAME_DT = 0.25

/** The fields of a MoveTable that playback reads. */
export type TimedMoves = Pick<MoveTable, 'n' | 'tStart' | 'duration'>

export interface PlayState {
  playhead: number
  frac: number
  simTime: number
}

/** `h:mm:ss`, seconds floored; negative or non-finite input shows 0:00:00. */
export function formatHms(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** Integer Move index in [0, n - 1]; 0 for an empty table or NaN. */
export function clampIndex(index: number, n: number): number {
  if (n <= 0 || !Number.isFinite(index)) return 0
  return Math.min(n - 1, Math.max(0, Math.round(index)))
}

/** Estimated time at the playhead: `tStart[p] + frac * duration[p]`. */
export function elapsedAt(moves: TimedMoves, playhead: number, frac: number): number {
  if (moves.n === 0) return 0
  const p = clampIndex(Math.floor(playhead), moves.n)
  const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 1))
  return moves.tStart[p] + f * moves.duration[p]
}

/** Timeline drag: Move `index` complete, simTime at its end. */
export function seekState(moves: TimedMoves, index: number): PlayState {
  const playhead = clampIndex(index, moves.n)
  return { playhead, frac: 1, simTime: elapsedAt(moves, playhead, 1) }
}

/** True when the last Move is fully drawn. */
export function isAtEnd(moves: TimedMoves, playhead: number, frac: number): boolean {
  return moves.n === 0 || (playhead >= moves.n - 1 && frac >= 1)
}

/** simTime to start playing from: 0 when at the end (restart), else the current time. */
export function startTime(moves: TimedMoves, s: PlayState): number {
  return isAtEnd(moves, s.playhead, s.frac) ? 0 : s.simTime
}

/**
 * One playback frame: `simTime += dt * speed` (dt capped at MAX_FRAME_DT), clamped to
 * `totalTime`, then the Move at that time. `done` once simTime reaches totalTime; the
 * playhead is then the last Move, complete.
 */
export function advance(
  moves: TimedMoves,
  totalTime: number,
  simTime: number,
  dtSeconds: number,
  speed: number,
): PlayState & { done: boolean } {
  if (moves.n === 0) return { playhead: 0, frac: 1, simTime: 0, done: true }
  const dt = Math.min(MAX_FRAME_DT, Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0))
  const end = Math.max(totalTime, elapsedAt(moves, moves.n - 1, 1))
  const t = Math.min(end, Math.max(0, simTime) + dt * Math.max(0, speed))
  if (t >= end) return { playhead: moves.n - 1, frac: 1, simTime: end, done: true }
  const { index, frac } = moveAtTime(moves as MoveTable, t)
  return { playhead: index, frac, simTime: t, done: false }
}
