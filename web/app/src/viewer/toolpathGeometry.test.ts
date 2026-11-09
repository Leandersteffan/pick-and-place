import { describe, expect, it } from 'vitest'
import type { BufferAttribute } from 'three'
import fixture from '../../../fixtures/demo-v1/combined_output.gcode?raw'
import { parseGcode } from '../gcode/parser'
import { MOVE_TYPES } from '../gcode/types'
import {
  LEGEND,
  PALETTE,
  PlayheadPatch,
  buildToolpathArrays,
  buildToolpathGeometry,
  drawCount,
  hexToRgb,
  interpolatedPoint,
  playheadIndex,
} from './toolpathGeometry'

const parsed = parseGcode(fixture)
const moves = parsed.moves
const n = moves.n

/** First Move whose start and end differ in all of x, y (a non-degenerate segment). */
function firstNonDegenerate(): number {
  for (let i = 0; i < n; i++) {
    if (moves.x0[i] !== moves.x1[i] && moves.y0[i] !== moves.y1[i] && moves.z0[i] !== moves.z1[i]) return i
  }
  for (let i = 0; i < n; i++) if (moves.x0[i] !== moves.x1[i]) return i
  throw new Error('no non-degenerate move')
}

describe('buildToolpathGeometry on the Fixture', () => {
  it('has 2 vertices per Move and draws all of them', () => {
    expect(n).toBeGreaterThan(0)
    const g = buildToolpathGeometry(moves)
    expect(g.getAttribute('position').count).toBe(2 * n)
    expect(g.getAttribute('color').count).toBe(2 * n)
    expect(g.getAttribute('aType').count).toBe(2 * n)
    expect(g.getAttribute('aSeg').count).toBe(2 * n)
    expect(g.getAttribute('aLayer').count).toBe(2 * n)
    expect((g.getAttribute('color') as BufferAttribute).normalized).toBe(true)
    expect(g.drawRange).toEqual({ start: 0, count: 2 * n })
  })

  it('stores start and end, palette colour, type, segment and layer per Move', () => {
    const a = buildToolpathArrays(moves)
    for (const i of [0, Math.floor(n / 2), n - 1]) {
      expect(a.position[6 * i]).toBeCloseTo(moves.x0[i], 4)
      expect(a.position[6 * i + 4]).toBeCloseTo(moves.y1[i], 4)
      expect(a.position[6 * i + 5]).toBeCloseTo(moves.z1[i], 4)
      const rgb = hexToRgb(PALETTE[MOVE_TYPES[moves.type[i]]])
      expect(Array.from(a.color.slice(6 * i, 6 * i + 6))).toEqual([...rgb, ...rgb])
      expect([a.aType[2 * i], a.aType[2 * i + 1]]).toEqual([moves.type[i], moves.type[i]])
      expect(a.aSeg[2 * i + 1]).toBe(moves.segment[i])
      expect(a.aLayer[2 * i]).toBe(moves.layer[i])
    }
    // Both segments are present.
    expect(new Set(a.aSeg)).toEqual(new Set([1, 2]))
  })
})

describe('draw range', () => {
  it('is 2 * (p + 1) for playhead p, clamped to the table', () => {
    expect(drawCount(0, n)).toBe(2)
    expect(drawCount(100, n)).toBe(202)
    expect(drawCount(100.7, n)).toBe(202)
    expect(drawCount(n - 1, n)).toBe(2 * n)
    expect(drawCount(n + 50, n)).toBe(2 * n)
    expect(drawCount(-3, n)).toBe(2)
    expect(drawCount(0, 0)).toBe(0)
    expect(playheadIndex(n + 5, n)).toBe(n - 1)
  })
})

describe('interpolated end point', () => {
  const p = firstNonDegenerate()

  it('is the start at 0, the midpoint at 0.5 and the end at 1', () => {
    expect(interpolatedPoint(moves, p, 0)).toEqual([moves.x0[p], moves.y0[p], moves.z0[p]])
    expect(interpolatedPoint(moves, p, 1)).toEqual([moves.x1[p], moves.y1[p], moves.z1[p]])
    const mid = interpolatedPoint(moves, p, 0.5)
    expect(mid[0]).toBeCloseTo((moves.x0[p] + moves.x1[p]) / 2, 9)
    expect(mid[1]).toBeCloseTo((moves.y0[p] + moves.y1[p]) / 2, 9)
    expect(mid[2]).toBeCloseTo((moves.z0[p] + moves.z1[p]) / 2, 9)
  })

  it('PlayheadPatch writes one 3-float range and restores the end vertex when p advances', () => {
    const g = buildToolpathGeometry(moves)
    const pos = g.getAttribute('position') as BufferAttribute
    const original = Array.from(pos.array.slice(3 * (2 * p + 1), 3 * (2 * p + 1) + 3))
    const patch = new PlayheadPatch(g, moves)

    const marker = patch.apply(p, 0.5)
    expect(marker).toEqual(interpolatedPoint(moves, p, 0.5))
    expect(g.drawRange.count).toBe(2 * (p + 1))
    expect(pos.updateRanges).toEqual([{ start: 3 * (2 * p + 1), count: 3 }])
    expect(pos.array[3 * (2 * p + 1)]).toBeCloseTo(marker![0], 4)
    expect(patch.patchedMove).toBe(p)

    pos.clearUpdateRanges()
    const next = patch.apply(p + 1, 1)
    expect(next).toEqual([moves.x1[p + 1], moves.y1[p + 1], moves.z1[p + 1]])
    expect(Array.from(pos.array.slice(3 * (2 * p + 1), 3 * (2 * p + 1) + 3))).toEqual(original)
    expect(patch.patchedMove).toBe(-1)
    expect(g.drawRange.count).toBe(2 * (p + 2))
  })

  it('PlayheadPatch on the last Move with frac 1 marks the end of the toolpath', () => {
    const g = buildToolpathGeometry(moves)
    const end = new PlayheadPatch(g, moves).apply(n - 1)
    expect(end).toEqual([moves.x1[n - 1], moves.y1[n - 1], moves.z1[n - 1]])
    expect(g.drawRange.count).toBe(2 * n)
  })
})

describe('legend', () => {
  it('lists every Move_Type in MOVE_TYPES order with its palette colour', () => {
    expect(LEGEND.map((l) => l.type)).toEqual([...MOVE_TYPES])
    for (const l of LEGEND) expect(l.color).toBe(PALETTE[l.type])
  })
})
