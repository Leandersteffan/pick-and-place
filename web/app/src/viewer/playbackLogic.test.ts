import { describe, expect, it } from 'vitest'
import { segmentLabel, withLayerBound } from './visibility'
import {
  MAX_FRAME_DT,
  SPEEDS,
  advance,
  clampIndex,
  elapsedAt,
  formatHms,
  isAtEnd,
  seekState,
  startTime,
  type TimedMoves,
} from './playbackLogic'

// Three Moves: [0, 2), [2, 2) zero-duration, [2, 6).
const moves: TimedMoves = {
  n: 3,
  tStart: new Float64Array([0, 2, 2]),
  duration: new Float32Array([2, 0, 4]),
}
const TOTAL = 6

describe('formatHms', () => {
  it('formats h:mm:ss with floored seconds', () => {
    expect(formatHms(0)).toBe('0:00:00')
    expect(formatHms(59.9)).toBe('0:00:59')
    expect(formatHms(61)).toBe('0:01:01')
    expect(formatHms(3600 + 2 * 60 + 3)).toBe('1:02:03')
    expect(formatHms(36000)).toBe('10:00:00')
  })
  it('shows 0:00:00 for negative or non-finite input', () => {
    expect(formatHms(-5)).toBe('0:00:00')
    expect(formatHms(NaN)).toBe('0:00:00')
    expect(formatHms(Infinity)).toBe('0:00:00')
  })
})

describe('speeds and clamping', () => {
  it('offers 1x to 200x', () => {
    expect(SPEEDS).toEqual([1, 2, 5, 10, 20, 50, 100, 200])
  })
  it('clamps an index to [0, n - 1]', () => {
    expect(clampIndex(-3, 3)).toBe(0)
    expect(clampIndex(1.4, 3)).toBe(1)
    expect(clampIndex(9, 3)).toBe(2)
    expect(clampIndex(NaN, 3)).toBe(0)
    expect(clampIndex(5, 0)).toBe(0)
  })
})

describe('seek and elapsed', () => {
  it('elapsed is tStart + frac * duration', () => {
    expect(elapsedAt(moves, 0, 0.5)).toBe(1)
    expect(elapsedAt(moves, 2, 0.25)).toBe(3)
    expect(elapsedAt(moves, 2, 1)).toBe(6)
  })
  it('a drag sets the Move complete and simTime at its end', () => {
    expect(seekState(moves, 0)).toEqual({ playhead: 0, frac: 1, simTime: 2 })
    expect(seekState(moves, 99)).toEqual({ playhead: 2, frac: 1, simTime: 6 })
  })
  it('play at the end restarts from 0, elsewhere it continues', () => {
    expect(isAtEnd(moves, 2, 1)).toBe(true)
    expect(isAtEnd(moves, 2, 0.5)).toBe(false)
    expect(startTime(moves, { playhead: 2, frac: 1, simTime: 6 })).toBe(0)
    expect(startTime(moves, { playhead: 0, frac: 1, simTime: 2 })).toBe(2)
  })
})

describe('advance', () => {
  it('moves simTime by dt * speed and maps it to the Move at that time', () => {
    const r = advance(moves, TOTAL, 0, 0.1, 10)
    expect(r.simTime).toBeCloseTo(1, 9)
    expect(r.playhead).toBe(0)
    expect(r.frac).toBeCloseTo(0.5, 9)
    expect(r.done).toBe(false)
    const r2 = advance(moves, TOTAL, 2.5, 0.05, 10)
    expect(r2.playhead).toBe(2)
    expect(r2.frac).toBeCloseTo(0.25, 9)
  })
  it('caps a long frame at MAX_FRAME_DT', () => {
    expect(advance(moves, TOTAL, 0, 10, 1).simTime).toBeCloseTo(MAX_FRAME_DT, 9)
  })
  it('stops at the end with the last Move complete', () => {
    expect(advance(moves, TOTAL, 5.9, 0.2, 200)).toEqual({ playhead: 2, frac: 1, simTime: 6, done: true })
  })
  it('a zero dt does not move the playhead', () => {
    const r = advance(moves, TOTAL, 3, 0, 50)
    expect(r.simTime).toBe(3)
    expect(r.playhead).toBe(2)
  })
  it('an empty table is done at once', () => {
    const empty: TimedMoves = { n: 0, tStart: new Float64Array(0), duration: new Float32Array(0) }
    expect(advance(empty, 0, 0, 0.1, 1).done).toBe(true)
  })
})

describe('layer slider bounds', () => {
  it('labels segment 1 Tray, 2 Housing, else Segment N', () => {
    expect(segmentLabel(1)).toBe('Tray')
    expect(segmentLabel(2)).toBe('Housing')
    expect(segmentLabel(3)).toBe('Segment 3')
  })
  it('clamps to [0, layerCount] and keeps min <= max', () => {
    expect(withLayerBound([0, 10], 0, 4, 10)).toEqual([4, 10])
    expect(withLayerBound([0, 10], 1, 15, 10)).toEqual([0, 10])
    expect(withLayerBound([2, 5], 0, 8, 10)).toEqual([8, 8])
    expect(withLayerBound([6, 9], 1, 3, 10)).toEqual([3, 3])
    expect(withLayerBound([0, 10], 0, -2, 10)).toEqual([0, 10])
  })
})
