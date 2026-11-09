// Move classification and the group/part/wipe context state machine (design section 5).
// Pure: no DOM, no three.js.
//
// The parser keeps three independent pieces of state:
// - group: inside a placement group or not,
// - part:  which phase of one part's sequence,
// - wipe:  an overlay that can start anywhere (`;Nozzle Wipe Sequence`).
// A Context_Boundary, PAUSE or EOF resets all three.

import type { MarkerMatch } from './markers'
import type { MoveType } from './types'

export type GroupVariant = 'layer' | 'late' | 'fallback'
export type PartPhase = 'start' | 'header' | 'pick' | 'place' | 'prinjection' | 'tamp'

export interface WipeState {
  phase: 'approach' | 'swipe'
  /** State restored when the wipe ends (the four return rules). */
  returnGroup: GroupVariant | null
  returnPart: PartPhase | null
}

export interface ParserState {
  group: GroupVariant | null
  part: PartPhase | null
  wipe: WipeState | null
}

/** One source command's motion, as seen by the classifier. */
export interface RawMove {
  x0: number; y0: number; z0: number
  x1: number; y1: number; z1: number
  /** relative extrusion of the whole command, mm */
  e: number
  /** a tessellated G2/G3 */
  arc: boolean
  /** G2/G3 with no X/Y words and no E: a helical lift, classified as one z_hop unit */
  helical: boolean
  /** the source command carried an X or Y word */
  xyWords: boolean
}

/** Which axis words the source command carried. Used for the wipe phase rules. */
export interface AxisWords { x: boolean; y: boolean; z: boolean; e: boolean }

const XY_EPS = 1e-6

/** Classifies one source command (all pieces of an arc get the same type). */
export function classify(m: RawMove, s: ParserState): MoveType {
  if (s.wipe) return 'wipe'
  switch (s.part) {
    case 'pick': return 'pick'
    case 'place': return 'place'
    case 'tamp': return 'tamp'
    case 'prinjection': return 'prinjection'
    default: break
  }
  if (m.helical) return 'z_hop'
  const xyMoved = Math.hypot(m.x1 - m.x0, m.y1 - m.y0) > XY_EPS
  if (m.e > 0 && (xyMoved || m.arc)) return 'extrude'
  // Travel includes ;WIPE_START moves with negative E, and commands that name X/Y but end
  // at the same XY, such as the group's return move `G1 X250.0 Y15.0 Z23.0` after the final wipe.
  if (xyMoved || m.xyWords) return 'travel'
  return 'z_hop' // Z-only commands and helical lifts (XY back at start)
}

/**
 * The context state machine. The parser calls `onMarker`, `onBoundary`, `onPause`
 * as comment lines and PAUSE arrive, `classifyMove` for each command that emits
 * Moves, and `afterMove` once per such command.
 */
export class ContextMachine {
  readonly state: ParserState = { group: null, part: null, wipe: null }
  /** Moves emitted in the current part phase outside a wipe (for the Prinjection return rule). */
  private phaseMoves = 0

  reset(): void {
    this.state.group = null
    this.state.part = null
    this.state.wipe = null
    this.phaseMoves = 0
  }

  onBoundary(): void {
    this.reset()
  }

  onPause(): void {
    this.reset()
  }

  /** Applies an Assembly_Marker. Other marker kinds are ignored. */
  onMarker(m: MarkerMatch): void {
    const s = this.state
    if (m.kind === 'wipe') {
      this.startWipe()
      return
    }
    const isAssembly =
      m.kind === 'placement_group' || m.kind === 'placing' || m.kind === 'pnp_header' || m.kind === 'pick_seq' ||
      m.kind === 'place_seq' || m.kind === 'prinjection' || m.kind === 'tamping'
    if (!isAssembly) return
    // Any Assembly_Marker clears the wipe; restore its return state first.
    if (s.wipe) this.endWipe()
    switch (m.kind) {
      case 'placement_group': s.group = m.variant; this.setPart(null); break
      case 'placing': this.setPart('start'); break
      case 'pnp_header': this.setPart('header'); break
      case 'pick_seq': this.setPart('pick'); break
      case 'place_seq': this.setPart('place'); break
      case 'prinjection': this.setPart('prinjection'); break
      case 'tamping': this.setPart('tamp'); break
      default: break
    }
  }

  classifyMove(m: RawMove): MoveType {
    return classify(m, this.state)
  }

  /** Updates the wipe overlay after a command's Moves were typed. */
  afterMove(words: AxisWords): void {
    const w = this.state.wipe
    if (w === null) {
      this.phaseMoves++
      return
    }
    const onlyX = words.x && !words.y && !words.z && !words.e
    const onlyZ = words.z && !words.x && !words.y && !words.e
    if (onlyX) w.phase = 'swipe'
    else if (onlyZ && w.phase === 'swipe') this.endWipe()
  }

  private setPart(p: PartPhase | null): void {
    this.state.part = p
    this.phaseMoves = 0
  }

  /**
   * Starts a wipe and records where it returns to (assemble.py emits wipes in four places):
   * - Free (post-PAUSE wipe) -> Free
   * - Header (before ;Pick Sequence) -> Header
   * - Prinjection with no Moves yet -> Prinjection (the hole Moves follow without a new marker)
   * - any other part phase, or Group -> Group: the part is finished
   * PartStart behaves like Header (the wipe is part of the preamble).
   */
  private startWipe(): void {
    const s = this.state
    let returnPart: PartPhase | null
    if (s.part === null || s.part === 'start' || s.part === 'header') returnPart = s.part
    else if (s.part === 'prinjection' && this.phaseMoves === 0) returnPart = 'prinjection'
    else returnPart = null
    // A wipe started inside another wipe keeps the outer return state.
    if (s.wipe) {
      s.wipe = { phase: 'approach', returnGroup: s.wipe.returnGroup, returnPart: s.wipe.returnPart }
      return
    }
    s.wipe = { phase: 'approach', returnGroup: s.group, returnPart }
  }

  private endWipe(): void {
    const s = this.state
    const w = s.wipe
    if (w === null) return
    s.wipe = null
    s.group = w.returnGroup
    const keepCount = w.returnPart === s.part
    s.part = w.returnPart
    if (!keepCount) this.phaseMoves = 0
  }
}
