/**
 * Deterministic JSON in the byte format of Python `json.dump(obj, handle, indent=2)`.
 *
 * A Spec written by the Web_App, a Spec written back by the pipeline and the
 * Fixture file diff cleanly because all three use this layout:
 *
 * - 2-space indent, items separated by `,` plus a line break, `": "` between key
 *   and value, `[]` and `{}` for empty containers, no trailing line break.
 * - Numbers follow Python `float.__repr__` (`3.0`, `1e-05`, `1.5e+16`, `-0.0`).
 *   Integer fields (`version`, `pause_layer`, tamp `type` by default) are written
 *   without `.0`. Inside `overrides` the int/float distinction is lost after
 *   `JSON.parse`, so integral values are written as integers there and other
 *   values with the float repr.
 * - Strings use Python `ensure_ascii=True` escaping: every code unit outside
 *   space..`~` becomes `\uXXXX` (lowercase hex), so a character outside the BMP
 *   becomes two escapes for its UTF-16 surrogate pair.
 *
 * Key order: `canonicalJson` keeps the insertion order of the input objects, as
 * Python dicts do (and `JSON.parse` preserves it). For objects built by the
 * Editor, `normalizeKeyOrder` (or the `normalize` option) puts keys in the order
 * the Rhino exporter (`_part_record`) and traygen write them.
 */

export type Eol = '\n' | '\r\n'

export interface CanonicalJsonOptions {
  /** Line break between lines. `'\r\n'` reproduces files Python wrote on Windows in text mode. Default `'\n'`. */
  eol?: Eol
  /** Apply `normalizeKeyOrder` before writing. Default `false` (keep insertion order). */
  normalize?: boolean
  /** Keys whose numeric values are integers. Default `version`, `pause_layer`, `type`. */
  integerKeys?: Iterable<string>
}

export const DEFAULT_INTEGER_KEYS: readonly string[] = ['version', 'pause_layer', 'type']

// --------------------------------------------------------------------------- key order

export const TOP_LEVEL_ORDER: readonly string[] = [
  'version', 'printer', 'use_trace_braid', 'housing', 'tray', 'tray_spacing', 'tray_origin', 'parts',
]

/** `_part_record` followed by the traygen write-back order. */
export const PART_ORDER: readonly string[] = [
  'type', 'place', 'pick', 'pause_layer', 'size', 'bbox_center', 'bbox_min',
  'length', 'width', 'height', 'horizontal', 'line_from', 'line_to', 'radius',
  'tray_offset', 'overrides', 'name', 'tamps', 'prinjection', 'mesh',
  'slot', 'pocket', 'pocket_depth', 'slot_shape',
]

/** `_part_record` writes a plug as `radius` then `height`. */
export const PLUG_ORDER: readonly string[] = (() => {
  const order = PART_ORDER.filter((k) => k !== 'radius')
  order.splice(order.indexOf('height'), 0, 'radius')
  return order
})()

export const POINT_ORDER: readonly string[] = ['x', 'y', 'z', 'type', 'overrides']
export const RECT_ORDER: readonly string[] = ['x0', 'y0', 'x1', 'y1']

const POINT_KEYS = new Set(['tray_origin', 'place', 'pick', 'size', 'bbox_center', 'bbox_min', 'line_from', 'line_to'])
const POINT_LIST_KEYS = new Set(['tamps', 'prinjection'])
const RECT_KEYS = new Set(['slot', 'pocket'])

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: unknown }

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Known keys in `order` first, then unknown keys sorted (UTF-16 code unit order). */
function orderedKeys(obj: JsonObject, order: readonly string[]): string[] {
  const known = order.filter((k) => Object.prototype.hasOwnProperty.call(obj, k))
  const set = new Set(order)
  const unknown = Object.keys(obj).filter((k) => !set.has(k)).sort()
  return [...known, ...unknown]
}

function reorder(obj: JsonObject, order: readonly string[], child: (key: string, value: unknown) => unknown): JsonObject {
  const out: JsonObject = {}
  for (const key of orderedKeys(obj, order)) out[key] = child(key, obj[key])
  return out
}

/** Deep copy that keeps insertion order (for `overrides`). */
function copyAsIs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyAsIs)
  if (isObject(value)) {
    const out: JsonObject = {}
    for (const key of Object.keys(value)) out[key] = copyAsIs(value[key])
    return out
  }
  return value
}

/** Deep copy with every key sorted (for objects with no documented order). */
function copySorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copySorted)
  if (isObject(value)) return reorder(value, [], (_k, v) => copySorted(v))
  return value
}

function normalizePoint(value: unknown): unknown {
  if (!isObject(value)) return copySorted(value)
  return reorder(value, POINT_ORDER, (k, v) => (k === 'overrides' ? copyAsIs(v) : copySorted(v)))
}

function normalizeRect(value: unknown): unknown {
  return isObject(value) ? reorder(value, RECT_ORDER, (_k, v) => copySorted(v)) : copySorted(value)
}

function normalizePart(value: unknown): unknown {
  if (!isObject(value)) return copySorted(value)
  const order = value.type === 'plug' ? PLUG_ORDER : PART_ORDER
  return reorder(value, order, (key, v) => {
    if (key === 'overrides') return copyAsIs(v)
    if (POINT_KEYS.has(key)) return normalizePoint(v)
    if (RECT_KEYS.has(key)) return normalizeRect(v)
    if (POINT_LIST_KEYS.has(key)) return Array.isArray(v) ? v.map(normalizePoint) : copySorted(v)
    return copySorted(v)
  })
}

/**
 * A deep copy of a Spec with keys in the documented order: top level, parts (per
 * kind), points and rects. Unknown keys follow in sorted order. `overrides` keep
 * their insertion order, as Python dicts do. The input is not changed.
 */
export function normalizeKeyOrder<T>(spec: T): T {
  if (!isObject(spec)) return copySorted(spec) as T
  return reorder(spec, TOP_LEVEL_ORDER, (key, v) => {
    if (key === 'tray_origin') return normalizePoint(v)
    if (key === 'parts') return Array.isArray(v) ? v.map(normalizePart) : copySorted(v)
    return copySorted(v)
  }) as T
}

// --------------------------------------------------------------------------- numbers

/** Python `repr(float)`: shortest round-trip digits, exponent form below 1e-4 or from 1e16. */
export function pythonFloatRepr(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`canonicalJson: ${value} is not allowed in JSON`)
  }
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0'
  const sign = value < 0 ? '-' : ''
  // toExponential() without an argument gives the shortest digits that round-trip,
  // the same digits Python 3 picks for repr.
  const [mantissa, expText] = Math.abs(value).toExponential().split('e')
  const exp = Number(expText)
  const digits = mantissa.replace('.', '')
  if (exp < -4 || exp >= 16) {
    const expSign = exp < 0 ? '-' : '+'
    const expDigits = String(Math.abs(exp)).padStart(2, '0')
    return `${sign}${mantissa}e${expSign}${expDigits}`
  }
  if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`
  const intLen = exp + 1
  const intPart = digits.length >= intLen ? digits.slice(0, intLen) : digits.padEnd(intLen, '0')
  const fracPart = digits.length > intLen ? digits.slice(intLen) : '0'
  return `${sign}${intPart}.${fracPart}`
}

/** Python `repr(int)`. */
function pythonIntRepr(value: number): string {
  if (Object.is(value, -0)) return '0'
  return Math.abs(value) < 1e21 ? String(value) : BigInt(value).toString()
}

// --------------------------------------------------------------------------- strings

const SHORT_ESCAPES: Record<string, string> = {
  '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f',
}

/** Python `json` string encoding with `ensure_ascii=True`. */
export function pythonJsonString(text: string): string {
  let out = '"'
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const code = text.charCodeAt(i)
    const short = SHORT_ESCAPES[ch]
    if (short !== undefined) out += short
    else if (code >= 0x20 && code <= 0x7e) out += ch
    else out += '\\u' + code.toString(16).padStart(4, '0')
  }
  return out + '"'
}

// --------------------------------------------------------------------------- writer

/**
 * Serialize `value` with the bytes Python `json.dump(value, handle, indent=2)` writes.
 * Throws a `RangeError` for NaN and Infinity (the test set is written with `allow_nan=False`).
 */
export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
  const eol = options.eol ?? '\n'
  const integerKeys = new Set(options.integerKeys ?? DEFAULT_INTEGER_KEYS)
  const root = options.normalize ? normalizeKeyOrder(value) : value

  const number = (n: number, key: string | null, inOverrides: boolean): string => {
    if (inOverrides) return Number.isInteger(n) ? pythonIntRepr(n) : pythonFloatRepr(n)
    if (key !== null && integerKeys.has(key) && Number.isInteger(n)) return pythonIntRepr(n)
    return pythonFloatRepr(n)
  }

  const write = (v: unknown, key: string | null, indent: string, inOverrides: boolean): string => {
    if (v === null || v === undefined) return 'null'
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') return number(v, key, inOverrides)
    if (typeof v === 'string') return pythonJsonString(v)
    const inner = indent + '  '
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]'
      // Numbers directly inside an array use the float repr (manifest offsets, for
      // example). Objects inside an array, such as tamps, use their own keys.
      const items = v.map((item) => inner + write(item, null, inner, inOverrides))
      return '[' + eol + items.join(',' + eol) + eol + indent + ']'
    }
    if (isObject(v)) {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== 'function')
      if (keys.length === 0) return '{}'
      const items = keys.map(
        (k) => inner + pythonJsonString(k) + ': ' + write(v[k], k, inner, inOverrides || k === 'overrides'),
      )
      return '{' + eol + items.join(',' + eol) + eol + indent + '}'
    }
    throw new TypeError(`canonicalJson: cannot serialize ${typeof v}`)
  }

  return write(root as Json, null, '', false)
}
