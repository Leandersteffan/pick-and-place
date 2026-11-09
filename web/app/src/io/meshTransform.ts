// Moves every vertex of an STL by (dx, dy). Used by the translate command so
// a component mesh stays centred on its bbox_center (traygen centres the mesh
// in the pocket using bbox_center).
import { isAsciiStl, readAsciiStl, writeBinaryStl } from './stl'

const HEADER_BYTES = 80
const RECORD_BYTES = 50

/**
 * Returns a new STL with every vertex moved by (dx, dy). A binary STL keeps
 * its header, normals and attribute bytes (a translation does not change a
 * normal). An ASCII STL is written back as binary.
 */
export function translateStl(bytes: Uint8Array, dx: number, dy: number): Uint8Array {
  if (isAsciiStl(bytes)) {
    const { positions } = readAsciiStl(bytes)
    for (let i = 0; i + 2 < positions.length; i += 3) {
      positions[i] += dx
      positions[i + 1] += dy
    }
    return writeBinaryStl(positions)
  }
  const out = bytes.slice()
  if (out.length < HEADER_BYTES + 4) return out
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const declared = view.getUint32(HEADER_BYTES, true)
  const count = Math.min(declared, Math.floor((out.length - HEADER_BYTES - 4) / RECORD_BYTES))
  for (let t = 0; t < count; t++) {
    const rec = HEADER_BYTES + 4 + t * RECORD_BYTES
    for (let v = 0; v < 3; v++) {
      const at = rec + 12 + v * 12
      view.setFloat32(at, view.getFloat32(at, true) + dx, true)
      view.setFloat32(at + 4, view.getFloat32(at + 4, true) + dy, true)
    }
  }
  return out
}
