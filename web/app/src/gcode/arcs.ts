import type { Vec3 } from '../model/spec'

/** Default maximum chord deviation from the true arc, mm (Requirement 5.3). */
export const ARC_MAX_DEVIATION = 0.05
/** Upper bound on pieces per arc, so a malformed line cannot explode the Move table. */
export const ARC_MAX_SEGMENTS = 1024

const TWO_PI = Math.PI * 2
const SAME_XY_EPS = 1e-9

/**
 * Tessellates a G2/G3 arc or helix in the XY plane.
 *
 * - `start`: the position before the command.
 * - `end`: the commanded end (X/Y, with Z already resolved), or `null` when the line has no
 *   X/Y words (Orca's helical lift `G3 Z2.6 I1.03 J.648 P1`): a full circle back to the start XY.
 * - `endZ`: the commanded end Z (used for both cases; `end.z` is ignored in favour of it).
 * - `i`, `j`: centre offset from the start XY.
 * - `clockwise`: true for G2, false for G3.
 * - `turns`: P, default 1. Each turn above 1 adds a full revolution.
 *
 * Returns the points after `start`. The last point equals the commanded end exactly.
 * The radius is interpolated linearly from the start radius to the end radius, and Z linearly
 * by angle. A zero radius returns just the end point.
 */
export function tessellateArc(
  start: Vec3,
  end: Vec3 | null,
  endZ: number,
  i: number,
  j: number,
  clockwise: boolean,
  turns = 1,
  maxDev = ARC_MAX_DEVIATION,
): Vec3[] {
  const endX = end === null ? start.x : end.x
  const endY = end === null ? start.y : end.y
  const finalPoint: Vec3 = { x: endX, y: endY, z: endZ }

  const cx = start.x + i
  const cy = start.y + j
  const r0 = Math.hypot(start.x - cx, start.y - cy)
  const r1 = Math.hypot(endX - cx, endY - cy)
  if (!(r0 > 0) || !Number.isFinite(r0) || !Number.isFinite(r1)) return [finalPoint]

  const a0 = Math.atan2(start.y - cy, start.x - cx)
  const a1 = Math.atan2(endY - cy, endX - cx)
  const sameXY = Math.abs(endX - start.x) <= SAME_XY_EPS && Math.abs(endY - start.y) <= SAME_XY_EPS

  let sweep: number
  if (end === null || sameXY) {
    sweep = TWO_PI
  } else {
    const raw = clockwise ? a0 - a1 : a1 - a0
    sweep = raw - Math.floor(raw / TWO_PI) * TWO_PI // [0, 2π)
    if (sweep <= 0) sweep = TWO_PI
  }
  const p = Number.isFinite(turns) && turns > 1 ? Math.floor(turns) : 1
  sweep += (p - 1) * TWO_PI

  const rMax = Math.max(r0, r1)
  const theta = rMax > maxDev ? 2 * Math.acos(1 - maxDev / rMax) : Math.PI / 2
  const n = Math.min(ARC_MAX_SEGMENTS, Math.max(1, Math.ceil(sweep / theta)))
  const dir = clockwise ? -1 : 1

  const points: Vec3[] = []
  for (let k = 1; k < n; k++) {
    const t = k / n
    const a = a0 + dir * sweep * t
    const r = r0 + (r1 - r0) * t
    points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), z: start.z + (endZ - start.z) * t })
  }
  points.push(finalPoint)
  return points
}

/**
 * Splits a command's relative extrusion `e` over the tessellated pieces in proportion to
 * each piece's 3D length. The shares sum to `e`. Pieces of zero total length share equally.
 */
export function splitExtrusion(start: Vec3, points: readonly Vec3[], e: number): number[] {
  const lengths: number[] = []
  let total = 0
  let prev = start
  for (const q of points) {
    const len = Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z)
    lengths.push(len)
    total += len
    prev = q
  }
  if (points.length === 0) return []
  if (!(total > 0)) return points.map(() => e / points.length)
  const shares = lengths.map((len) => (e * len) / total)
  // Put the rounding remainder on the last piece so the sum is exact.
  let sumButLast = 0
  for (let k = 0; k < shares.length - 1; k++) sumButLast += shares[k]
  shares[shares.length - 1] = e - sumButLast
  return shares
}
