// Temperature and fan track under the Timeline range (design section 6, Requirements 8.1 to 8.4).
// Same X mapping as the Event markers: the strip is inset by half a range thumb on each side and
// a Move sits at moveIndex / (n - 1) of the inner width. Path building lives in tempFanLogic.ts.
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useStore } from 'zustand'
import { valueAt } from '../gcode/tracks'
import { viewerStore } from '../store/viewerStore'
import {
  formatFan,
  formatTemp,
  pointsAttr,
  stepPoints,
  tempAxisMax,
  waitBounds,
  waitMarks,
  xOf,
  yOf,
} from './tempFanLogic'

const HEIGHT = 44
/** Space above the plot for wait labels. */
const PAD_TOP = 9

/** Tracks the element's content width in pixels. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.max(0, Math.floor(el.getBoundingClientRect().width)))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

export default function TempFanTrack() {
  const parse = useStore(viewerStore, (s) => s.parse)
  const playhead = useStore(viewerStore, (s) => Math.floor(s.playhead))
  const [ref, width] = useWidth<HTMLDivElement>()
  const plotH = HEIGHT - PAD_TOP

  const n = parse?.moves.n ?? 0
  const tempMax = useMemo(() => (parse ? tempAxisMax(parse.tempTrack, waitBounds(parse.events)) : 250), [parse])
  const tempPts = useMemo(
    () => (parse ? pointsAttr(stepPoints(parse.tempTrack, { n, width, height: plotH, yMax: tempMax })) : ''),
    [parse, n, width, plotH, tempMax],
  )
  const fanPts = useMemo(
    () => (parse ? pointsAttr(stepPoints(parse.fanTrack, { n, width, height: plotH, yMax: 1, before: 0 })) : ''),
    [parse, n, width, plotH],
  )
  const waits = useMemo(() => (parse ? waitMarks(parse.events, n, width) : []), [parse, n, width])

  if (!parse || n === 0) return <div className="tempfan" ref={ref} />

  const p = Math.min(Math.max(0, playhead), n - 1)
  const px = xOf(p, n, width)

  return (
    <div className="tempfan" ref={ref}>
      {width > 0 && (
        <svg
          className="tempfan-svg"
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`Nozzle temperature target (0 to ${tempMax} °C) and fan speed (0 to 100 %) over Moves`}
        >
          <g transform={`translate(0 ${PAD_TOP})`}>
            <line className="tempfan-axis" x1={0} x2={width} y1={plotH + 0.5} y2={plotH + 0.5} />
            {fanPts && <polyline className="tempfan-fan" points={fanPts} />}
            {tempPts && <polyline className="tempfan-temp" points={tempPts} />}
            {waits.map((w) => {
              const y = yOf(w.value, tempMax, plotH)
              return (
                <g key={w.line} className="tempfan-wait">
                  <title>{w.title}</title>
                  <circle cx={w.x} cy={y} r={2.5} />
                  {w.labelled && (
                    <text x={w.x} y={Math.max(-1, y - 4)} textAnchor="middle">
                      {w.label}
                    </text>
                  )}
                </g>
              )
            })}
            <line className="tempfan-playhead" x1={px} x2={px} y1={-PAD_TOP} y2={plotH} />
          </g>
          <text className="tempfan-tick" x={2} y={8}>
            {tempMax} °C
          </text>
          <text className="tempfan-tick tempfan-tick-fan" x={width - 2} y={8} textAnchor="end">
            fan 100 %
          </text>
        </svg>
      )}
    </div>
  )
}

/** Temperature target and fan speed at the playhead (Requirement 8.4). Sits in the Timeline row. */
export function TempFanReadout() {
  const parse = useStore(viewerStore, (s) => s.parse)
  const playhead = useStore(viewerStore, (s) => Math.floor(s.playhead))
  if (!parse || parse.moves.n === 0) return null
  const p = Math.min(Math.max(0, playhead), parse.moves.n - 1)
  return (
    <span className="tempfan-readout" aria-label="Temperature target and fan speed at the playhead">
      <span className="tempfan-readout-temp">{formatTemp(valueAt(parse.tempTrack, p))}</span>
      <span className="tempfan-readout-fan">fan {formatFan(valueAt(parse.fanTrack, p, 0))}</span>
    </span>
  )
}
