// Feature: pick-and-place-web-frontend, Property 23: Browser and backend validators agree
// Required schema agreement test (task 3.6). Every Spec in the shared test set
// (web/schema/testset, written by web/schema/tools/gen_testset.py) gets the
// verdict recorded in expected.json from validateSpec, and every reported error
// pointer (RFC 6901) resolves in the Spec or, for a missing key, in its parent.
// The pytest twin is web/server/tests/test_schema_agreement.py.
// Validates: Requirements 3.2, 3.5, 2.4, 2.5
import { describe, expect, it } from 'vitest';
import expected from '../../../schema/testset/expected.json';
import { validateSpec } from './validate';

const modules = import.meta.glob<{ default: unknown }>(
  ['../../../schema/testset/valid/*.json', '../../../schema/testset/invalid/*.json'],
  { eager: true },
);

// '../../../schema/testset/valid/0001.json' -> 'valid/0001.json', the expected.json key.
const specs = new Map<string, unknown>(
  Object.entries(modules).map(([path, mod]) => [path.slice(path.indexOf('testset/') + 'testset/'.length), mod.default]),
);
const verdicts = expected as Record<string, boolean>;

const MISSING = Symbol('missing');

function tokens(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`not an RFC 6901 pointer: ${JSON.stringify(pointer)}`);
  return pointer.slice(1).split('/').map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function lookup(doc: unknown, path: string[]): unknown {
  let node: unknown = doc;
  for (const token of path) {
    if (Array.isArray(node)) {
      if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) >= node.length) return MISSING;
      node = node[Number(token)];
    } else if (node !== null && typeof node === 'object') {
      if (!Object.prototype.hasOwnProperty.call(node, token)) return MISSING;
      node = (node as Record<string, unknown>)[token];
    } else {
      return MISSING;
    }
  }
  return node;
}

function resolvesInSpecOrParent(doc: unknown, pointer: string): boolean {
  const path = tokens(pointer);
  if (lookup(doc, path) !== MISSING) return true;
  return path.length > 0 && lookup(doc, path.slice(0, -1)) !== MISSING;
}

describe('Property 23: Browser and backend validators agree', () => {
  it('loads exactly the files listed in expected.json', () => {
    expect([...specs.keys()].sort()).toEqual(Object.keys(verdicts).sort());
    const values = Object.values(verdicts);
    expect(values.filter((v) => v).length).toBeGreaterThanOrEqual(100);
    expect(values.filter((v) => !v).length).toBeGreaterThanOrEqual(100);
    for (const [name, verdict] of Object.entries(verdicts)) {
      expect(verdict).toBe(name.startsWith('valid/'));
    }
  });

  it.each(Object.entries(verdicts).sort(([a], [b]) => (a < b ? -1 : 1)))('%s -> %s', (name, verdict) => {
    const spec = specs.get(name);
    const result = validateSpec(spec);
    expect(result.valid, JSON.stringify(result.errors.slice(0, 3))).toBe(verdict);
    if (verdict) expect(result.errors).toEqual([]);
    else expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) {
      expect(resolvesInSpecOrParent(spec, error.pointer), JSON.stringify(error)).toBe(true);
    }
  });
});
