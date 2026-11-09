// Toolpath legend and filters (design section 6; Requirements 6.2, 6.8, 6.9).
// One toggle per Move_Type with its colour, and a min / max layer slider per Segment.
// Writes to viewerStore only; Toolpath.tsx turns that into shader uniforms.
import { useStore } from 'zustand'
import { uiStore } from '../store/uiStore'
import { viewerStore } from '../store/viewerStore'
import { LEGEND } from './toolpathGeometry'
import { segmentLabel, withLayerBound } from './visibility'

export default function Legend() {
  const parse = useStore(viewerStore, (s) => s.parse)
  const typeMask = useStore(viewerStore, (s) => s.typeMask)
  const layerRanges = useStore(viewerStore, (s) => s.layerRanges)
  const space = useStore(uiStore, (s) => s.space)

  if (!parse || space !== 'bed') return null

  return (
    <div className="scene-overlay toolpath-legend" role="group" aria-label="Toolpath filters">
      <div className="legend-types">
        {LEGEND.map((row, i) => (
          <label key={row.type} className="vis-toggle legend-row">
            <input
              type="checkbox"
              checked={typeMask[i] ?? true}
              onChange={(e) => viewerStore.getState().setTypeVisible(row.type, e.target.checked)}
            />
            <span className="legend-swatch" style={{ background: row.color }} />
            {row.label}
          </label>
        ))}
      </div>
      {parse.segments.map((seg) => {
        const range = layerRanges[seg.index] ?? [0, seg.layerCount]
        const label = segmentLabel(seg.index)
        const setBound = (bound: 0 | 1, value: number) =>
          viewerStore.getState().setLayerRange(seg.index, withLayerBound(range, bound, value, seg.layerCount))
        return (
          <div key={seg.index} className="legend-layers">
            <span className="legend-layers-label">{label}</span>
            <input
              type="range"
              min={0}
              max={seg.layerCount}
              step={1}
              value={range[0]}
              onChange={(e) => setBound(0, Number(e.target.value))}
              aria-label={`${label} lowest layer`}
            />
            <input
              type="range"
              min={0}
              max={seg.layerCount}
              step={1}
              value={range[1]}
              onChange={(e) => setBound(1, Number(e.target.value))}
              aria-label={`${label} highest layer`}
            />
            <span className="legend-layers-value">
              {range[0]}–{range[1]}
            </span>
          </div>
        )
      })}
    </div>
  )
}
