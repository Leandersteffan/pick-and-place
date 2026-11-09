// Fixture parse summary golden test (Requirements 5.5, 5.11).
//
// The pinned file is web/fixtures/demo-v1/expected/parse-summary.json. It is not
// listed in the Fixture manifest: the demo loader only fetches listed files and the
// importer test reads an explicit file list, so expected/ stays out of their view.
//
// Regenerate (only after reviewing a parser change) by running vitest with
// WRITE_GOLDEN=1, for example from web/app:
//   set WRITE_GOLDEN=1 && npx vitest --run src/gcode/fixtureSummary.test.ts
// Then review the diff of parse-summary.json before keeping it.
import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/demo-v1/combined_output.gcode?raw'
import { timelineMarkers } from './lookup'
import { parseGcode } from './parser'
import { MOVE_TYPES, type GcodeEvent, type MoveType, type ParseResult } from './types'

const GOLDEN_URL = new URL('../../../fixtures/demo-v1/expected/parse-summary.json', import.meta.url)
// Eager glob gives {} when the file does not exist yet, so generation can run first.
const goldenModules = import.meta.glob('../../../fixtures/demo-v1/expected/parse-summary.json', {
  eager: true,
  import: 'default',
})
const golden = Object.values(goldenModules)[0] as ParseSummary | undefined

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
const WRITE_GOLDEN = env.WRITE_GOLDEN === '1'

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d

interface ParseSummary {
  lines: number
  moves: number
  segments: {
    index: number; firstLine: number; lastLine: number; firstMove: number; lastMove: number
    moveCount: number; extrudeZMin: number; extrudeZMax: number; layerCount: number
  }[]
  eventCounts: Record<string, number>
  markers: { kind: string; line: number; label: string }[]
  stats: ParseResult['stats']
  unhandled: { count: number; first: number[] }
  moveCounts: Record<MoveType, number>
  totalTime: number
}

function summarize(r: ParseResult): ParseSummary {
  const eventCounts: Record<string, number> = {}
  for (const e of [...r.events].sort((a, b) => a.kind.localeCompare(b.kind))) {
    eventCounts[e.kind] = (eventCounts[e.kind] ?? 0) + 1
  }
  const moveCounts = Object.fromEntries(MOVE_TYPES.map((t) => [t, 0])) as Record<MoveType, number>
  for (let i = 0; i < r.moves.n; i++) moveCounts[MOVE_TYPES[r.moves.type[i]]]++
  return {
    lines: r.stats.lines,
    moves: r.moves.n,
    segments: r.segments.map((s) => ({
      index: s.index,
      firstLine: s.firstLine,
      lastLine: s.lastLine,
      firstMove: s.firstMove,
      lastMove: s.lastMove,
      moveCount: s.lastMove - s.firstMove + 1,
      extrudeZMin: round(s.extrudeZMin, 4),
      extrudeZMax: round(s.extrudeZMax, 4),
      layerCount: s.layerCount,
    })),
    eventCounts,
    markers: timelineMarkers(r.events).map((e) => ({ kind: e.kind, line: e.line, label: e.label })),
    stats: { ...r.stats },
    unhandled: { count: r.unhandled.length, first: r.unhandled.slice(0, 10) },
    moveCounts,
    totalTime: Math.round(r.totalTime),
  }
}

const parsed = parseGcode(fixture)
const summary = summarize(parsed)

/** Placing Events after the group at `line`, up to the next placement_group. */
function placingAfter(events: GcodeEvent[], line: number): string[] {
  const out: string[] = []
  const sorted = [...events].sort((a, b) => a.line - b.line)
  for (const e of sorted) {
    if (e.line <= line) continue
    if (e.kind === 'placement_group') break
    if (e.kind === 'placing') out.push(e.label)
  }
  return out
}

describe('Fixture parse summary (golden)', () => {
  it.runIf(WRITE_GOLDEN)('writes expected/parse-summary.json', async () => {
    // src/io/node-fs.d.ts only types readFileSync; the app has no @types/node.
    const { mkdirSync, writeFileSync } = (await import('node:fs')) as unknown as {
      mkdirSync(path: URL, opts: { recursive: boolean }): void
      writeFileSync(path: URL, data: string): void
    }
    mkdirSync(new URL('.', GOLDEN_URL), { recursive: true })
    writeFileSync(GOLDEN_URL, JSON.stringify(summary, null, 2) + '\n')
  })

  it.skipIf(WRITE_GOLDEN)('matches the pinned summary exactly', () => {
    expect(golden, 'expected/parse-summary.json is missing; run with WRITE_GOLDEN=1').toBeDefined()
    expect(summary).toEqual(golden)
  })

  it('has the design facts', () => {
    expect(parsed.stats.lines).toBe(10176)
    expect(parsed.segments).toHaveLength(2)
    const [s1, s2] = parsed.segments
    expect(s1.extrudeZMin).toBeCloseTo(0.2, 9)
    expect(s1.extrudeZMax).toBeCloseTo(1.4, 9)
    expect(s1.layerCount).toBe(7)
    expect(s2.layerCount).toBe(25)

    expect(parsed.events.filter((e) => e.kind === 'pause').map((e) => e.line)).toEqual([3817])

    const groups = parsed.events.filter((e) => e.kind === 'placement_group')
    expect(groups.map((e) => e.line)).toEqual([6574, 6854])
    expect(groups.map((e) => e.data)).toEqual([
      { kind: 'placement_group', layer: 11, variant: 'layer' },
      { kind: 'placement_group', layer: 12, variant: 'layer' },
    ])
    // The group's Moves carry the same layer number as pause_layer.
    expect(groups.map((e) => parsed.moves.layer[e.moveIndex])).toEqual([11, 12])
    expect(placingAfter(parsed.events, 6574)).toEqual(['Placing PCB #3'])
    expect(placingAfter(parsed.events, 6854)).toEqual(['Placing TRACE_CLOTH #1', 'Placing TRACE_CLOTH #2'])

    expect(parsed.stats.arcs).toBe(160)
    expect(parsed.stats.helicalLifts).toBe(32)
    expect(parsed.stats.timestampLine).toBe(2)
  })

  it.skipIf(WRITE_GOLDEN)('has the pinned unhandled count', () => {
    expect(parsed.unhandled.length).toBe(golden?.unhandled.count)
  })
})
