import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/demo-v1/combined_output.gcode?raw'
import { markerIndices, nextMarker, prevMarker } from '../gcode/lookup'
import { parseGcode } from '../gcode/parser'
import { layoutMarkers, placingSelection, seekIndex } from './eventMarkerLogic'

const parse = parseGcode(fixture)
const n = parse.moves.n
const groups = layoutMarkers(parse.events, n)
const items = groups.flatMap((g) => g.items)
// Part types of web/fixtures/demo-v1/spec.json.
const parts = [{ type: 'trace_cloth' }, { type: 'trace_cloth' }, { type: 'pcb' }] as const

describe('layoutMarkers on the fixture', () => {
  it('has one marker per Assembly_Marker and PAUSE Event (25)', () => {
    expect(items).toHaveLength(25)
  })

  it('groups by moveIndex in increasing order, positions in [0, 1]', () => {
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      expect(g.items.every((m) => seekIndex(m.event, n) === g.moveIndex)).toBe(true)
      expect(g.pos).toBeCloseTo(g.moveIndex / (n - 1), 12)
      expect(g.pos).toBeGreaterThanOrEqual(0)
      expect(g.pos).toBeLessThanOrEqual(1)
      if (i > 0) expect(g.moveIndex).toBeGreaterThan(groups[i - 1].moveIndex)
    }
    expect(groups.length).toBe(markerIndices(parse.events).length)
  })

  it('labels markers', () => {
    const labels = items.map((m) => m.label)
    expect(labels[0]).toBe('PAUSE')
    expect(labels).toContain('Layer 11 Placement')
    expect(labels).toContain('Layer 12 Placement')
    expect(labels).toContain('Placing PCB #3')
    expect(labels.filter((l) => l === 'Tamp ×2')).toHaveLength(2)
    expect(labels).toContain('Pick')
    expect(labels).toContain('Wipe')
    expect(items.filter((m) => m.flag).map((m) => m.event.kind).sort()).toEqual(
      ['pause', 'placement_group', 'placement_group', 'placing', 'placing', 'placing'],
    )
  })
})

describe('placingSelection', () => {
  it('selects part number - 1 by its type', () => {
    const sel = items.filter((m) => m.event.kind === 'placing').map((m) => placingSelection(m.event, parts))
    expect(sel).toEqual([
      { kind: 'partMesh', partIndex: 2 },
      { kind: 'trace', partIndex: 0 },
      { kind: 'trace', partIndex: 1 },
    ])
  })

  it('is null for other kinds and for a missing part', () => {
    const pause = items[0].event
    expect(placingSelection(pause, parts)).toBeNull()
    const pcb = items.find((m) => m.label === 'Placing PCB #3')!.event
    expect(placingSelection(pcb, parts.slice(0, 2))).toBeNull()
  })
})

describe('prev / next event over the fixture markers', () => {
  it('walks every marker index forward and back', () => {
    const idx = markerIndices(parse.events)
    let p = -1
    const fwd: number[] = []
    for (let k = nextMarker(idx, p); k !== null; k = nextMarker(idx, p)) fwd.push((p = k))
    expect(fwd).toEqual(idx)
    expect(prevMarker(idx, idx[0])).toBeNull()
    const last = idx[idx.length - 1]
    expect(prevMarker(idx, last + 1)).toBe(last)
    expect(nextMarker(idx, last)).toBeNull()
  })
})
