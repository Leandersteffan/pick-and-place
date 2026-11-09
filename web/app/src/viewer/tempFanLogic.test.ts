import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/demo-v1/combined_output.gcode?raw'
import { parseGcode } from '../gcode/parser'
import { buildTrack } from '../gcode/tracks'
import type { GcodeEvent } from '../gcode/types'
import { formatFan, formatTemp, stepPoints, tempAxisMax, waitBounds, waitLabel, waitMarks, xOf, yOf } from './tempFanLogic'

const empty = buildTrack([])

function pairs(pts: number[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < pts.length; i += 2) out.push([pts[i], pts[i + 1]])
  return out
}

function wait(moveIndex: number, min?: number, max?: number): GcodeEvent {
  return {
    kind: 'temperature_wait',
    line: moveIndex + 1,
    moveIndex,
    label: 'TEMPERATURE_WAIT',
    data: { kind: 'temperature_wait', sensor: 'extruder', min, max },
  }
}

describe('xOf and yOf', () => {
  it('maps moveIndex / (n - 1) to the width and clamps', () => {
    expect(xOf(0, 11, 100)).toBe(0)
    expect(xOf(5, 11, 100)).toBe(50)
    expect(xOf(10, 11, 100)).toBe(100)
    expect(xOf(99, 11, 100)).toBe(100)
    expect(xOf(0, 1, 100)).toBe(0)
  })
  it('puts 0 at the bottom and yMax at the top', () => {
    expect(yOf(0, 250, 40)).toBe(40)
    expect(yOf(250, 250, 40)).toBe(0)
    expect(yOf(400, 250, 40)).toBe(0)
  })
})

describe('tempAxisMax', () => {
  it('is 250 unless something goes above it, then max + 10', () => {
    expect(tempAxisMax(empty)).toBe(250)
    expect(tempAxisMax(buildTrack([{ moveIndex: 0, value: 210 }]))).toBe(250)
    expect(tempAxisMax(buildTrack([{ moveIndex: 0, value: 300 }]))).toBe(310)
    expect(tempAxisMax(empty, [270])).toBe(280)
  })
})

describe('stepPoints', () => {
  const o = { n: 101, width: 100, height: 50, yMax: 100 }

  it('returns nothing for an empty track without a before value, a flat line with one', () => {
    expect(stepPoints(empty, o)).toEqual([])
    expect(pairs(stepPoints(empty, { ...o, before: 0 }))).toEqual([[0, 50], [100, 50]])
  })

  it('draws a step function', () => {
    const t = buildTrack([{ moveIndex: 20, value: 100 }, { moveIndex: 60, value: 50 }])
    expect(pairs(stepPoints(t, o))).toEqual([[20, 0], [60, 0], [60, 25], [100, 25]])
    expect(pairs(stepPoints(t, { ...o, before: 0 }))).toEqual([[0, 50], [20, 50], [20, 0], [60, 0], [60, 25], [100, 25]])
  })

  it('keeps a spike inside one pixel column', () => {
    const t = buildTrack([{ moveIndex: 0, value: 10 }, { moveIndex: 50_000, value: 100 }, { moveIndex: 50_001, value: 10 }])
    const pts = pairs(stepPoints(t, { ...o, n: 100_001 }))
    expect(pts.some(([x, y]) => x === 50 && y === 0)).toBe(true)
    expect(pts[pts.length - 1]).toEqual([100, 45])
  })

  it('downsamples a huge track to a few points per pixel column', () => {
    const entries = []
    for (let i = 0; i < 200_000; i++) entries.push({ moveIndex: i * 5, value: (i * 37) % 250 })
    const width = 300
    const pts = stepPoints(buildTrack(entries), { n: 1_000_000, width, height: 40, yMax: 250 })
    expect(pts.length / 2).toBeLessThanOrEqual(4 * (width + 1) + 2)
    for (const [x, y] of pairs(pts)) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(width)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(40)
    }
  })

  it('skips non-finite values and handles zero width', () => {
    const t = buildTrack([{ moveIndex: 10, value: NaN }, { moveIndex: 30, value: 50 }])
    expect(pairs(stepPoints(t, o))[0]).toEqual([30, 25])
    expect(stepPoints(t, { ...o, width: 0 })).toEqual([])
  })
})

describe('TEMPERATURE_WAIT marks', () => {
  it('labels MAXIMUM as ≤ and MINIMUM as ≥', () => {
    expect(waitLabel(undefined, 102)).toBe('≤102')
    expect(waitLabel(208, undefined)).toBe('≥208')
    expect(waitLabel(100, 104)).toBe('100–104')
    expect(waitLabel(undefined, undefined)).toBeNull()
  })

  it('places dots at the bound, hides crowded labels, skips bare waits', () => {
    const events = [wait(0, undefined, 102), wait(1, 208), wait(50), wait(100, 208)]
    const marks = waitMarks(events, 101, 100)
    expect(marks.map((m) => [m.x, m.value, m.label, m.labelled])).toEqual([
      [0, 102, '≤102', true],
      [1, 208, '≥208', false],
      [100, 208, '≥208', true],
    ])
    expect(waitBounds(events)).toEqual([102, 208, 208])
  })
})

describe('readout text', () => {
  it('formats set and unset values', () => {
    expect(formatTemp(209.6)).toBe('210 °C')
    expect(formatTemp(NaN)).toBe('— °C')
    expect(formatFan(0.5)).toBe('50 %')
  })
})

describe('on the fixture', () => {
  const parse = parseGcode(fixture)
  const n = parse.moves.n
  it('builds a temperature line and dots for the pick waits', () => {
    const yMax = tempAxisMax(parse.tempTrack, waitBounds(parse.events))
    expect(stepPoints(parse.tempTrack, { n, width: 800, height: 35, yMax }).length).toBeGreaterThan(0)
    const marks = waitMarks(parse.events, n, 800)
    expect(marks.length).toBeGreaterThan(0)
    expect(marks.every((m) => /^[≤≥]\d/.test(m.label) || m.label.includes('–'))).toBe(true)
  })
})
