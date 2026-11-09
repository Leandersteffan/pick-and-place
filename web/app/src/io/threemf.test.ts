import { readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { meshBounds } from './stl'
import { readThreeMf } from './threemf'

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../../fixtures/demo-v1/${name}`, import.meta.url)))
}

function model(itemTransform?: string): Uint8Array {
  const transform = itemTransform ? ` transform="${itemTransform}"` : ''
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
    '<resources><object id="1" type="model"><mesh><vertices>\n' +
    '<vertex x="0" y="0" z="0"/><vertex x="2" y="0" z="0"/><vertex x="0" y="3" z="1.5"/>\n' +
    '</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>\n' +
    `<build><item objectid="1"${transform}/></build></model>\n`
  return zipSync({ '3D/3dmodel.model': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') })
}

describe('readThreeMf', () => {
  it('housing.3mf matches geometry.mesh_bounds', () => {
    // From `py -3` with Scripts/pipeline/geometry.mesh_bounds on the same file.
    const expected = [3.870019, 7.30703, 22.218784, 21.271576]
    const { positions, warnings } = readThreeMf(fixture('housing.3mf'), 'housing.3mf')
    expect(warnings).toEqual([])
    expect(positions.length % 9).toBe(0)
    const bounds = meshBounds(positions)
    expect(bounds).not.toBeNull()
    bounds!.slice(0, 4).forEach((value, i) => {
      expect(Math.abs(value - expected[i])).toBeLessThan(1e-4)
    })
  })

  it('expands indexed triangles', () => {
    const { positions, warnings } = readThreeMf(model())
    expect(Array.from(positions)).toEqual([0, 0, 0, 2, 0, 0, 0, 3, 1.5])
    expect(warnings).toEqual([])
  })

  it('ignores an identity transform without a warning', () => {
    expect(readThreeMf(model('1 0 0 0 1 0 0 0 1 0 0 0')).warnings).toEqual([])
  })

  it('ignores a non-identity transform and warns', () => {
    const { positions, warnings } = readThreeMf(model('1 0 0 0 1 0 0 0 1 100 50 0'), 'x.3mf')
    expect(Array.from(positions)).toEqual([0, 0, 0, 2, 0, 0, 0, 3, 1.5])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('3mf-transform')
    expect(warnings[0].file).toBe('x.3mf')
  })
})
