// Contact points derived from a Spec (design section 9, "Contact points").
//
// Spec v1 does not store the C# contact-point list. What survives is every
// `prinjection` point of a component and every type-3 (TracePCB) tamp of a
// trace. Points with equal XY within 0.001 mm are one contact point: the lower
// Z is kept (the prinjection Z, the true contact Z) and overrides are merged
// with tamp keys winning, since C# copies contact-point overrides onto the tamp.
import type { ContactPoint } from './project'
import type { Spec } from './spec'

export const CONTACT_MERGE_TOL_MM = 0.001

function sameXY(a: ContactPoint, b: ContactPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= CONTACT_MERGE_TOL_MM
}

function merge(into: ContactPoint, next: ContactPoint): void {
  const prinjection = into.origin === 'prinjection' ? into : next.origin === 'prinjection' ? next : undefined
  const tamp = into.origin === 'tamp3' ? into : next.origin === 'tamp3' ? next : undefined
  const overrides =
    prinjection && tamp
      ? { ...prinjection.overrides, ...tamp.overrides }
      : { ...into.overrides, ...next.overrides }
  if (next.z < into.z) {
    into.x = next.x
    into.y = next.y
    into.z = next.z
    into.origin = next.origin
  }
  if (Object.keys(overrides).length > 0) into.overrides = overrides
  else delete into.overrides
}

/** Prinjection points first (Spec order), then type-3 tamps, merged by XY. */
export function deriveContactPoints(spec: Spec): ContactPoint[] {
  const candidates: ContactPoint[] = []
  for (const part of spec.parts) {
    if ((part.type === 'pcb' || part.type === 'print') && part.prinjection) {
      for (const p of part.prinjection) {
        candidates.push({ x: p.x, y: p.y, z: p.z, origin: 'prinjection', ...(p.overrides ? { overrides: { ...p.overrides } } : {}) })
      }
    }
  }
  for (const part of spec.parts) {
    for (const t of part.tamps ?? []) {
      if (t.type !== 3) continue
      candidates.push({ x: t.x, y: t.y, z: t.z, origin: 'tamp3', ...(t.overrides ? { overrides: { ...t.overrides } } : {}) })
    }
  }
  const out: ContactPoint[] = []
  for (const c of candidates) {
    const hit = out.find((p) => sameXY(p, c))
    if (hit) merge(hit, c)
    else out.push(c)
  }
  return out
}
