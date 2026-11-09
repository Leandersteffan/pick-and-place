// Synced gcode text pane (design section 6; Requirements 5.12, 9.1, 9.2, 9.3).
//
// A collapsible panel at the bottom of the right-hand aside. Rows are virtualised with
// @tanstack/react-virtual at a fixed 18 px, so only visible lines are in the DOM (9.1).
// The lines are decoded and split once per gcode bytes (gcodePaneLogic.linesForBytes).
//
// The playhead is followed imperatively: a store subscription schedules at most one
// requestAnimationFrame, which highlights the playhead's source line and scrolls it to the
// centre when it is not comfortably in view (9.2). A wheel, scrollbar drag, touch or key
// scroll pauses following for FOLLOW_PAUSE_MS; the "Follow" toggle turns it off. Clicking a
// row moves the playhead to the first Move at or after that line (9.3). Marker lines are
// tinted; the "N unhandled lines" chip jumps through the unhandled lines (5.12).
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore } from 'zustand'
import { firstMoveAtOrAfterLine } from '../gcode/lookup'
import type { ParseResult } from '../gcode/types'
import { projectStore } from '../store/projectStore'
import { GCODE_FILE, viewerStore } from '../store/viewerStore'
import {
  ROW_HEIGHT,
  followAllowed,
  lineClass,
  linesForBytes,
  markerLineTints,
  needsScroll,
  nextUnhandled,
  playheadLine,
  splitComment,
  unhandledLabel,
} from './gcodePaneLogic'

/** Unhandled lines listed in the chip's drop-down; the chip itself cycles through all of them. */
const UNHANDLED_LIST_MAX = 200

export default function GcodePane() {
  const hasProject = useStore(projectStore, (s) => s.project !== null)
  const bytes = useStore(projectStore, (s) => s.project?.files[GCODE_FILE])
  const parse = useStore(viewerStore, (s) => s.parse)
  const [open, setOpen] = useState(true)
  const [follow, setFollow] = useState(true)
  const lines = useMemo(() => (bytes ? linesForBytes(bytes) : null), [bytes])

  let hint: string | null = null
  if (!hasProject) hint = 'Open a project to see its gcode.'
  else if (!lines) hint = `This project has no ${GCODE_FILE}. Slice in Rhino or Regenerate to create it.`
  else if (lines.length === 0) hint = `${GCODE_FILE} is empty.`

  return (
    <section className={`gcode-pane${open ? ' is-open' : ''}`} aria-label="Gcode text">
      <header className="gcode-head">
        <button
          type="button"
          className="gcode-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={open ? 'Collapse the gcode pane' : 'Expand the gcode pane'}
        >
          {open ? '▾' : '▸'} <span className="side-title">Gcode</span>
        </button>
        {lines && lines.length > 0 && (
          <span className="gcode-count">{lines.length.toLocaleString('en-US')} lines</span>
        )}
        {open && lines && lines.length > 0 && (
          <label className="gcode-follow" title="Scroll the text with the playhead">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
          </label>
        )}
      </header>
      {open && hint && <p className="status-empty gcode-hint">{hint}</p>}
      {open && !hint && lines && <GcodeLines lines={lines} parse={parse} follow={follow} />}
    </section>
  )
}

interface LinesProps {
  lines: string[]
  /** May briefly belong to the previous bytes while the new file parses; lines are clamped. */
  parse: ParseResult | null
  follow: boolean
}

function GcodeLines({ lines, parse, follow }: LinesProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(follow)
  followRef.current = follow
  const lastUserScroll = useRef(-Infinity)
  const [activeLine, setActiveLine] = useState(0)
  const [focusLine, setFocusLine] = useState(0)
  const [listOpen, setListOpen] = useState(false)

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  const tints = useMemo(() => (parse ? markerLineTints(parse.events) : new Map<number, string>()), [parse])
  const unhandled = parse?.unhandled ?? []
  const unhandledSet = useMemo(() => new Set(parse?.unhandled ?? []), [parse])

  // Follow the playhead, at most once per animation frame.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = 0
      const s = viewerStore.getState()
      const line = s.parse ? playheadLine(s.parse.moves, s.playhead) : 0
      setActiveLine(line)
      if (line < 1 || line > lines.length) return
      if (!followAllowed(followRef.current, lastUserScroll.current, performance.now())) return
      scrollIntoBand(virtualizer, scrollRef.current, line - 1)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }
    schedule()
    const unsub = viewerStore.subscribe((s, prev) => {
      if (s.playhead !== prev.playhead || s.parse !== prev.parse) schedule()
    })
    return () => {
      unsub()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [virtualizer, lines])

  // Turning Follow back on snaps to the playhead right away.
  useEffect(() => {
    if (!follow) return
    lastUserScroll.current = -Infinity
    if (activeLine >= 1 && activeLine <= lines.length) scrollIntoBand(virtualizer, scrollRef.current, activeLine - 1)
    // Only on the toggle, not on every playhead line, so activeLine is not a dependency.
  }, [follow])

  const noteUserScroll = () => {
    lastUserScroll.current = performance.now()
  }

  const onRowClick = (line: number) => {
    const p = viewerStore.getState().parse
    if (!p || p.moves.n === 0) return
    lastUserScroll.current = -Infinity
    setFocusLine(0)
    viewerStore.getState().seek(firstMoveAtOrAfterLine(p, line))
  }

  const jumpToLine = (line: number) => {
    if (line < 1 || line > lines.length) return
    noteUserScroll() // keep the jumped-to line in view instead of snapping back
    setFocusLine(line)
    virtualizer.scrollToIndex(line - 1, { align: 'center' })
  }

  const onChip = () => {
    const next = nextUnhandled(unhandled, focusLine || activeLine)
    if (next !== null) jumpToLine(next)
  }

  const lnStyle = { '--ln-width': `${String(lines.length).length}ch` } as CSSProperties

  return (
    <>
      {unhandled.length > 0 && (
        <div className="gcode-unhandled">
          <button type="button" className="gcode-chip" onClick={onChip} title="Jump to the next unhandled line">
            {unhandledLabel(unhandled.length)}
          </button>
          <button
            type="button"
            className="gcode-chip gcode-chip-more"
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
            title="List the unhandled lines"
          >
            {listOpen ? '▴' : '▾'}
          </button>
          {listOpen && (
            <div className="gcode-unhandled-list">
              {unhandled.slice(0, UNHANDLED_LIST_MAX).map((line) => (
                <button
                  key={line}
                  type="button"
                  className={`gcode-unhandled-item${line === focusLine ? ' is-focus' : ''}`}
                  onClick={() => jumpToLine(line)}
                  title={lines[line - 1]}
                >
                  {line}
                </button>
              ))}
              {unhandled.length > UNHANDLED_LIST_MAX && (
                <span className="gcode-unhandled-rest">
                  +{(unhandled.length - UNHANDLED_LIST_MAX).toLocaleString('en-US')} more (use the chip)
                </span>
              )}
            </div>
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        className="gcode-scroll"
        style={lnStyle}
        tabIndex={0}
        onWheel={noteUserScroll}
        onTouchMove={noteUserScroll}
        onKeyDown={noteUserScroll}
        onPointerDown={(e) => {
          // The scroll container itself is the target only on its scrollbar.
          if (e.target === e.currentTarget) noteUserScroll()
        }}
      >
        <div className="gcode-sizer" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const line = item.index + 1
            const text = lines[item.index]
            const [code, comment] = splitComment(text)
            const tint = tints.get(line)
            let cls = 'gcode-row'
            if (line === activeLine) cls += ' is-active'
            if (line === focusLine) cls += ' is-focus'
            if (tint) cls += ' is-marker'
            if (unhandledSet.has(line)) cls += ' is-unhandled'
            const style: CSSProperties = { transform: `translateY(${item.start}px)` }
            if (tint) (style as Record<string, string>)['--marker-tint'] = tint
            return (
              <div key={item.key} className={cls} style={style} onClick={() => onRowClick(line)}>
                <span className="gcode-ln">{line}</span>
                <span className="gcode-text">
                  {code && <span className={lineClass(code)}>{code}</span>}
                  {comment && <span className="gc-comment">{comment}</span>}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

/** Scrolls row `index` to the centre unless it is already comfortably visible. */
function scrollIntoBand(v: Virtualizer<HTMLDivElement, Element>, el: HTMLDivElement | null, index: number): void {
  if (!el) return
  const first = Math.floor(el.scrollTop / ROW_HEIGHT)
  const last = Math.floor((el.scrollTop + el.clientHeight) / ROW_HEIGHT) - 1
  if (needsScroll(index, first, last)) v.scrollToIndex(index, { align: 'center' })
}
