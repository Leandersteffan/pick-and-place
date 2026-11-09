// Required golden test (task 3.4): the schema declares draft 2020-12 and covers
// every key the Grasshopper exporter writes. Fixture validity itself is checked
// in validate.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import schema from '../../../schema/spec.v1.schema.json';

// The exporter lives in Scripts/, outside vite's server.fs.allow (['..']), so a
// `?raw` import is denied. The app has no @types/node, so node:fs is loaded
// through an untyped dynamic import with a minimal local type.
type NodeFs = { readFileSync(path: URL, encoding: 'utf8'): string };
const EXPORTER_URL = new URL('../../../../Scripts/Py3-261103_1b2fe.py', import.meta.url);
let exporter = '';

beforeAll(async () => {
  const fsModule: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsModule)) as NodeFs;
  exporter = fs.readFileSync(EXPORTER_URL, 'utf8');
});

const PART_BRANCHES = ['tracePart', 'plugPart', 'componentPart'] as const;

function functionBody(text: string, name: string): string {
  const start = text.indexOf(`\ndef ${name}(`);
  if (start === -1) throw new Error(`${name} not found in the exporter`);
  const end = text.indexOf('\ndef ', start + 1);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1]);
}

// Keys of the record dict in _part_record, plus record["mesh"] from process_print.
function partRecordKeys(text: string): Set<string> {
  const body = functionBody(text.replace(/\r\n/g, '\n'), '_part_record');
  const literal = /record\s*=\s*\{([\s\S]*?)\}/.exec(body);
  if (!literal) throw new Error('record literal not found in _part_record');
  const assigned = /record\["(\w+)"\]\s*=/g;
  return new Set([
    ...matches(literal[1], /"(\w+)"\s*:/g),
    ...matches(body, assigned),
    ...matches(functionBody(text.replace(/\r\n/g, '\n'), 'process_print'), assigned),
  ]);
}

// Keys of the spec dict literal in process_print (line-start keys only, so nested dicts are skipped).
function topLevelKeys(text: string): Set<string> {
  const body = functionBody(text.replace(/\r\n/g, '\n'), 'process_print');
  const literal = /\n\s*spec\s*=\s*\{\n([\s\S]*?)\n\s*\}\n/.exec(body);
  if (!literal) throw new Error('spec literal not found in process_print');
  return new Set(matches(literal[1], /^\s*"(\w+)"\s*:/gm));
}

type Props = { properties: Record<string, unknown> };
const defs = (schema as unknown as { $defs: Record<string, Props> }).$defs;

describe('spec.v1.schema.json against the Fixture exporter', () => {
  it('declares draft 2020-12 and is a valid 2020-12 schema', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    const ajv = new Ajv2020({ strict: false });
    expect(ajv.validateSchema(schema)).toBe(true);
  });

  it('finds the exporter keys (guards the extraction regexes)', () => {
    const keys = partRecordKeys(exporter);
    for (const key of ['type', 'place', 'pick', 'pause_layer', 'length', 'radius', 'size', 'tray_offset', 'mesh']) {
      expect(keys.has(key)).toBe(true);
    }
    const top = topLevelKeys(exporter);
    expect(top.has('version') && top.has('parts')).toBe(true);
  });

  it('has every _part_record key in a part branch', () => {
    const known = new Set(PART_BRANCHES.flatMap((b) => Object.keys(defs[b].properties)));
    const missing = [...partRecordKeys(exporter)].filter((k) => !known.has(k)).sort();
    expect(missing).toEqual([]);
    expect(Object.keys(defs.componentPart.properties)).toContain('mesh');
  });

  it('has every top-level spec key, and requires exactly those', () => {
    const top = topLevelKeys(exporter);
    const props = Object.keys(schema.properties);
    expect([...top].filter((k) => !props.includes(k)).sort()).toEqual([]);
    expect([...schema.required].sort()).toEqual([...top].sort());
  });
});
