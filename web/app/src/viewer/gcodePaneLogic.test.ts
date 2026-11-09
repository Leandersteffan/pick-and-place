import { describe, expect, it } from 'vitest'
import type { GcodeEvent, MoveTable } from '../gcode/types'
import {
  followAllowed,
  lineClass,
  linesForBytes,
  markerLineTints,
  needsScroll,
  nextUnhandled,
  playheadLine,
  splitComment,
  unhandledLabel,
} from './gcodePaneLogic'
import { PALETTE } from './toolpathGeometry'

const enc = (s: string) => new TextEncoder().encode(s)

describe('linesForBytes', () => {
  it('splits CRLF and LF the same and drops the final newline', () => {
    expect(linesForBytes(enc('G1 X1\r\n;c\r\n'))).toEqual(['G1 X1', ';c'])
    expect(linesForBytes(enc('G1 X1\n;c\n'))).toEqual(['G1 X1', ';c'])
  })
  it('decodes once per bytes object', () => {
    const b = enc('a\nb')
    expect(linesForBytes(b)).toBe(linesForBytes(b))
  })
  it('gives no lines for an empty file', () => {
    expect(linesForBytes(new Uint8Array(0))).toEqual([])
  })
})

describe('lineClass', () => {
  it.each([
    ['', 'gc-blank'],
    ['   ', 'gc-blank'],
    ['; comment', 'gc-comment'],
    ['  ;LAYER_CHANGE', 'gc-comment'],
    ['G1 X10 E.8', 'gc-move'],
    ['G0 Z3', 'gc-move'],
    ['G01 X1', 'gc-move'],
    ['g2 X1 Y1 I1 J0', 'gc-move'],
    ['G28', 'gc-cmd'],
    ['G10', 'gc-cmd'],
    ['M104 S210 T0', 'gc-temp'],
    ['M109 R180', 'gc-temp'],
    ['TEMPERATURE_WAIT SENSOR=extruder MAXIMUM=102', 'gc-temp'],
    ['M106 S255', 'gc-fan'],
    ['M107', 'gc-fan'],
    ['PAUSE', 'gc-pause'],
    ['M601', 'gc-pause'],
    ['PRINT_START EXTRUDER=210', 'gc-macro'],
    ['T1', 'gc-cmd'],
    ['?garbage', 'gc-other'],
  ])('%j is %s', (text, cls) => {
    expect(lineClass(text)).toBe(cls)
  })
})

describe('splitComment', () => {
  it('keeps the semicolon with the comment', () => {
    expect(splitComment('G1 X1 ; move')).toEqual(['G1 X1 ', '; move'])
    expect(splitComment('G1 X1')).toEqual(['G1 X1', ''])
    expect(splitComment(';only')).toEqual(['', ';only'])
  })
})

describe('markerLineTints', () => {
  const ev = (kind: GcodeEvent['kind'], line: number): GcodeEvent =>
    ({ kind, line, moveIndex: 0, label: kind, data: { kind: 'none' } }) as unknown as GcodeEvent
  it('tints marker lines only, in the Move_Type colour where there is one', () => {
    const m = markerLineTints([ev('tamping', 5), ev('temperature', 6), ev('pause', 7), ev('pick_seq', 9)])
    expect(m.get(5)).toBe(PALETTE.tamp)
    expect(m.get(9)).toBe(PALETTE.pick)
    expect(m.has(6)).toBe(false)
    expect(m.get(7)).toBeTypeOf('string')
  })
})

describe('playheadLine', () => {
  const moves = { n: 3, line: new Uint32Array([4, 7, 9]) } as unknown as MoveTable
  it('maps and clamps the playhead', () => {
    expect(playheadLine(moves, 1)).toBe(7)
    expect(playheadLine(moves, 1.6)).toBe(7)
    expect(playheadLine(moves, 99)).toBe(9)
    expect(playheadLine(moves, -1)).toBe(4)
    expect(playheadLine({ n: 0, line: new Uint32Array(0) } as unknown as MoveTable, 0)).toBe(0)
  })
})

describe('followAllowed', () => {
  it('pauses for 2 s after a manual scroll and respects the toggle', () => {
    expect(followAllowed(true, -Infinity, 0)).toBe(true)
    expect(followAllowed(true, 1000, 2500)).toBe(false)
    expect(followAllowed(true, 1000, 3000)).toBe(true)
    expect(followAllowed(false, -Infinity, 5000)).toBe(false)
  })
})

describe('needsScroll', () => {
  it('scrolls only when the row leaves the comfortable band', () => {
    expect(needsScroll(50, 40, 60)).toBe(false)
    expect(needsScroll(41, 40, 60)).toBe(true)
    expect(needsScroll(59, 40, 60)).toBe(true)
    expect(needsScroll(100, 40, 60)).toBe(true)
    expect(needsScroll(3, 2, 4)).toBe(false) // tiny pane: anything visible is enough
    expect(needsScroll(0, 0, -1)).toBe(true) // not laid out yet
  })
})

describe('nextUnhandled', () => {
  it('finds the next line after the current one and wraps', () => {
    expect(nextUnhandled([], 5)).toBeNull()
    expect(nextUnhandled([3, 8, 20], 0)).toBe(3)
    expect(nextUnhandled([3, 8, 20], 3)).toBe(8)
    expect(nextUnhandled([3, 8, 20], 10)).toBe(20)
    expect(nextUnhandled([3, 8, 20], 20)).toBe(3)
  })
  it('labels the chip', () => {
    expect(unhandledLabel(1)).toBe('1 unhandled line')
    expect(unhandledLabel(1234)).toBe('1,234 unhandled lines')
  })
})
