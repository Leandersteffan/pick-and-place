import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  normalizeKeyOrder,
  pythonFloatRepr,
  pythonJsonString,
} from './canonicalJson'

const FIXTURE = new URL('../../../fixtures/demo-v1/', import.meta.url)
const VALID = new URL('../../../schema/testset/valid/', import.meta.url)

const readText = (base: URL, name: string): string => new TextDecoder().decode(readFileSync(new URL(name, base)))

/** True if any `overrides` holds an integral number: after JSON.parse, `12.0` and `12` look the same. */
function hasAmbiguousOverride(value: unknown, inOverrides = false): boolean {
  if (typeof value === 'number') return inOverrides && Number.isInteger(value)
  if (Array.isArray(value)) return value.some((v) => hasAmbiguousOverride(v, inOverrides))
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => hasAmbiguousOverride(v, inOverrides || k === 'overrides'))
  }
  return false
}

/** Rebuild every object with its keys in reverse insertion order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value).reverse()) out[k] = reverseKeys((value as Record<string, unknown>)[k])
    return out
  }
  return value
}

describe('pythonFloatRepr', () => {
  it.each([
    [3, '3.0'],
    [0, '0.0'],
    [-0, '-0.0'],
    [2.8, '2.8'],
    [-12.5, '-12.5'],
    [0.1 + 0.2, '0.30000000000000004'],
    [0.0001, '0.0001'],
    [0.00001, '1e-05'],
    [0.000012345, '1.2345e-05'],
    [1e15, '1000000000000000.0'],
    [1234567890123456, '1234567890123456.0'],
    [1e16, '1e+16'],
    [1.5e16, '1.5e+16'],
    [1e100, '1e+100'],
    [5e-324, '5e-324'],
    [1.7976931348623157e308, '1.7976931348623157e+308'],
    [10.200000000000001, '10.200000000000001'],
  ])('%s -> %s', (value, text) => {
    expect(pythonFloatRepr(value)).toBe(text)
  })

  it('rejects NaN and Infinity', () => {
    expect(() => pythonFloatRepr(NaN)).toThrow(RangeError)
    expect(() => canonicalJson({ x: Infinity })).toThrow(RangeError)
  })
})

describe('pythonJsonString', () => {
  it('escapes like ensure_ascii=True', () => {
    expect(pythonJsonString('Ü-plug')).toBe('"\\u00dc-plug"')
    expect(pythonJsonString('\u{1F600}')).toBe('"\\ud83d\\ude00"')
    expect(pythonJsonString('a"b\\c\n\r\t\b\f')).toBe('"a\\"b\\\\c\\n\\r\\t\\b\\f"')
    expect(pythonJsonString('\x01\x7f/')).toBe('"\\u0001\\u007f/"')
  })
})

describe('canonicalJson layout', () => {
  it('writes integers only for integer keys and empty containers inline', () => {
    const text = canonicalJson({
      version: 1,
      tray_spacing: 3,
      parts: [{ pause_layer: 12, tamps: [{ x: 1, type: 0 }], overrides: { n: 210, f: 0.5 } }],
      empty: [],
      none: {},
    })
    expect(text).toBe(
      [
        '{',
        '  "version": 1,',
        '  "tray_spacing": 3.0,',
        '  "parts": [',
        '    {',
        '      "pause_layer": 12,',
        '      "tamps": [',
        '        {',
        '          "x": 1.0,',
        '          "type": 0',
        '        }',
        '      ],',
        '      "overrides": {',
        '        "n": 210,',
        '        "f": 0.5',
        '      }',
        '    }',
        '  ],',
        '  "empty": [],',
        '  "none": {}',
        '}',
      ].join('\n'),
    )
  })

  it('uses the eol option and writes no trailing line break', () => {
    const text = canonicalJson({ a: [true, null] }, { eol: '\r\n' })
    expect(text).toBe('{\r\n  "a": [\r\n    true,\r\n    null\r\n  ]\r\n}')
  })
})

describe('golden files written by Python', () => {
  it.each(['spec.json', 'spec.export.json'])('reproduces fixture %s byte for byte (CRLF)', (name) => {
    const text = readText(FIXTURE, name)
    expect(text).toContain('\r\n')
    const spec = JSON.parse(text)
    expect(canonicalJson(spec, { eol: '\r\n' })).toBe(text)
    // The Fixture is already in the documented key order.
    expect(canonicalJson(spec, { eol: '\r\n', normalize: true })).toBe(text)
    expect(canonicalJson(reverseKeys(spec), { eol: '\r\n', normalize: true })).toBe(text)
  })

  it('reproduces the fixture manifest with its integer keys', () => {
    const text = readText(FIXTURE, 'manifest.json')
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const out = canonicalJson(JSON.parse(text), { eol, integerKeys: ['bundle_format', 'spec_version', 'bytes'] })
    expect(out).toBe(text)
  })

  it('reproduces the Python-written valid test set (LF)', () => {
    const names = readdirSync(VALID).filter((n: string) => n.endsWith('.json')).sort()
    let checked = 0
    const mismatched: string[] = []
    for (const name of names) {
      const text = readText(VALID, name)
      const spec = JSON.parse(text)
      if (hasAmbiguousOverride(spec)) continue
      checked++
      if (canonicalJson(spec) !== text) mismatched.push(name)
    }
    expect(mismatched).toEqual([])
    expect(checked).toBeGreaterThan(50)
  })
})

describe('normalizeKeyOrder', () => {
  it('orders plugs radius before height, points and rects, and sorts unknown keys', () => {
    const spec = {
      parts: [
        {
          zz: 1,
          aa: 2,
          height: 3,
          radius: 2,
          slot: { y1: 1, x1: 1, y0: 0, x0: 0 },
          place: { z: 0, type: 1, y: 0, x: 0 },
          overrides: { b: '1', a: '2' },
          type: 'plug',
        },
      ],
      tray_origin: { z: 0, y: 0, x: 0 },
      version: 1,
    }
    const out = normalizeKeyOrder(spec)
    expect(Object.keys(out)).toEqual(['version', 'tray_origin', 'parts'])
    const part = out.parts[0]
    expect(Object.keys(part)).toEqual(['type', 'place', 'radius', 'height', 'overrides', 'slot', 'aa', 'zz'])
    expect(Object.keys(part.place)).toEqual(['x', 'y', 'z', 'type'])
    expect(Object.keys(part.slot)).toEqual(['x0', 'y0', 'x1', 'y1'])
    expect(Object.keys(part.overrides)).toEqual(['b', 'a'])
    expect(Object.keys(out.tray_origin)).toEqual(['x', 'y', 'z'])
    // The input is not changed.
    expect(Object.keys(spec)).toEqual(['parts', 'tray_origin', 'version'])
  })
})
