import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isAsciiStl, meshBounds, readBinaryStl, readStl, writeBinaryStl } from './stl'

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../../fixtures/demo-v1/${name}`, import.meta.url)))
}

// Expected XY bounds from `py -3` with Scripts/pipeline/geometry.mesh_bounds on the same files.
const PYTHON_BOUNDS: Record<string, { ascii: boolean; vertices: number; xy: [number, number, number, number] }> = {
  'housing.stl': {
    ascii: false,
    vertices: 38898,
    xy: [3.8700196743011475, 7.307030200958252, 22.21878433227539, 21.271575927734375],
  },
  'part-2.stl': {
    ascii: true,
    vertices: 2220,
    xy: [7.244004249572754, 12.201783180236816, 16.78814697265625, 16.162311553955078],
  },
  'tray.stl': {
    ascii: true,
    vertices: 2100,
    xy: [0.0, 0.0, 44.744285583496094, 19.922664642333984],
  },
}

describe('readStl on the demo-v1 fixture', () => {
  for (const [name, expected] of Object.entries(PYTHON_BOUNDS)) {
    it(`${name} matches geometry.mesh_bounds`, () => {
      const bytes = fixture(name)
      expect(isAsciiStl(bytes)).toBe(expected.ascii)
      const { positions } = readStl(bytes)
      expect(positions.length / 3).toBe(expected.vertices)
      const bounds = meshBounds(positions)
      expect(bounds).not.toBeNull()
      bounds!.slice(0, 4).forEach((value, i) => {
        expect(Math.abs(value - expected.xy[i])).toBeLessThan(1e-4)
      })
    })
  }
})

describe('STL detection', () => {
  it('treats a header starting with "solid" but without "facet" as binary', () => {
    const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const bytes = writeBinaryStl(tri)
    bytes.set(new TextEncoder().encode('SOLID header'), 0)
    expect(isAsciiStl(bytes)).toBe(false)
    expect(Array.from(readStl(bytes).positions)).toEqual(Array.from(tri))
  })

  it('reads ASCII case-insensitively for the solid/facet probe', () => {
    const text = 'SOLID x\n FACET normal 0 0 1\n outer loop\n vertex 1 2 3\n vertex 4 5 6\n vertex -1 -2.5e0 7\n endloop\n endfacet\nendsolid x\n'
    const bytes = new TextEncoder().encode(text)
    expect(isAsciiStl(bytes)).toBe(true)
    expect(Array.from(readStl(bytes).positions)).toEqual([1, 2, 3, 4, 5, 6, -1, -2.5, 7])
  })

  it('returns an empty mesh for a truncated binary file', () => {
    expect(readBinaryStl(new Uint8Array(10)).positions.length).toBe(0)
    expect(meshBounds(new Float32Array(0))).toBeNull()
  })
})

describe('writeBinaryStl round trip', () => {
  it('reads back the same triangles and bounds', () => {
    const tris = new Float32Array([
      0, 0, 0, 10, 0, 0, 0, 5, 0,
      -2.5, 1.25, 3, 4, 7.75, -1, 0.1, 0.2, 0.3,
    ])
    const bytes = writeBinaryStl(tris)
    expect(bytes.length).toBe(84 + 2 * 50)
    expect(isAsciiStl(bytes)).toBe(false)
    const back = readStl(bytes).positions
    expect(Array.from(back)).toEqual(Array.from(tris))
    expect(meshBounds(back)).toEqual([-2.5, 0, 10, 7.75, -1, 3].map(Math.fround))
  })
})
