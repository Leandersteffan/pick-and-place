// Growable struct-of-arrays builder for MoveTable. Pure: no DOM, no three.js.

import type { MoveTable } from './types'

/** One row to append. */
export interface MoveRow {
  x0: number; y0: number; z0: number
  x1: number; y1: number; z1: number
  e: number; f: number
  type: number; segment: number; layer: number
  line: number; tStart: number; duration: number; arc: boolean
}

function allocate(capacity: number): MoveTable {
  return {
    n: 0,
    x0: new Float64Array(capacity), y0: new Float64Array(capacity), z0: new Float64Array(capacity),
    x1: new Float64Array(capacity), y1: new Float64Array(capacity), z1: new Float64Array(capacity),
    e: new Float32Array(capacity), f: new Float32Array(capacity),
    type: new Uint8Array(capacity), segment: new Uint8Array(capacity), layer: new Uint16Array(capacity),
    line: new Uint32Array(capacity), tStart: new Float64Array(capacity), duration: new Float32Array(capacity),
    arc: new Uint8Array(capacity),
  }
}

const KEYS = ['x0', 'y0', 'z0', 'x1', 'y1', 'z1', 'e', 'f', 'type', 'segment', 'layer', 'line', 'tStart', 'duration', 'arc'] as const

/**
 * Appends Moves into typed arrays, doubling the capacity when full.
 * Pre-size with the line count: most gcode lines become at most one Move;
 * tessellated arcs grow the table.
 */
export class MoveTableBuilder {
  private t: MoveTable
  private capacity: number

  constructor(initialCapacity = 1024) {
    this.capacity = Math.max(16, initialCapacity | 0)
    this.t = allocate(this.capacity)
  }

  get n(): number {
    return this.t.n
  }

  /** The table being built (live; the arrays are longer than n). */
  get table(): MoveTable {
    return this.t
  }

  push(r: MoveRow): number {
    if (this.t.n >= this.capacity) this.grow()
    const t = this.t
    const i = t.n
    t.x0[i] = r.x0; t.y0[i] = r.y0; t.z0[i] = r.z0
    t.x1[i] = r.x1; t.y1[i] = r.y1; t.z1[i] = r.z1
    t.e[i] = r.e; t.f[i] = r.f
    t.type[i] = r.type; t.segment[i] = r.segment; t.layer[i] = r.layer
    t.line[i] = r.line; t.tStart[i] = r.tStart; t.duration[i] = r.duration
    t.arc[i] = r.arc ? 1 : 0
    t.n = i + 1
    return i
  }

  private grow(): void {
    const next = allocate(this.capacity * 2)
    for (const k of KEYS) (next[k] as { set(a: ArrayLike<number>): void }).set(this.t[k])
    next.n = this.t.n
    this.t = next
    this.capacity *= 2
  }

  /** Returns a compact copy with arrays of exactly length n. */
  finish(): MoveTable {
    const n = this.t.n
    const out = { n } as MoveTable
    for (const k of KEYS) (out as unknown as Record<string, unknown>)[k] = this.t[k].slice(0, n)
    return out
  }
}
