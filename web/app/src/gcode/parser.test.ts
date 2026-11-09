import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/demo-v1/combined_output.gcode?raw'
import { splitLines } from './lexer'
import { parseGcode } from './parser'
import { MOVE_TYPES, getMove, type MoveType, type ParseResult } from './types'

const fixtureLines = splitLines(fixture)
const parsed = parseGcode(fixture)

function movesOnLine(r: ParseResult, line: number): number[] {
  const out: number[] = []
  for (let i = 0; i < r.moves.n; i++) if (r.moves.line[i] === line) out.push(i)
  return out
}
function typeOf(r: ParseResult, i: number): MoveType {
  return MOVE_TYPES[r.moves.type[i]]
}
/** 1-based line numbers whose trimmed text equals `text`. */
function linesWith(text: string): number[] {
  const out: number[] = []
  fixtureLines.forEach((l, i) => { if (l.trim() === text) out.push(i + 1) })
  return out
}

describe('parseGcode on the Fixture (smoke)', () => {
  it('has the segments, pause and layer facts', () => {
    expect(parsed.stats.lines).toBe(10176)
    expect(parsed.segments).toHaveLength(2)
    const pause = parsed.events.filter((e) => e.kind === 'pause')
    expect(pause.map((e) => e.line)).toEqual([3817])
    const [s1, s2] = parsed.segments
    expect(s1.extrudeZMin).toBeCloseTo(0.2, 9)
    expect(s1.extrudeZMax).toBeCloseTo(1.4, 9)
    expect(s1.layerCount).toBe(7)
    expect(s2.layerCount).toBe(25)
    expect(s1.lastLine).toBe(3817)
    expect(s2.firstLine).toBe(3818)
    expect(s2.firstMove).toBe(s1.lastMove + 1)
    expect(s2.lastMove).toBe(parsed.moves.n - 1)
  })

  it('finds the placement groups and parts', () => {
    const ev = parsed.events
    const g11 = ev.findIndex((e) => e.kind === 'placement_group' && e.line === 6574)
    expect(ev[g11].data).toEqual({ kind: 'placement_group', layer: 11, variant: 'layer' })
    const p3 = ev.slice(g11).find((e) => e.kind === 'placing')!
    expect(p3.line).toBe(6576)
    expect(p3.label).toBe('Placing PCB #3')
    expect(p3.data).toEqual({ kind: 'placing', partKind: 'PCB', number: 3 })

    const g12 = ev.find((e) => e.kind === 'placement_group' && e.line === 6854)!
    expect(g12.data).toEqual({ kind: 'placement_group', layer: 12, variant: 'layer' })
    const placing = ev.filter((e) => e.kind === 'placing' && e.line > 6854)
    expect(placing.slice(0, 2).map((e) => [e.line, e.label])).toEqual([
      [6856, 'Placing TRACE_CLOTH #1'], [6903, 'Placing TRACE_CLOTH #2'],
    ])
    // The group's Moves are on layer 11 (the same number as pause_layer).
    const first = movesOnLine(parsed, 6578)[0]
    expect(parsed.moves.layer[first]).toBe(11)
    expect(parsed.moves.segment[first]).toBe(2)
  })

  it('counts arcs, helical lifts and the timestamp line', () => {
    expect(parsed.stats.arcs).toBe(160)
    expect(parsed.stats.helicalLifts).toBe(32)
    expect(parsed.stats.timestampLine).toBe(2)
  })

  it('gives every Event a moveIndex of the first Move after it', () => {
    for (const e of parsed.events) {
      expect(e.moveIndex).toBeGreaterThanOrEqual(0)
      expect(e.moveIndex).toBeLessThanOrEqual(parsed.moves.n)
      if (e.moveIndex < parsed.moves.n) expect(parsed.moves.line[e.moveIndex]).toBeGreaterThan(e.line)
    }
  })

  it('types the pick, place, tamp and prinjection moves', () => {
    const pickSeq = parsed.events.find((e) => e.kind === 'pick_seq' && e.line > 6574)!
    const m = getMove(parsed.moves, pickSeq.moveIndex)
    expect(m.type).toBe('pick')
    expect(m.to.x).toBeCloseTo(35.472143, 6)
    expect(m.to.y).toBeCloseTo(7.982469, 6)
    expect(fixtureLines[m.line - 1].startsWith('G1 X35.472143 Y7.982469')).toBe(true)

    const placeSeq = parsed.events.find((e) => e.kind === 'place_seq' && e.line > 6574)!
    expect(typeOf(parsed, placeSeq.moveIndex)).toBe('place')

    const tamps = parsed.events.filter((e) => e.kind === 'tamping')
    expect(tamps.length).toBeGreaterThan(0)
    for (const t of tamps) expect(typeOf(parsed, t.moveIndex)).toBe('tamp')

    // Prinjection: the wipe right after the marker returns to Prinjection, so the hole moves follow.
    const hole = movesOnLine(parsed, linesWith('G1 X9.023757 Y37.79925 F6000')[0])
    expect(hole.map((i) => typeOf(parsed, i))).toEqual(['prinjection'])
  })

  it('types wipes and returns to travel after a group final wipe', () => {
    const wipes = parsed.events.filter((e) => e.kind === 'wipe')
    expect(wipes.length).toBeGreaterThan(0)
    for (const w of wipes) {
      // From the marker to the closing `G1 Z13`, every Move is a wipe near X220..250 Y15.
      let i = w.moveIndex
      for (; ; i++) {
        const m = getMove(parsed.moves, i)
        expect(m.type).toBe('wipe')
        expect(m.to.x).toBeGreaterThanOrEqual(220)
        expect(m.to.x).toBeLessThanOrEqual(250)
        expect(m.to.y).toBe(15)
        if (fixtureLines[m.line - 1].trim() === 'G1 Z13 F24000' && i > w.moveIndex) break
      }
      expect(typeOf(parsed, i + 1)).not.toBe('wipe')
    }
    const returns = linesWith('G1 X250.0 Y15.0 Z23.0 F6000')
    expect(returns.length).toBeGreaterThan(0)
    for (const l of returns) expect(movesOnLine(parsed, l).map((i) => typeOf(parsed, i))).toEqual(['travel'])
  })

  it('treats G28 Z I140 J140 as homing, not an arc', () => {
    const l = linesWith('G28 Z I140 J140')[0]
    expect(movesOnLine(parsed, l)).toEqual([])
    expect(parsed.unhandled).not.toContain(l)
  })

  it('types ;WIPE_START negative-E XY moves as travel', () => {
    const starts = linesWith(';WIPE_START')
    expect(starts.length).toBeGreaterThan(0)
    let checked = 0
    for (const s of starts) {
      // Every Move between ;WIPE_START and ;WIPE_END is a retracting XY move.
      for (let l = s + 1; fixtureLines[l - 1].trim() !== ';WIPE_END'; l++) {
        for (const i of movesOnLine(parsed, l)) {
          const m = getMove(parsed.moves, i)
          if (m.e < 0 && Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > 1e-6) {
            expect(m.type).toBe('travel')
            checked++
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(starts.length / 2)
  })

  it('types every piece of a helical lift as z_hop', () => {
    const l = linesWith('G3 Z2.6 I1.03 J.648 P1  F30000')[0]
    const pieces = movesOnLine(parsed, l)
    expect(pieces.length).toBeGreaterThan(1)
    for (const i of pieces) {
      expect(typeOf(parsed, i)).toBe('z_hop')
      expect(parsed.moves.arc[i]).toBe(1)
    }
  })

  it('parses the Fixture in under 300 ms', () => {
    parseGcode(fixture) // warm-up
    const t0 = performance.now()
    parseGcode(fixture)
    expect(performance.now() - t0).toBeLessThan(300)
  })
})

describe('parseGcode unit cases', () => {
  const head = 'G90\nM83\nG92 X0 Y0 Z0\n'

  it('G91 makes XYZ relative', () => {
    const r = parseGcode(`${head}G1 X10 Y0 Z1\nG91\nG1 X5 Y2\nG1 Z-0.5\n`)
    expect(r.moves.n).toBe(3)
    const b = getMove(r.moves, 1)
    expect(b.from).toEqual({ x: 10, y: 0, z: 1 })
    expect(b.to).toEqual({ x: 15, y: 2, z: 1 })
    expect(getMove(r.moves, 2).to).toEqual({ x: 15, y: 2, z: 0.5 })
  })

  it('M82 makes E absolute and G92 E0 resets it', () => {
    const r = parseGcode('G92 X0 Y0 Z0.2\nM82\nG1 X10 E1\nG1 X20 E3\nG92 E0\nG1 X30 E0.5\n')
    expect(Array.from(r.moves.e)).toEqual([1, 2, 0.5])
    expect(MOVE_TYPES[r.moves.type[0]]).toBe('extrude')
  })

  it('an E-only line creates no Move but adds time', () => {
    const r = parseGcode(`${head}G1 E10 F600\nG1 X6 F6000\n`)
    expect(r.moves.n).toBe(1)
    expect(r.moves.tStart[0]).toBeCloseTo(1, 9) // 10 mm at 10 mm/s
    expect(r.moves.duration[0]).toBeCloseTo(0.06, 6)
  })

  it('an unknown line goes to unhandled and parsing continues', () => {
    const r = parseGcode(`${head}FOO_BAR_MACRO X=1\n@@@\nG18\nG1 X1\n`)
    expect(r.unhandled).toEqual([4, 5, 6])
    expect(r.moves.n).toBe(1)
  })

  it('does not draw before the position is known', () => {
    const r = parseGcode('G28\nG1 X5 Y5\nG1 Z1\nG1 X10\n')
    expect(r.moves.n).toBe(3)
    const a = getMove(r.moves, 0)
    expect(a.from).toEqual(a.to)
    const b = getMove(r.moves, 1)
    expect(b.from).toEqual(b.to)
    expect(getMove(r.moves, 2).from).toEqual({ x: 5, y: 5, z: 1 })
  })

  it('emits temperature, fan (P0 only) and dwell Events and tracks', () => {
    const r = parseGcode(`${head}M104 T0 S140\nM104 S100 T1\nM106 P2 S255\nM106 S127.5\nM107\nG4 P500\nTEMPERATURE_WAIT SENSOR=extruder MAXIMUM=102\nG1 X1\n`)
    const kinds = r.events.map((e) => e.kind)
    expect(kinds).toEqual(['temperature', 'temperature', 'fan', 'fan', 'dwell', 'temperature_wait'])
    expect(r.events[5].data).toEqual({ kind: 'temperature_wait', sensor: 'extruder', max: 102 })
    expect(Array.from(r.tempTrack.value)).toEqual([140])
    expect(Array.from(r.fanTrack.value)).toEqual([0.5, 0])
    expect(r.moves.tStart[0]).toBeCloseTo(0.5, 9)
  })

  it('PAUSE starts a new Segment with its own layers', () => {
    const r = parseGcode(`${head};LAYER_CHANGE\nG1 X1 E1\nPAUSE\nG1 X2\n;LAYER_CHANGE\n;LAYER_CHANGE\nG1 X3 E1\n`)
    expect(r.segments.map((s) => s.layerCount)).toEqual([1, 2])
    expect(Array.from(r.moves.segment)).toEqual([1, 2, 2])
    expect(Array.from(r.moves.layer)).toEqual([1, 0, 2])
  })
})

describe('parseGcode on other slicers and firmwares', () => {
  const ends = (r: ParseResult) => Array.from({ length: r.moves.n }, (_, i) => getMove(r.moves, i).to)

  it('strips N line numbers and *checksums', () => {
    const r = parseGcode('N1 G28*18\nN2 G1 X10 Y20 Z1 F600*85\nN3 G1 X15 E1*99 ; note\n')
    expect(r.unhandled).toEqual([])
    expect(ends(r).at(-1)).toEqual({ x: 15, y: 20, z: 1 })
  })

  it('converts G20 inches to mm and back with G21', () => {
    const r = parseGcode('G90\nG92 X0 Y0 Z0\nG20\nG1 X1 Y2 Z0.1\nG21\nG1 X30\n')
    const [a, b] = ends(r)
    expect(a.x).toBeCloseTo(25.4)
    expect(a.y).toBeCloseTo(50.8)
    expect(a.z).toBeCloseTo(2.54)
    expect(b.x).toBe(30)
  })

  it('makes E relative inside G91 even under M82', () => {
    const r = parseGcode('M82\nG92 X0 Y0 Z0 E0\nG1 X1 E5\nG91\nG1 X1 E1\nG90\nG1 X3 E7\n')
    expect(Array.from(r.moves.e)).toEqual([5, 1, 1])
  })

  it('recognises G10/G11 firmware retract without a Move', () => {
    const r = parseGcode('G92 X0 Y0 Z0\nG10\nG1 X5\nG11\n')
    expect(r.unhandled).toEqual([])
    expect(r.moves.n).toBe(1)
  })

  it('counts Cura ;LAYER: as a layer change, not ;LAYER_COUNT:', () => {
    const r = parseGcode(';LAYER_COUNT:2\n;LAYER:0\nG92 X0 Y0 Z0\nG1 X1 E1\n;LAYER:1\nG1 X2 E1\n')
    expect(r.segments[0].layerCount).toBe(2)
  })

  it('does not double-count when ;LAYER_CHANGE and ;LAYER: both appear', () => {
    const r = parseGcode(';LAYER_CHANGE\n;LAYER:0\nG92 X0 Y0 Z0\nG1 X1 E1\n;LAYER_CHANGE\n;LAYER:1\nG1 X2 E1\n')
    expect(r.segments[0].layerCount).toBe(2)
  })

  it('makes M600, M0 and M1 pause Events without a new Segment', () => {
    const r = parseGcode('G92 X0 Y0 Z0\nG1 X1\nM600\nG1 X2\nM0\nM1\nG1 X3\nM601\nG1 X4\n')
    expect(r.events.filter((e) => e.kind === 'pause').map((e) => e.line)).toEqual([3, 5, 6, 8])
    expect(r.segments).toHaveLength(2)
    expect(r.unhandled).toEqual([])
  })

  it('recognises Klipper SET_FAN_SPEED and common Marlin/Prusa commands', () => {
    const r = parseGcode('SET_FAN_SPEED FAN=nevermore SPEED=0.5\nM84\nM117 Hello\nM862.3 P "MK4"\nM900 K0.05\nG29\n')
    expect(r.unhandled).toEqual([])
  })
})
