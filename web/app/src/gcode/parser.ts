// Gcode_Parser entry point (design section 5). Pure: no DOM, no three.js.
//
// parseGcode turns the text of a gcode file into a MoveTable, Events, Segments,
// step tracks and stats. It never throws on unknown input: lines it does not
// understand go to `unhandled` and parsing continues (Requirement 5.12).

import { ARC_MAX_DEVIATION, splitExtrusion, tessellateArc } from './arcs'
import { ContextMachine, type AxisWords, type RawMove } from './classify'
import { lexLine, splitLines, type MacroToken, type WordToken } from './lexer'
import { isRecognisedMacro, isRecognisedNoopCommand, matchMarker, type MarkerMatch } from './markers'
import { MoveTableBuilder } from './moveTable'
import { DEFAULT_FEEDRATE, TemperatureClock, dwellMs, eOnlySeconds, travelSeconds } from './timing'
import { fanTrack, tempTrack } from './tracks'
import { MOVE_TYPES, type GcodeEvent, type MoveType, type ParseResult, type Segment } from './types'

export { DEFAULT_FEEDRATE } from './timing'

export interface ParseOptions {
  /** Maximum chord deviation for arc tessellation, mm. Default 0.05. */
  maxChordDeviation?: number
}

const TYPE_CODE: Record<MoveType, number> = Object.fromEntries(MOVE_TYPES.map((t, i) => [t, i])) as Record<MoveType, number>

/** Comment markers that become Timeline Events. */
function markerEvent(m: MarkerMatch, line: number, moveIndex: number): GcodeEvent | null {
  switch (m.kind) {
    case 'placement_group':
      return { kind: m.kind, line, moveIndex, label: m.label, data: { kind: m.kind, layer: m.layer, variant: m.variant } }
    case 'placing':
      return { kind: m.kind, line, moveIndex, label: m.label, data: { kind: m.kind, partKind: m.partKind, number: m.number } }
    case 'pnp_header':
      return { kind: m.kind, line, moveIndex, label: m.label, data: { kind: m.kind, partKind: m.partKind } }
    case 'tamping':
      return { kind: m.kind, line, moveIndex, label: m.label, data: { kind: m.kind, count: m.count } }
    case 'pick_seq': case 'place_seq': case 'prinjection': case 'wipe': case 'unknown_marker':
      return { kind: m.kind, line, moveIndex, label: m.label, data: { kind: 'none' } }
    case 'skipped_extrusion':
      return { kind: m.kind, line, moveIndex, label: m.label, data: { kind: m.kind, e: m.e, minTemp: m.minTemp } }
    default:
      return null
  }
}

interface OpenSegment {
  index: number; firstMove: number; firstLine: number
  zMin: number; zMax: number; layerCount: number; clockStart: number
}

/**
 * Parses gcode text.
 *
 * Stats: `arcs` counts extruding arc commands (G2/G3 source lines with E > 0), not
 * tessellated pieces; `helicalLifts` counts G2/G3 lines without X/Y words.
 */
export function parseGcode(text: string, opts: ParseOptions = {}): ParseResult {
  const maxDev = opts.maxChordDeviation ?? ARC_MAX_DEVIATION
  const lines = splitLines(text)
  const moves = new MoveTableBuilder(lines.length + 1024)
  const events: GcodeEvent[] = []
  const unhandled: number[] = []
  const segments: Segment[] = []
  const ctx = new ContextMachine()
  const temps = new TemperatureClock()

  // Machine state. NaN means unknown (before the first full move, after G28).
  let px = NaN, py = NaN, pz = NaN
  let eAbs = 0
  let absXYZ = true
  let absE = true
  /** mm per input unit: 1 after G21 (default), 25.4 after G20 (inches). */
  let unit = 1
  /** A `;LAYER_CHANGE` was seen; Cura's `;LAYER:n` then does not count a second time. */
  let sawLayerChange = false
  let feed = NaN
  let clock = 0
  let layer = 0
  let arcs = 0
  let helicalLifts = 0
  let timestampLine: number | null = null

  let seg: OpenSegment = { index: 1, firstMove: 0, firstLine: 1, zMin: Infinity, zMax: -Infinity, layerCount: 0, clockStart: 0 }
  const closeSegment = (lastLine: number): void => {
    segments.push({
      index: seg.index,
      firstMove: seg.firstMove,
      lastMove: moves.n - 1,
      firstLine: seg.firstLine,
      lastLine,
      extrudeZMin: seg.zMin === Infinity ? NaN : seg.zMin,
      extrudeZMax: seg.zMax === -Infinity ? NaN : seg.zMax,
      layerCount: seg.layerCount,
      duration: clock - seg.clockStart,
    })
  }

  const pushPiece = (
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    e: number, type: MoveType, line: number, arc: boolean, duration: number,
  ): void => {
    moves.push({
      x0, y0, z0, x1, y1, z1, e, f: feed > 0 ? feed : DEFAULT_FEEDRATE,
      type: TYPE_CODE[type], segment: seg.index, layer, line, tStart: clock, duration, arc,
    })
    clock += duration
    if (type === 'extrude') {
      const lo = z0 < z1 ? z0 : z1
      const hi = z0 < z1 ? z1 : z0
      if (lo < seg.zMin) seg.zMin = lo
      if (hi > seg.zMax) seg.zMax = hi
    }
  }

  /** Converts length words (X Y Z E I J R F) from inches to mm after G20. */
  const toMm = (words: Record<string, number>): Record<string, number> => {
    if (unit === 1) return words
    const out: Record<string, number> = { ...words }
    for (const k of ['X', 'Y', 'Z', 'E', 'I', 'J', 'R', 'F']) if (out[k] !== undefined) out[k] *= unit
    return out
  }

  const moveCommand = (t: WordToken): void => {
    const w = toMm(t.words)
    if (w.F !== undefined) feed = w.F
    const hasX = w.X !== undefined, hasY = w.Y !== undefined, hasZ = w.Z !== undefined, hasE = w.E !== undefined
    const isArc = t.number === 2 || t.number === 3
    if (!hasX && !hasY && !hasZ && !hasE && !isArc) return // feedrate only

    let eDelta = 0
    if (hasE) {
      // Klipper and Marlin: E is absolute only under both G90 and M82.
      const eAbsolute = absE && absXYZ
      eDelta = eAbsolute ? w.E - eAbs : w.E
      eAbs = eAbsolute ? w.E : eAbs + w.E
    }
    if (!hasX && !hasY && !hasZ && !isArc) {
      // E-only: no Move, the time still counts.
      clock += eOnlySeconds(eDelta, feed)
      return
    }

    const tx = hasX ? (absXYZ ? w.X : px + w.X) : px
    const ty = hasY ? (absXYZ ? w.Y : py + w.Y) : py
    const tz = hasZ ? (absXYZ ? w.Z : pz + w.Z) : pz
    const words: AxisWords = { x: hasX, y: hasY, z: hasZ, e: hasE }
    const known = Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz) &&
      Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tz)

    if (isArc) {
      if (eDelta > 0) arcs++
      if (!hasX && !hasY) helicalLifts++
    }

    if (!known) {
      // Not drawn (from = to), time over the axes known at both ends still counts.
      const dx = Number.isFinite(px) && Number.isFinite(tx) ? tx - px : 0
      const dy = Number.isFinite(py) && Number.isFinite(ty) ? ty - py : 0
      const dz = Number.isFinite(pz) && Number.isFinite(tz) ? tz - pz : 0
      const rx = Number.isFinite(tx) ? tx : 0, ry = Number.isFinite(ty) ? ty : 0, rz = Number.isFinite(tz) ? tz : 0
      const raw: RawMove = { x0: rx, y0: ry, z0: rz, x1: rx, y1: ry, z1: rz, e: eDelta, arc: isArc, helical: false, xyWords: hasX || hasY }
      const type = ctx.classifyMove(raw)
      pushPiece(rx, ry, rz, rx, ry, rz, eDelta, type, t.line, isArc, travelSeconds(Math.hypot(dx, dy, dz), feed))
      ctx.afterMove(words)
      px = tx; py = ty; pz = tz
      return
    }

    if (isArc && (w.I !== undefined || w.J !== undefined)) {
      const start = { x: px, y: py, z: pz }
      const end = hasX || hasY ? { x: tx, y: ty, z: tz } : null
      const turns = w.P !== undefined ? w.P : 1
      const pts = tessellateArc(start, end, tz, w.I ?? 0, w.J ?? 0, t.number === 2, turns, maxDev)
      const shares = splitExtrusion(start, pts, eDelta)
      const raw: RawMove = {
        x0: px, y0: py, z0: pz, x1: tx, y1: ty, z1: tz, e: eDelta, arc: true, helical: !hasX && !hasY && !hasE,
        xyWords: hasX || hasY,
      }
      const type = ctx.classifyMove(raw)
      let ax = px, ay = py, az = pz
      for (let k = 0; k < pts.length; k++) {
        const q = pts[k]
        pushPiece(ax, ay, az, q.x, q.y, q.z, shares[k], type, t.line, true,
          travelSeconds(Math.hypot(q.x - ax, q.y - ay, q.z - az), feed))
        ax = q.x; ay = q.y; az = q.z
      }
      ctx.afterMove(words)
      px = tx; py = ty; pz = tz
      return
    }

    if (isArc) unhandled.push(t.line) // R-form or centre-less arc: drawn as a straight line
    const raw: RawMove = { x0: px, y0: py, z0: pz, x1: tx, y1: ty, z1: tz, e: eDelta, arc: false, helical: false, xyWords: hasX || hasY }
    const type = ctx.classifyMove(raw)
    pushPiece(px, py, pz, tx, ty, tz, eDelta, type, t.line, false,
      travelSeconds(Math.hypot(tx - px, ty - py, tz - pz), feed))
    ctx.afterMove(words)
    px = tx; py = ty; pz = tz
  }

  const wordCommand = (t: WordToken): void => {
    const w = t.words
    switch (t.code) {
      case 'G0': case 'G1': case 'G2': case 'G3':
        moveCommand(t)
        return
      case 'G4': {
        const ms = dwellMs(w)
        events.push({ kind: 'dwell', line: t.line, moveIndex: moves.n, label: `Dwell ${ms} ms`, data: { kind: 'dwell', ms } })
        clock += ms / 1000
        return
      }
      case 'G17':
        return
      case 'G20': unit = 25.4; return
      case 'G21': unit = 1; return
      case 'M0': case 'M1': case 'M600': {
        // Pause-like stops: a Timeline Event, but no new Segment (only PAUSE and M601 split).
        const label = t.code === 'M600' ? 'M600 filament change' : `${t.code} stop`
        events.push({ kind: 'pause', line: t.line, moveIndex: moves.n, label, data: { kind: 'none' } })
        return
      }
      case 'G28': {
        const axes = new Set<string>()
        for (const f of t.flags) if (f === 'X' || f === 'Y' || f === 'Z') axes.add(f)
        for (const k of ['X', 'Y', 'Z']) if (w[k] !== undefined) axes.add(k)
        const all = axes.size === 0
        if (all || axes.has('X')) px = NaN
        if (all || axes.has('Y')) py = NaN
        if (all || axes.has('Z')) pz = NaN
        return
      }
      case 'G90': absXYZ = true; return
      case 'G91': absXYZ = false; return
      case 'M82': absE = true; return
      case 'M83': absE = false; return
      case 'G92': {
        const w = toMm(t.words)
        const none = w.X === undefined && w.Y === undefined && w.Z === undefined && w.E === undefined
        if (none) { px = 0; py = 0; pz = 0; eAbs = 0; return }
        if (w.X !== undefined) px = w.X
        if (w.Y !== undefined) py = w.Y
        if (w.Z !== undefined) pz = w.Z
        if (w.E !== undefined) eAbs = w.E
        return
      }
      case 'M104': case 'M109': {
        const target = w.S !== undefined ? w.S : w.R
        if (target === undefined) { unhandled.push(t.line); return }
        const tool = w.T !== undefined ? w.T : 0
        const wait = t.code === 'M109'
        events.push({
          kind: 'temperature', line: t.line, moveIndex: moves.n,
          label: `${wait ? 'Heat and wait' : 'Set'} T${tool} ${target} °C`,
          data: { kind: 'temperature', tool, target, wait },
        })
        if (tool === 0) {
          if (wait) clock += temps.heatAndWait(target)
          else temps.setTarget(target)
        }
        return
      }
      case 'M106': case 'M107': {
        if (w.P !== undefined && w.P !== 0) return // aux fan, recognised and ignored
        const raw = t.code === 'M107' ? 0 : w.S !== undefined ? w.S / 255 : 1
        const value = Math.min(1, Math.max(0, raw))
        events.push({
          kind: 'fan', line: t.line, moveIndex: moves.n, label: `Fan ${Math.round(value * 100)}%`,
          data: { kind: 'fan', fan: 0, value },
        })
        return
      }
      default:
        if (!isRecognisedNoopCommand(t.code)) unhandled.push(t.line)
    }
  }

  const macroCommand = (t: MacroToken): void => {
    if (t.name === 'TEMPERATURE_WAIT') {
      const sensor = t.params.SENSOR ?? t.params.sensor ?? ''
      const minS = t.params.MINIMUM ?? t.params.minimum
      const maxS = t.params.MAXIMUM ?? t.params.maximum
      const data: { kind: 'temperature_wait'; sensor: string; min?: number; max?: number } = { kind: 'temperature_wait', sensor }
      if (minS !== undefined && Number.isFinite(Number(minS))) data.min = Number(minS)
      if (maxS !== undefined && Number.isFinite(Number(maxS))) data.max = Number(maxS)
      const bounds = [data.min !== undefined ? `≥ ${data.min}` : '', data.max !== undefined ? `≤ ${data.max}` : '']
        .filter((s) => s).join(' ')
      events.push({ kind: 'temperature_wait', line: t.line, moveIndex: moves.n, label: `Wait ${sensor} ${bounds}`.trim(), data })
      // Only the T0 nozzle (Klipper sensor `extruder`) is tracked; other sensors add no time.
      if (sensor === '' || sensor.toLowerCase() === 'extruder') clock += temps.temperatureWait(data.min, data.max)
      return
    }
    if (!isRecognisedMacro(t.name)) unhandled.push(t.line)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = i + 1
    const tok = lexLine(lines[i], line)
    switch (tok.kind) {
      case 'blank':
        break
      case 'word':
        wordCommand(tok)
        break
      case 'macro':
        macroCommand(tok)
        break
      case 'pause':
        events.push({ kind: 'pause', line, moveIndex: moves.n, label: 'PAUSE', data: { kind: 'none' } })
        ctx.onPause()
        closeSegment(line)
        seg = {
          index: seg.index + 1, firstMove: moves.n, firstLine: line + 1,
          zMin: Infinity, zMax: -Infinity, layerCount: 0, clockStart: clock,
        }
        layer = 0
        break
      case 'comment': {
        const m = matchMarker(tok.text)
        if (m === null) break
        if (m.kind === 'boundary') {
          ctx.onBoundary()
          if (m.boundary === 'layer_change') sawLayerChange = true
          if (m.boundary === 'layer_change' || (m.boundary === 'cura_layer' && !sawLayerChange)) {
            layer++
            seg.layerCount++
          }
          break
        }
        if (m.kind === 'stamp') {
          if (timestampLine === null) timestampLine = line
          break
        }
        const ev = markerEvent(m, line, moves.n)
        if (ev !== null) events.push(ev)
        ctx.onMarker(m)
        break
      }
      case 'unknown':
        unhandled.push(line)
        break
    }
  }
  ctx.reset() // EOF
  closeSegment(lines.length)

  return {
    moves: moves.finish(),
    events,
    segments,
    unhandled,
    totalTime: clock,
    tempTrack: tempTrack(events),
    fanTrack: fanTrack(events),
    stats: { lines: lines.length, arcs, helicalLifts, timestampLine },
  }
}
