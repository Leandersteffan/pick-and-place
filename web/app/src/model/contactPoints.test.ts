// Contact-point derivation against the shared vector web/schema/testset/contact-points.json.
// The pytest twin is web/server/tests/test_contact_points.py (derive_contact_points).
import { describe, expect, it } from 'vitest'
import vector from '../../../schema/testset/contact-points.json'
import { deriveContactPoints } from './contactPoints'
import type { Spec } from './spec'

interface Case {
  name: string
  spec: unknown
  expected: unknown[]
}

const cases = (vector as { cases: Case[] }).cases

describe('deriveContactPoints shared vector', () => {
  it('has cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(4)
  })
  for (const c of cases) {
    it(c.name, () => {
      expect(deriveContactPoints(c.spec as Spec)).toEqual(c.expected)
    })
  }
})
