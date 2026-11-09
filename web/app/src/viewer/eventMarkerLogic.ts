// Timeline marker layout and labels (design section 6, Requirements 7.1 to 7.5).
// Pure: no React, no DOM, no stores.
import { timelineMarkers } from '../gcode/lookup'
import type { GcodeEvent } from '../gcode/types'
import type { Part } from '../model/spec'
import type { Selection } from '../scene/sceneHelpers'

export interface MarkerItem {
  event: GcodeEvent
  /** Short label, e.g. "Layer 11 Placement", "Placing PCB #3", "Tamp ×2", "PAUSE". */
  label: string
  /** Tooltip: label, source line and Move index. */
  title: string
  /** Labelled flag (placement_group, placing, pause) or a plain tick. */
  flag: boolean
}

export interface MarkerGroup {
  moveIndex: number
  /** 0..1 along the Timeline. */
  pos: number
  /** Stacked bottom to top in source-line order. */
  items: MarkerItem[]
}

const FLAG_KINDS = new Set(['placement_group', 'placing', 'pause'])

/** Display label of a marker Event. */
export function markerLabel(e: GcodeEvent): string {
  const d = e.data
  switch (e.kind) {
    case 'placement_group':
      if (d.kind === 'placement_group' && d.variant === 'late') return 'Late Placement'
      if (d.kind === 'placement_group' && d.variant === 'fallback') return 'Fallback Placement'
      return e.label
    case 'placing':
      return e.label
    case 'pnp_header':
      return d.kind === 'pnp_header' ? `P&P ${d.partKind}` : e.label
    case 'pick_seq':
      return 'Pick'
    case 'place_seq':
      return 'Place'
    case 'tamping':
      return d.kind === 'tamping' ? `Tamp ×${d.count}` : 'Tamp'
    case 'prinjection':
      return 'Prinjection'
    case 'wipe':
      return 'Wipe'
    case 'pause':
      return 'PAUSE'
    default:
      return e.label
  }
}

/** Marker Events grouped by `moveIndex`, positioned on a Timeline over `n` Moves. */
export function layoutMarkers(events: readonly GcodeEvent[], n: number): MarkerGroup[] {
  const span = Math.max(1, n - 1)
  const groups: MarkerGroup[] = []
  for (const event of timelineMarkers(events)) {
    const moveIndex = seekIndex(event, n)
    let g = groups[groups.length - 1]
    if (g === undefined || g.moveIndex !== moveIndex) {
      g = { moveIndex, pos: moveIndex / span, items: [] }
      groups.push(g)
    }
    const label = markerLabel(event)
    g.items.push({
      event,
      label,
      title: `${label} · line ${event.line} · move ${moveIndex + 1}`,
      flag: FLAG_KINDS.has(event.kind),
    })
  }
  return groups
}

/** Playhead for a click on this marker: the first Move after the Event, clamped to [0, n - 1]. */
export function seekIndex(e: GcodeEvent, n: number): number {
  return Math.min(Math.max(0, e.moveIndex), Math.max(0, n - 1))
}

/**
 * Selection for a `placing` marker: part `number - 1`, as a trace box, a part mesh, or
 * (for a plug, which has no body in the scene) its pick point. Null for any other Event
 * or when the Spec has no such part.
 */
export function placingSelection(e: GcodeEvent, parts: readonly Pick<Part, 'type'>[]): Selection | null {
  if (e.data.kind !== 'placing') return null
  const partIndex = e.data.number - 1
  const part = parts[partIndex]
  if (part === undefined) return null
  switch (part.type) {
    case 'trace_cloth':
    case 'trace_braid':
      return { kind: 'trace', partIndex }
    case 'pcb':
    case 'print':
      return { kind: 'partMesh', partIndex }
    default:
      return { kind: 'pick', partIndex }
  }
}
