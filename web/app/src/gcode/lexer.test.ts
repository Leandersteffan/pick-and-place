import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/demo-v1/combined_output.gcode?raw'
import { lex, lexLine, splitLines, type MacroToken, type Token, type WordToken } from './lexer'

function word(raw: string): WordToken {
  const t = lexLine(raw, 1)
  if (t.kind !== 'word') throw new Error(`expected word token for ${raw}, got ${t.kind}`)
  return t
}

function macro(raw: string): MacroToken {
  const t = lexLine(raw, 1)
  if (t.kind !== 'macro') throw new Error(`expected macro token for ${raw}, got ${t.kind}`)
  return t
}

describe('splitLines', () => {
  it('strips \\r, keeps 1-based order and drops the empty piece after a final newline', () => {
    expect(splitLines('G1 X1\r\nG1 X2\r\n')).toEqual(['G1 X1', 'G1 X2'])
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b'])
    expect(splitLines('')).toEqual([''])
  })

  it('lexes CRLF and LF text to the same tokens', () => {
    const lf = 'G1 X1 E.8\n;Pick Sequence\nPAUSE\n'
    expect(lex(lf.replace(/\n/g, '\r\n'))).toEqual(lex(lf))
    expect(lex(lf).map((t) => t.line)).toEqual([1, 2, 3])
  })
})

describe('lexLine word commands', () => {
  it('accepts leading-dot numbers', () => {
    expect(word('G1 E.8 F2100').words).toEqual({ E: 0.8, F: 2100 })
    expect(word('G1 Z.2').words).toEqual({ Z: 0.2 })
    expect(word('G1 E-.8 F2400').words).toEqual({ E: -0.8, F: 2400 })
    expect(word('G2 X10.5 Y3 I-.52828 J.3 E.0035').words).toEqual({ X: 10.5, Y: 3, I: -0.52828, J: 0.3, E: 0.0035 })
  })

  it('tolerates the double space in an Orca helical lift', () => {
    const t = word('G3 Z.8 I.272 J1.186 P1  F30000')
    expect(t.code).toBe('G3')
    expect(t.words).toEqual({ Z: 0.8, I: 0.272, J: 1.186, P: 1, F: 30000 })
  })

  it('reports bare axis letters of G28 as flags, not words', () => {
    const t = word('G28 Z I140 J140')
    expect(t.code).toBe('G28')
    expect(t.words).toEqual({ I: 140, J: 140 })
    expect(t.flags).toEqual(['Z'])
    expect(word('G28').flags).toEqual([])
  })

  it('normalises the command and keeps parameter order irrelevant', () => {
    expect(word('G01 X1').code).toBe('G1')
    expect(word('M104 S0 T0 A0').words).toEqual({ S: 0, T: 0, A: 0 })
    expect(word('M104 T0 S140').words).toEqual({ T: 0, S: 140 })
    const t0 = word('T0')
    expect([t0.code, t0.letter, t0.number]).toEqual(['T0', 'T', 0])
    expect(word('G1 X1e2').words).toEqual({ X: 100 })
  })

  it('splits off an inline comment', () => {
    const t = word('G1 X220 Y15 Z13 F24000 ; wipe')
    expect(t.words).toEqual({ X: 220, Y: 15, Z: 13, F: 24000 })
    expect(t.comment).toBe(' wipe')
    expect(word('G1 X1').comment).toBeUndefined()
  })
})

describe('lexLine macros, PAUSE, comments', () => {
  it('parses Klipper macro parameters', () => {
    expect(macro('TEMPERATURE_WAIT SENSOR=extruder MAXIMUM=102')).toEqual({
      kind: 'macro', line: 1, name: 'TEMPERATURE_WAIT', params: { SENSOR: 'extruder', MAXIMUM: '102' },
    })
    expect(macro('SET_PRESSURE_ADVANCE ADVANCE=0').params).toEqual({ ADVANCE: '0' })
    expect(macro('PRINT_START').params).toEqual({})
    expect(
      macro('BED_MESH_CALIBRATE mesh_min=0.500,1.000 mesh_max=47.244,46.887 ALGORITHM=bicubic PROBE_COUNT=3,3').params,
    ).toEqual({ mesh_min: '0.500,1.000', mesh_max: '47.244,46.887', ALGORITHM: 'bicubic', PROBE_COUNT: '3,3' })
  })

  it('recognises bare PAUSE and M601 as the pause command', () => {
    expect(lexLine('PAUSE', 3817)).toEqual({ kind: 'pause', line: 3817, source: 'PAUSE' })
    expect(lexLine('  PAUSE  \r', 5)).toEqual({ kind: 'pause', line: 5, source: 'PAUSE' })
    expect(lexLine('M601', 9)).toEqual({ kind: 'pause', line: 9, source: 'M601' })
    expect(lexLine('PAUSE X=1', 1).kind).toBe('macro')
  })

  it('detects comments on the trimmed line and keeps their text', () => {
    expect(lexLine('  ;Pick Sequence\r', 4)).toEqual({ kind: 'comment', line: 4, text: ';Pick Sequence' })
    expect(lexLine('', 2)).toEqual({ kind: 'blank', line: 2 })
    expect(lexLine('   ', 2).kind).toBe('blank')
  })

  it('returns unknown for lines that are neither commands nor macros', () => {
    expect(lexLine('hello world', 7)).toEqual({ kind: 'unknown', line: 7, text: 'hello world' })
    expect(lexLine('@begin X1', 7).kind).toBe('unknown')
  })
})

describe('Fixture combined_output.gcode', () => {
  const tokens: Token[] = lex(fixture)

  it('has 10176 LF lines', () => {
    expect(fixture.includes('\r')).toBe(false)
    expect(tokens.length).toBe(10176)
    expect(tokens[0].line).toBe(1)
    expect(tokens[10175].line).toBe(10176)
  })

  it('has one bare PAUSE at line 3817 and no unknown lines', () => {
    expect(tokens.filter((t) => t.kind === 'pause').map((t) => t.line)).toEqual([3817])
    expect(tokens.filter((t) => t.kind === 'unknown')).toEqual([])
  })

  it('has the counted word commands', () => {
    const counts: Record<string, number> = {}
    for (const t of tokens) if (t.kind === 'word') counts[t.code] = (counts[t.code] ?? 0) + 1
    expect(counts).toEqual({
      M486: 67, M73: 180, M201: 1, M203: 1, M204: 978, M205: 1, M106: 34, M140: 1, M104: 13, G28: 3, T0: 2,
      G90: 6, M109: 4, G0: 4, M190: 1, M107: 5, G1: 6491, M83: 2, G21: 1, G92: 32, G2: 106, G3: 86, G17: 32, G4: 15,
    })
  })

  it('has the counted macros', () => {
    const counts: Record<string, number> = {}
    for (const t of tokens) if (t.kind === 'macro') counts[t.name] = (counts[t.name] ?? 0) + 1
    expect(counts).toEqual({
      SET_PRINT_AUTO_BED_LEVELING: 1, SET_TIME_LAPSE_CAMERA: 1, PRINT_START: 1, DEFECT_DETECTION_START: 1,
      SET_PRINT_STATS_INFO: 66, TIMELAPSE_START: 1, DEFECT_DETECTION_DETECT_BED: 1, SM_PRINT_CHECK_SWITCH_EXTRUDER: 1,
      SM_PRINT_EXTRUDER_PREHEAT: 3, SM_PRINT_AUTO_FEED: 4, SM_PRINT_FLOW_CALIBRATE: 4,
      MOVE_TO_DISCARD_FILAMENT_POSITION: 3, ROUGHLY_CLEAN_NOZZLE_WITH_DISCARD: 1, MOVE_TO_XY_IDLE_POSITION_EXTRUDER: 3,
      DETECT_BED_PLATE: 1, ROUGHLY_CLEAN_NOZZLE: 2, FINELY_CLEAN_NOZZLE_STAGE_1: 1, FINELY_CLEAN_NOZZLE_STAGE_2: 1,
      BED_MESH_CALIBRATE: 1, TIMELAPSE_TAKE_FRAME: 32, DEFECT_DETECTION_DETECT: 32, SET_PRESSURE_ADVANCE: 4,
      TEMPERATURE_WAIT: 6, PRINT_END: 1, TIMELAPSE_STOP: 1,
    })
  })

  it('lexes the TEMPERATURE_WAIT lines of the PCB pick', () => {
    expect(tokens[6598]).toEqual({
      kind: 'macro', line: 6599, name: 'TEMPERATURE_WAIT', params: { SENSOR: 'extruder', MAXIMUM: '102' },
    })
    expect(tokens[6615]).toEqual({
      kind: 'macro', line: 6616, name: 'TEMPERATURE_WAIT', params: { SENSOR: 'extruder', MINIMUM: '208' },
    })
  })
})
