import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/demo-v1/combined_output.gcode?raw'
import {
  TIMELINE_MARKER_KINDS, firstMoveAtOrAfterLine, markerIndices, moveAtTime, nextMarker, prevMarker,
} from './lookup'
import { parseGcode } from './parser'

const head = 'G90\nM83\nG92 X0 Y0 Z0\n'

describe('firstMoveAtOrAfterLine', () => {
  // Moves on lines 4, 6 and 8; Events on lines 5 and 7.
  const r = parseGcode(`${head}G1 X1 F600\n;Pick Sequence\nG1 X2\nPAUSE\nG1 X3\n`)

  it('finds the smallest Move at or after a line, else the last', () => {
    expect(Array.from(r.moves.line)).toEqual([4, 6, 8])
    expect(firstMoveAtOrAfterLine(r, 1)).toBe(0)
    expect(firstMoveAtOrAfterLine(r, 4)).toBe(0)
    expect(firstMoveAtOrAfterLine(r, 5)).toBe(1)
    expect(firstMoveAtOrAfterLine(r.moves, 7)).toBe(2)
    expect(firstMoveAtOrAfterLine(r, 99)).toBe(2)
  })

  it('every marker Event points at the first Move after its line', () => {
    for (const e of r.events) expect(firstMoveAtOrAfterLine(r, e.line)).toBe(e.moveIndex)
  })

  it('is -1 on an empty table', () => {
    expect(firstMoveAtOrAfterLine(parseGcode(''), 3)).toBe(-1)
  })
})

describe('moveAtTime', () => {
  // Three 1 s moves at 10 mm/s, starting at t = 0, 1, 2.
  const r = parseGcode(`${head}G1 X10 F600\nG1 X20\nG1 X30\n`)

  it('maps time to the Move being executed and its fraction', () => {
    expect(moveAtTime(r, -1)).toEqual({ index: 0, frac: 0 })
    expect(moveAtTime(r, 0)).toEqual({ index: 0, frac: 0 })
    const a = moveAtTime(r, 1.25)
    expect(a.index).toBe(1)
    expect(a.frac).toBeCloseTo(0.25, 6)
    expect(moveAtTime(r.moves, 99)).toEqual({ index: 2, frac: 1 })
  })

  it('is index -1 on an empty table', () => {
    expect(moveAtTime(parseGcode(''), 1)).toEqual({ index: -1, frac: 0 })
  })
})

describe('nextMarker and prevMarker', () => {
  const r = parseGcode(
    `${head}G1 X1 F600\n;Pick Sequence\nM104 S100\nG1 X2\nG1 X3\n;Nozzle Wipe Sequence\n;Place Sequence\nG1 X4\nPAUSE\nG1 X5\n`,
  )

  it('marker kinds are the Assembly_Marker kinds plus pause', () => {
    expect(TIMELINE_MARKER_KINDS).toContain('pause')
    expect(TIMELINE_MARKER_KINDS).toContain('placement_group')
    expect(TIMELINE_MARKER_KINDS).not.toContain('temperature')
  })

  it('returns the adjacent marker Event, ignoring other Events', () => {
    // pick_seq -> move 1, wipe and place_seq -> move 3, pause -> move 4
    expect(markerIndices(r.events)).toEqual([1, 3, 4])
    expect(nextMarker(r.events, 0)?.kind).toBe('pick_seq')
    expect(nextMarker(r.events, 1)?.kind).toBe('wipe') // lowest line at move 3
    expect(nextMarker(r.events, 3)?.kind).toBe('pause')
    expect(nextMarker(r.events, 4)).toBeNull()
    expect(prevMarker(r.events, 4)?.kind).toBe('wipe')
    expect(prevMarker(r.events, 2)?.kind).toBe('pick_seq')
    expect(prevMarker(r.events, 1)).toBeNull()
  })

  it('works over sorted marker indices too', () => {
    const idx = markerIndices(r.events)
    expect(nextMarker(idx, 1)).toBe(3)
    expect(prevMarker(idx, 3)).toBe(1)
    expect(nextMarker(idx, 4)).toBeNull()
    expect(prevMarker(idx, 0)).toBeNull()
  })
})

describe('lookups on the Fixture', () => {
  const p = parseGcode(fixture)

  it('total time is finite and positive, and half of it maps to a valid Move', () => {
    expect(Number.isFinite(p.totalTime)).toBe(true)
    expect(p.totalTime).toBeGreaterThan(0)
    const { index, frac } = moveAtTime(p, p.totalTime / 2)
    expect(Number.isInteger(index)).toBe(true)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(p.moves.n)
    expect(frac).toBeGreaterThanOrEqual(0)
    expect(frac).toBeLessThanOrEqual(1)
  })

  it('tStart is non-decreasing and line lookup agrees with marker Events', () => {
    for (let i = 1; i < p.moves.n; i++) expect(p.moves.tStart[i] >= p.moves.tStart[i - 1]).toBe(true)
    for (const e of p.events) {
      if (e.moveIndex < p.moves.n) expect(firstMoveAtOrAfterLine(p, e.line)).toBe(e.moveIndex)
    }
  })

  it('steps through the markers in order', () => {
    const idx = markerIndices(p.events)
    expect(idx.length).toBeGreaterThan(2)
    expect(nextMarker(p.events, -1)?.moveIndex).toBe(idx[0])
    expect(nextMarker(p.events, idx[0])?.moveIndex).toBe(idx[1])
    expect(prevMarker(p.events, idx[1])?.moveIndex).toBe(idx[0])
    const pause = p.events.find((e) => e.kind === 'pause')!
    expect(idx).toContain(pause.moveIndex)
  })
})
