import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/demo-v1/combined_output.gcode?raw'
import type { Vec3 } from '../model/spec'
import { ARC_MAX_DEVIATION, splitExtrusion, tessellateArc } from './arcs'

/** Distance in XY from point p to the segment a-b. */
function distToSegment(p: { x: number; y: number }, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

interface ArcCase { start: Vec3; end: Vec3; i: number; j: number; cw: boolean; c: { x: number; y: number }; r: number; a0: number; sweep: number }

function makeArc(cx: number, cy: number, r: number, a0: number, sweep: number, cw: boolean, z0 = 0.2, z1 = 0.2): ArcCase {
  const a1 = a0 + (cw ? -sweep : sweep)
  const start = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0), z: z0 }
  const end = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1), z: z1 }
  return { start, end, i: cx - start.x, j: cy - start.y, cw, c: { x: cx, y: cy }, r, a0, sweep }
}

/** Largest XY distance between the true arc and the chord chain, sampled densely per chord. */
function maxChordDeviation(k: ArcCase, points: Vec3[]): number {
  const n = points.length
  const dir = k.cw ? -1 : 1
  let worst = 0
  let prev = k.start
  for (let s = 0; s < n; s++) {
    const cur = points[s]
    for (let q = 0; q <= 32; q++) {
      const t = (s + q / 32) / n
      const a = k.a0 + dir * k.sweep * t
      const p = { x: k.c.x + k.r * Math.cos(a), y: k.c.y + k.r * Math.sin(a) }
      worst = Math.max(worst, distToSegment(p, prev, cur))
    }
    prev = cur
  }
  return worst
}

/** Signed swept angle of the chain around the centre (positive = counter-clockwise). */
function signedSweep(c: { x: number; y: number }, start: Vec3, points: Vec3[]): number {
  let total = 0
  let prevA = Math.atan2(start.y - c.y, start.x - c.x)
  for (const p of points) {
    const a = Math.atan2(p.y - c.y, p.x - c.x)
    let d = a - prevA
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    total += d
    prevA = a
  }
  return total
}

describe('tessellateArc', () => {
  it('keeps chord deviation at or below 0.05 mm for several radii and sweeps', () => {
    for (const r of [0.05, 0.2, 0.74, 3, 25, 200]) {
      for (const sweep of [0.1, Math.PI / 3, Math.PI, 1.9 * Math.PI]) {
        for (const cw of [true, false]) {
          const k = makeArc(10, -5, r, 0.7, sweep, cw)
          const pts = tessellateArc(k.start, k.end, k.end.z, k.i, k.j, cw)
          expect(maxChordDeviation(k, pts)).toBeLessThanOrEqual(ARC_MAX_DEVIATION + 1e-9)
        }
      }
    }
  })

  it('ends exactly at the commanded end', () => {
    const k = makeArc(3.3, 7.1, 12.5, 2.0, 2.2, true, 0.4, 0.6)
    const pts = tessellateArc(k.start, k.end, 0.6, k.i, k.j, true)
    expect(pts[pts.length - 1]).toEqual({ x: k.end.x, y: k.end.y, z: 0.6 })
    expect(pts.length).toBeGreaterThan(1)
  })

  it('turns G2 clockwise and G3 counter-clockwise, taking the long way when commanded', () => {
    // Quarter arc from (1,0) to (0,1) around the origin.
    const start = { x: 1, y: 0, z: 0 }
    const end = { x: 0, y: 1, z: 0 }
    const ccw = tessellateArc(start, end, 0, -1, 0, false)
    const cw = tessellateArc(start, end, 0, -1, 0, true)
    expect(signedSweep({ x: 0, y: 0 }, start, ccw)).toBeCloseTo(Math.PI / 2, 9)
    expect(signedSweep({ x: 0, y: 0 }, start, cw)).toBeCloseTo(-1.5 * Math.PI, 9)
  })

  it('makes a full helical circle back to the start XY when X/Y are absent', () => {
    // G3 Z2.6 I1.03 J.648 P1 from (20, 30, 2.0)
    const start = { x: 20, y: 30, z: 2.0 }
    const pts = tessellateArc(start, null, 2.6, 1.03, 0.648, false, 1)
    const c = { x: 21.03, y: 30.648 }
    expect(signedSweep(c, start, pts)).toBeCloseTo(2 * Math.PI, 9)
    expect(pts[pts.length - 1]).toEqual({ x: 20, y: 30, z: 2.6 })
    // Z rises monotonically from 2.0 to 2.6.
    let z = start.z
    for (const p of pts) { expect(p.z).toBeGreaterThan(z); z = p.z }
    const r = Math.hypot(1.03, 0.648)
    for (const p of pts) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(r, 9)
  })

  it('adds a revolution per extra P turn and treats equal start/end XY as a full circle', () => {
    const start = { x: 0, y: 0, z: 0 }
    const p3 = tessellateArc(start, null, 1, 2, 0, true, 3)
    expect(signedSweep({ x: 2, y: 0 }, start, p3)).toBeCloseTo(-6 * Math.PI, 9)
    const same = tessellateArc(start, { x: 0, y: 0, z: 0 }, 0, 2, 0, false)
    expect(signedSweep({ x: 2, y: 0 }, start, same)).toBeCloseTo(2 * Math.PI, 9)
  })

  it('interpolates the radius linearly when start and end radii differ', () => {
    // Centre at origin, start radius 1, end radius 1.1, half circle counter-clockwise.
    const start = { x: 1, y: 0, z: 0 }
    const end = { x: -1.1, y: 0, z: 0 }
    const pts = tessellateArc(start, end, 0, -1, 0, false)
    const n = pts.length
    pts.forEach((p, k) => {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1 + 0.1 * ((k + 1) / n), 9)
    })
  })

  it('returns only the end point for a zero radius', () => {
    expect(tessellateArc({ x: 1, y: 1, z: 0 }, { x: 2, y: 2, z: 0 }, 0, 0, 0, true)).toEqual([{ x: 2, y: 2, z: 0 }])
  })

  it('handles a real arc line from the fixture', () => {
    // Fixture: G1 X38.882 Y10.696 E.00956 then G2 X39.145 Y10.156 I-.476 J-.566 E.0235
    const lines = fixture.split(/\r?\n/)
    const idx = lines.findIndex((l) => l.startsWith('G2 X39.145 Y10.156 I-.476 J-.566 E.0235'))
    expect(idx).toBeGreaterThan(0)
    expect(lines[idx - 1].startsWith('G1 X38.882 Y10.696')).toBe(true)
    const start = { x: 38.882, y: 10.696, z: 0.2 }
    const end = { x: 39.145, y: 10.156, z: 0.2 }
    const pts = tessellateArc(start, end, 0.2, -0.476, -0.566, true)
    expect(pts[pts.length - 1]).toEqual(end)
    const c = { x: 38.406, y: 10.13 }
    const sw = signedSweep(c, start, pts)
    expect(sw).toBeLessThan(0) // clockwise
    expect(sw).toBeGreaterThan(-Math.PI) // short way round (about 50 degrees)
    const r = Math.hypot(0.476, 0.566)
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k]
      const b = pts[k + 1]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      expect(r - Math.hypot(mid.x - c.x, mid.y - c.y)).toBeLessThanOrEqual(ARC_MAX_DEVIATION)
    }
    const e = splitExtrusion(start, pts, 0.0235)
    expect(e.reduce((s, v) => s + v, 0)).toBeCloseTo(0.0235, 12)
  })
})

describe('splitExtrusion', () => {
  it('splits E in proportion to piece length and sums exactly', () => {
    const start = { x: 0, y: 0, z: 0 }
    const pts = [{ x: 1, y: 0, z: 0 }, { x: 1, y: 3, z: 0 }]
    const e = splitExtrusion(start, pts, 0.4)
    expect(e[0]).toBeCloseTo(0.1, 12)
    expect(e[1]).toBeCloseTo(0.3, 12)
    expect(e[0] + e[1]).toBe(0.4)
  })

  it('gives equal shares on an arc with equal pieces', () => {
    const start = { x: 5, y: 0, z: 0 }
    const pts = tessellateArc(start, { x: -5, y: 0, z: 0 }, 0, -5, 0, false)
    const e = splitExtrusion(start, pts, 1)
    for (const v of e) expect(v).toBeCloseTo(1 / pts.length, 9)
  })

  it('shares equally when there is no length, and returns nothing for no pieces', () => {
    expect(splitExtrusion({ x: 0, y: 0, z: 0 }, [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], 2)).toEqual([1, 1])
    expect(splitExtrusion({ x: 0, y: 0, z: 0 }, [], 2)).toEqual([])
  })
})
