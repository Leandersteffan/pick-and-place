import { describe, expect, it } from 'vitest'
import { parseGcode } from './parser'
import { buildTrack, fanTrack, tempTrack, valueAt } from './tracks'
import type { GcodeEvent } from './types'

describe('valueAt', () => {
  const track = buildTrack([
    { moveIndex: 2, value: 140 },
    { moveIndex: 5, value: 100 },
    { moveIndex: 5, value: 210 },
    { moveIndex: 9, value: 180 },
  ])

  it('is a step function, last entry at the same index wins', () => {
    expect(valueAt(track, 2)).toBe(140)
    expect(valueAt(track, 4)).toBe(140)
    expect(valueAt(track, 5)).toBe(210)
    expect(valueAt(track, 8)).toBe(210)
    expect(valueAt(track, 9)).toBe(180)
    expect(valueAt(track, 1e6)).toBe(180)
  })

  it('returns NaN (or the given fallback) before the first entry', () => {
    expect(valueAt(track, 1)).toBeNaN()
    expect(valueAt(track, 1, 0)).toBe(0)
    expect(valueAt(buildTrack([]), 0)).toBeNaN()
  })
})

describe('tempTrack and fanTrack', () => {
  it('take T0 temperature Events and part-fan Events', () => {
    const ev = (moveIndex: number, data: GcodeEvent['data']): GcodeEvent =>
      ({ kind: data.kind === 'none' ? 'pause' : (data.kind as GcodeEvent['kind']), line: 1, moveIndex, label: '', data })
    const events = [
      ev(0, { kind: 'temperature', tool: 0, target: 210, wait: true }),
      ev(3, { kind: 'temperature', tool: 1, target: 100, wait: false }),
      ev(4, { kind: 'fan', fan: 0, value: 0.5 }),
      ev(6, { kind: 'temperature', tool: 0, target: 100, wait: false }),
      ev(7, { kind: 'none' }),
    ]
    const t = tempTrack(events)
    expect(Array.from(t.moveIndex)).toEqual([0, 6])
    expect(Array.from(t.value)).toEqual([210, 100])
    const f = fanTrack(events)
    expect(Array.from(f.moveIndex)).toEqual([4])
    expect(Array.from(f.value)).toEqual([0.5])
  })

  it('parser tracks match the Events', () => {
    const r = parseGcode('G90\nM83\nG92 X0 Y0 Z0\nG1 X1\nM104 S140\nM106 S255\nG1 X2\nM107\nG1 X3\n')
    expect(valueAt(r.tempTrack, 0)).toBeNaN()
    expect(valueAt(r.tempTrack, 1)).toBe(140)
    expect(valueAt(r.fanTrack, 1)).toBe(1)
    expect(valueAt(r.fanTrack, 2)).toBe(0)
  })
})
