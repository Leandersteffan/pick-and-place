import { describe, expect, it } from 'vitest';
import { validateSpec } from './validate';
// The fixture files are imported as JSON modules. The app has no @types/node,
// so node:fs would not type-check; the JSON import reads the same bytes.
import fixtureSpec from '../../../fixtures/demo-v1/spec.json';
import fixtureExport from '../../../fixtures/demo-v1/spec.export.json';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('validateSpec', () => {
  it('accepts the written-back fixture spec.json', () => {
    const verdict = validateSpec(clone(fixtureSpec));
    expect(verdict.errors).toEqual([]);
    expect(verdict.valid).toBe(true);
  });

  it('accepts the raw export fixture spec.export.json', () => {
    const verdict = validateSpec(clone(fixtureExport));
    expect(verdict.errors).toEqual([]);
    expect(verdict.valid).toBe(true);
  });

  it('rejects an unknown top-level key at the root pointer', () => {
    const spec = clone(fixtureSpec) as Record<string, unknown>;
    spec.colour = 'red';
    const verdict = validateSpec(spec);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContainEqual(
      expect.objectContaining({ pointer: '', keyword: 'additionalProperties' }),
    );
  });

  it('rejects an unknown key inside a part at that part pointer', () => {
    const spec = clone(fixtureSpec) as { parts: Record<string, unknown>[] };
    spec.parts[0].colour = 'red';
    const verdict = validateSpec(spec);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContainEqual(
      expect.objectContaining({ pointer: '/parts/0', keyword: 'additionalProperties' }),
    );
  });

  it('rejects a bad part type at /parts/<i>/type', () => {
    const spec = clone(fixtureSpec) as { parts: Record<string, unknown>[] };
    spec.parts[1].type = 'resistor';
    const verdict = validateSpec(spec);
    expect(verdict.valid).toBe(false);
    // Same single leaf the Backend reports (pnp_server/validation.py).
    expect(verdict.errors.map((e) => [e.pointer, e.keyword])).toEqual([['/parts/1/type', 'enum']]);
  });

  it('reports a missing part type only through required', () => {
    const spec = clone(fixtureSpec) as { parts: Record<string, unknown>[] };
    delete spec.parts[0].type;
    const verdict = validateSpec(spec);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.map((e) => [e.pointer, e.keyword])).toEqual([['/parts/0', 'required']]);
  });

  it('sorts errors by pointer, then keyword', () => {
    const spec = clone(fixtureSpec) as Record<string, unknown> & { parts: Record<string, unknown>[] };
    spec.colour = 'red';
    spec.version = 2;
    spec.parts[0].colour = 'red';
    const { errors } = validateSpec(spec);
    const keys = errors.map((e) => [e.pointer, e.keyword]);
    const sorted = [...keys].sort((a, b) =>
      a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
    );
    expect(keys).toEqual(sorted);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
