// STL codec. Pure functions on Uint8Array, no DOM.
//
// The ASCII/binary rule and the readers follow `geometry._stl_vertices` in
// Scripts/pipeline, so bounds computed here match the pipeline's
// `geometry.mesh_bounds` for the same file.

/** Non-indexed triangles: 9 floats (3 vertices x XYZ) per triangle. */
export interface Mesh {
  positions: Float32Array
}

/** [minX, minY, maxX, maxY, minZ, maxZ] */
export type Bounds = [number, number, number, number, number, number]

const ASCII_PROBE_BYTES = 4000
const HEADER_BYTES = 80
const RECORD_BYTES = 50

function lowerAscii(byte: number): number {
  return byte >= 65 && byte <= 90 ? byte + 32 : byte
}

function startsWithLower(bytes: Uint8Array, word: string): boolean {
  if (bytes.length < word.length) return false
  for (let i = 0; i < word.length; i++) {
    if (lowerAscii(bytes[i]) !== word.charCodeAt(i)) return false
  }
  return true
}

function containsLower(bytes: Uint8Array, word: string, limit: number): boolean {
  const end = Math.min(bytes.length, limit) - word.length
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < word.length; j++) {
      if (lowerAscii(bytes[i + j]) !== word.charCodeAt(j)) continue outer
    }
    return true
  }
  return false
}

/**
 * ASCII if the bytes start with `solid` (case-insensitive) and `facet`
 * occurs in the first 4000 bytes (case-insensitive). Same rule as
 * `geometry._stl_vertices`.
 */
export function isAsciiStl(bytes: Uint8Array): boolean {
  return startsWithLower(bytes, 'solid') && containsLower(bytes, 'facet', ASCII_PROBE_BYTES)
}

const VERTEX_RE = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g

/**
 * Every `vertex x y z` line, in order. A trailing partial triangle (vertex
 * count not a multiple of 3) is dropped.
 */
export function readAsciiStl(bytes: Uint8Array): Mesh {
  const text = new TextDecoder('utf-8').decode(bytes)
  const values: number[] = []
  for (const match of text.matchAll(VERTEX_RE)) {
    values.push(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]))
  }
  const usable = values.length - (values.length % 9)
  return { positions: Float32Array.from(values.slice(0, usable)) }
}

/**
 * 80-byte header, uint32 triangle count, 50-byte records (normal, 3 vertices,
 * uint16 attribute). Stops early when the file is shorter than the count says.
 */
export function readBinaryStl(bytes: Uint8Array): Mesh {
  if (bytes.length < HEADER_BYTES + 4) return { positions: new Float32Array(0) }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const declared = view.getUint32(HEADER_BYTES, true)
  const available = Math.floor((bytes.length - HEADER_BYTES - 4 - 48) / RECORD_BYTES) + 1
  const count = Math.max(0, Math.min(declared, available))
  const positions = new Float32Array(count * 9)
  let offset = HEADER_BYTES + 4
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 9; k++) {
      positions[t * 9 + k] = view.getFloat32(offset + 12 + k * 4, true)
    }
    offset += RECORD_BYTES
  }
  return { positions }
}

/** Reads ASCII or binary STL using the pipeline's detection rule. */
export function readStl(bytes: Uint8Array): Mesh {
  return isAsciiStl(bytes) ? readAsciiStl(bytes) : readBinaryStl(bytes)
}

/**
 * Binary STL from non-indexed triangles. Normals are computed from the
 * winding; degenerate triangles get a zero normal. The header never starts
 * with `solid`, so the file is always read back as binary.
 */
export function writeBinaryStl(positions: Float32Array): Uint8Array {
  const count = Math.floor(positions.length / 9)
  const out = new Uint8Array(HEADER_BYTES + 4 + count * RECORD_BYTES)
  const header = 'pnp-web binary STL'
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i)
  const view = new DataView(out.buffer)
  view.setUint32(HEADER_BYTES, count, true)
  let offset = HEADER_BYTES + 4
  for (let t = 0; t < count; t++) {
    const p = t * 9
    const ux = positions[p + 3] - positions[p]
    const uy = positions[p + 4] - positions[p + 1]
    const uz = positions[p + 5] - positions[p + 2]
    const vx = positions[p + 6] - positions[p]
    const vy = positions[p + 7] - positions[p + 1]
    const vz = positions[p + 8] - positions[p + 2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len > 0 && Number.isFinite(len)) {
      nx /= len
      ny /= len
      nz /= len
    } else {
      nx = ny = nz = 0
    }
    view.setFloat32(offset, nx, true)
    view.setFloat32(offset + 4, ny, true)
    view.setFloat32(offset + 8, nz, true)
    for (let k = 0; k < 9; k++) view.setFloat32(offset + 12 + k * 4, positions[p + k], true)
    view.setUint16(offset + 48, 0, true)
    offset += RECORD_BYTES
  }
  return out
}

/** Axis-aligned bounds of all vertices, or null for an empty mesh (like `geometry.mesh_bounds`). */
export function meshBounds(positions: Float32Array): Bounds | null {
  if (positions.length < 3) return null
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return [minX, minY, maxX, maxY, minZ, maxZ]
}
