// Gcode lexer. Pure: no DOM, no three.js.
//
// One source line becomes one Token. Lines are 1-based. A trailing `\r` is
// stripped, so CRLF and LF files lex the same. Full-line comments are passed on
// as `comment` tokens for the marker matcher (markers.ts); the lexer itself does
// not interpret them.

/** A word command such as `G1 X10 E.8` or `M104 S100 T0`. */
export interface WordToken {
  kind: 'word'
  line: number
  /** Normalised command, e.g. 'G1', 'M104', 'T0' ('G01' becomes 'G1'). */
  code: string
  letter: 'G' | 'M' | 'T'
  number: number
  /** Parameter words after the command, letter upper-cased. A repeated letter keeps the last value. */
  words: Record<string, number>
  /** Letters given without a value, e.g. `Z` in `G28 Z I140 J140`. Upper-cased, in source order. */
  flags: string[]
  /** Text after the first `;` on the line, if any. */
  comment?: string
}

/** A Klipper macro such as `TEMPERATURE_WAIT SENSOR=extruder MAXIMUM=102`. */
export interface MacroToken {
  kind: 'macro'
  line: number
  name: string
  /** `KEY=value` parameters, keys as written (Klipper accepts both cases). */
  params: Record<string, string>
  comment?: string
}

/** Bare `PAUSE` (Klipper) or `M601` (Prusa). */
export interface PauseToken {
  kind: 'pause'
  line: number
  source: 'PAUSE' | 'M601'
  comment?: string
}

/** A line whose trimmed text starts with `;`. `text` is the trimmed line. */
export interface CommentToken {
  kind: 'comment'
  line: number
  text: string
}

export interface BlankToken {
  kind: 'blank'
  line: number
}

/** Anything else. The parser records the line as unhandled. */
export interface UnknownToken {
  kind: 'unknown'
  line: number
  text: string
}

export type Token = WordToken | MacroToken | PauseToken | CommentToken | BlankToken | UnknownToken

/** Word parameter: letter, optional space, number with optional leading dot, sign and exponent. */
export const RE_WORD = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/gi
/** A letter standing alone, e.g. the `Z` in `G28 Z I140 J140`. */
const RE_FLAG = /(?:^|\s)([A-Z])(?=\s|$)/gi
const RE_COMMAND = /^([GMT])(\d+)/i
/** `N123 ` line-number prefix of the Marlin host protocol. */
const RE_LINE_NUMBER = /^N\d+\s*/i
/** `*71` checksum suffix of the Marlin host protocol. */
const RE_CHECKSUM = /\s*\*\d+$/
const RE_MACRO_NAME = /^[A-Z_][A-Z0-9_]*$/
/** Klipper macro parameter `KEY=value`. */
export const RE_MACRO_PARAM = /(\w+)=(\S+)/g

/**
 * Splits text into source lines. A trailing `\r` is removed from each line.
 * A final newline does not produce an extra empty line, so a 10176-line file
 * gives 10176 entries. Index i holds line i + 1.
 */
export function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '' && text.length > 0) lines.pop()
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.length > 0 && l.charCodeAt(l.length - 1) === 13) lines[i] = l.slice(0, -1)
  }
  return lines
}

/** Parses the parameter words of a word command (the text after the command token). */
export function parseWords(rest: string): { words: Record<string, number>; flags: string[] } {
  const words: Record<string, number> = {}
  const flags: string[] = []
  RE_WORD.lastIndex = 0
  for (let m = RE_WORD.exec(rest); m !== null; m = RE_WORD.exec(rest)) {
    words[m[1].toUpperCase()] = Number(m[2])
  }
  RE_FLAG.lastIndex = 0
  for (let m = RE_FLAG.exec(rest); m !== null; m = RE_FLAG.exec(rest)) {
    flags.push(m[1].toUpperCase())
  }
  return { words, flags }
}

/** Parses Klipper `KEY=value` parameters. */
export function parseMacroParams(rest: string): Record<string, string> {
  const params: Record<string, string> = {}
  RE_MACRO_PARAM.lastIndex = 0
  for (let m = RE_MACRO_PARAM.exec(rest); m !== null; m = RE_MACRO_PARAM.exec(rest)) {
    params[m[1]] = m[2]
  }
  return params
}

/** Lexes one source line (without its newline). `line` is the 1-based line number. */
export function lexLine(raw: string, line: number): Token {
  const src = raw.length > 0 && raw.charCodeAt(raw.length - 1) === 13 ? raw.slice(0, -1) : raw
  const trimmed = src.trim()
  if (trimmed.length === 0) return { kind: 'blank', line }
  if (trimmed.charCodeAt(0) === 59 /* ; */) return { kind: 'comment', line, text: trimmed }

  const semi = trimmed.indexOf(';')
  // Host-protocol framing from Marlin/Prusa senders: a leading `N123` line number
  // and a trailing `*71` checksum. Neither changes the command.
  const code = (semi < 0 ? trimmed : trimmed.slice(0, semi)).trim().replace(RE_LINE_NUMBER, '').replace(RE_CHECKSUM, '')
  if (code.length === 0) {
    return semi < 0 ? { kind: 'blank', line } : { kind: 'comment', line, text: trimmed.slice(semi).trim() }
  }
  const comment = semi < 0 ? undefined : trimmed.slice(semi + 1)
  const withComment = <T extends object>(t: T): T => (comment === undefined ? t : { ...t, comment })

  const cmd = RE_COMMAND.exec(code)
  if (cmd !== null) {
    const letter = cmd[1].toUpperCase() as 'G' | 'M' | 'T'
    const number = parseInt(cmd[2], 10)
    if (letter === 'M' && number === 601) return withComment({ kind: 'pause', line, source: 'M601' } as PauseToken)
    const { words, flags } = parseWords(code.slice(cmd[0].length))
    return withComment({ kind: 'word', line, code: `${letter}${number}`, letter, number, words, flags } as WordToken)
  }

  const space = code.search(/\s/)
  const name = space < 0 ? code : code.slice(0, space)
  if (RE_MACRO_NAME.test(name)) {
    const rest = space < 0 ? '' : code.slice(space + 1)
    if (name === 'PAUSE' && rest.trim().length === 0) {
      return withComment({ kind: 'pause', line, source: 'PAUSE' } as PauseToken)
    }
    return withComment({ kind: 'macro', line, name, params: parseMacroParams(rest) } as MacroToken)
  }

  return { kind: 'unknown', line, text: trimmed }
}

/** Lexes a whole file. Token i is line i + 1. */
export function lex(text: string): Token[] {
  const lines = splitLines(text)
  const out: Token[] = new Array(lines.length)
  for (let i = 0; i < lines.length; i++) out[i] = lexLine(lines[i], i + 1)
  return out
}
