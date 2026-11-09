// 3MF reader. Pure function on Uint8Array, no DOM (regex parse), so it runs in Node.
//
// Like `geometry._3mf_vertices` in Scripts/pipeline, every `*.model` entry is
// read and build/component transforms are ignored. A non-identity transform
// produces a `3mf-transform` warning, because Orca applies it while the
// pipeline bounds do not.
import { unzipSync } from 'fflate'
import type { ImportWarning } from '../model/project'
import type { Mesh } from './stl'

export interface ThreeMfResult extends Mesh {
  warnings: ImportWarning[]
}

const OBJECT_RE = /<object\b[^>]*>([\s\S]*?)<\/object>/g
const VERTEX_RE = /<vertex\b([^>]*)>/g
const TRIANGLE_RE = /<triangle\b([^>]*)>/g
const TRANSFORM_RE = /<(item|component)\b[^>]*\btransform\s*=\s*"([^"]*)"/g
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

function attr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(attrs)
  return match ? match[1] : undefined
}

function isIdentity(transform: string): boolean {
  const values = transform.trim().split(/\s+/).map(Number)
  return values.length === 12 && values.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9)
}

function parseModel(text: string, out: number[]): void {
  for (const object of text.matchAll(OBJECT_RE)) {
    const body = object[1]
    const verts: number[] = []
    for (const v of body.matchAll(VERTEX_RE)) {
      verts.push(Number(attr(v[1], 'x')), Number(attr(v[1], 'y')), Number(attr(v[1], 'z')))
    }
    const vertexCount = verts.length / 3
    for (const t of body.matchAll(TRIANGLE_RE)) {
      const ids = [attr(t[1], 'v1'), attr(t[1], 'v2'), attr(t[1], 'v3')].map(Number)
      if (!ids.every((id) => Number.isInteger(id) && id >= 0 && id < vertexCount)) continue
      for (const id of ids) out.push(verts[id * 3], verts[id * 3 + 1], verts[id * 3 + 2])
    }
  }
}

/** Reads every mesh object of every `*.model` part into non-indexed triangles. */
export function readThreeMf(bytes: Uint8Array, file?: string): ThreeMfResult {
  const entries = unzipSync(bytes, { filter: (entry) => entry.name.endsWith('.model') })
  const decoder = new TextDecoder('utf-8')
  const values: number[] = []
  const warnings: ImportWarning[] = []
  let transformed = 0
  for (const name of Object.keys(entries)) {
    const text = decoder.decode(entries[name])
    parseModel(text, values)
    for (const match of text.matchAll(TRANSFORM_RE)) {
      if (!isIdentity(match[2])) transformed++
    }
  }
  if (transformed > 0) {
    warnings.push({
      kind: '3mf-transform',
      file,
      message:
        `${transformed} non-identity transform(s) ignored. The pipeline bounds ignore them too, ` +
        'but Orca applies them, so the sliced position can differ.',
    })
  }
  return { positions: Float32Array.from(values), warnings }
}
