// Event markers over the Timeline and prev / next event buttons
// (design section 6, Requirements 7.1 to 7.5). Layout and labels live in eventMarkerLogic.ts.
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { markerIndices, nextMarker, prevMarker } from '../gcode/lookup'
import type { GcodeEvent } from '../gcode/types'
import { projectStore } from '../store/projectStore'
import { uiStore } from '../store/uiStore'
import { viewerStore } from '../store/viewerStore'
import { layoutMarkers, placingSelection, seekIndex } from './eventMarkerLogic'

function onMarker(e: GcodeEvent): void {
  const { parse, seek } = viewerStore.getState()
  if (!parse) return
  seek(seekIndex(e, parse.moves.n))
  const spec = projectStore.getState().project?.spec
  const sel = spec ? placingSelection(e, spec.parts) : null
  if (sel) uiStore.getState().setSelection(sel)
}

/** Marker strip; sits directly above the range input and spans the same width. */
export default function EventMarkers() {
  const parse = useStore(viewerStore, (s) => s.parse)
  const groups = useMemo(() => (parse ? layoutMarkers(parse.events, parse.moves.n) : []), [parse])
  if (groups.length === 0) return <div className="event-markers" />

  return (
    <div className="event-markers" aria-label="Event markers">
      {groups.map((g) => (
        <div key={g.moveIndex} className="event-stack" style={{ left: `${g.pos * 100}%` }}>
          {g.items.map((m) => (
            <button
              key={m.event.line}
              type="button"
              className={`event-marker event-${m.event.kind}${m.flag ? ' event-flag' : ''}`}
              title={m.title}
              aria-label={m.label}
              onClick={() => onMarker(m.event)}
            >
              {m.flag && <span className="event-label">{m.label}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/** "◀ event" or "event ▶": jump to the adjacent marker Move index. */
export function EventNavButton({ dir }: { dir: -1 | 1 }) {
  const parse = useStore(viewerStore, (s) => s.parse)
  const playhead = useStore(viewerStore, (s) => Math.floor(s.playhead))
  const indices = useMemo(() => (parse ? markerIndices(parse.events).map((i) => Math.min(i, parse.moves.n - 1)) : []), [parse])
  const target = dir < 0 ? prevMarker(indices, playhead) : nextMarker(indices, playhead)
  const text = dir < 0 ? '◀ event' : 'event ▶'
  return (
    <button
      type="button"
      className="timeline-event-nav"
      disabled={target === null}
      onClick={() => target !== null && viewerStore.getState().seek(target)}
      title={dir < 0 ? 'Previous event' : 'Next event'}
    >
      {text}
    </button>
  )
}
