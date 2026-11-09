// Timeline (design section 6; Requirements 6.3, 6.4, 6.5, 6.6, 6.7, 6.10).
// A range input over Move indices 0..n-1, play and pause, speed, and elapsed / total
// estimated time, with Event markers above the range and prev / next event buttons
// (EventMarkers.tsx, Requirement 7), and the temperature and fan track below it
// (TempFanTrack.tsx, Requirement 8). Only this small component re-renders per frame while playing; the
// 3D toolpath follows the store imperatively.
import type { ChangeEvent } from 'react'
import { useStore } from 'zustand'
import { viewerStore } from '../store/viewerStore'
import EventMarkers, { EventNavButton } from './EventMarkers'
import { togglePlay } from './playback'
import TempFanTrack, { TempFanReadout } from './TempFanTrack'
import { SPEEDS, elapsedAt, formatHms } from './playbackLogic'

export default function Timeline() {
  const parse = useStore(viewerStore, (s) => s.parse)
  const playhead = useStore(viewerStore, (s) => s.playhead)
  const frac = useStore(viewerStore, (s) => s.frac)
  const playing = useStore(viewerStore, (s) => s.playing)
  const speed = useStore(viewerStore, (s) => s.speed)

  if (!parse || parse.moves.n === 0) {
    return <div className="timeline timeline-empty">No gcode loaded</div>
  }

  const n = parse.moves.n
  const elapsed = elapsedAt(parse.moves, playhead, frac)
  const onSeek = (e: ChangeEvent<HTMLInputElement>) => viewerStore.getState().seek(Number(e.target.value))
  const onSpeed = (e: ChangeEvent<HTMLSelectElement>) => viewerStore.getState().setSpeed(Number(e.target.value))

  return (
    <div className="timeline">
      <EventNavButton dir={-1} />
      <button
        type="button"
        className="timeline-play"
        onClick={togglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <select className="timeline-speed" value={speed} onChange={onSpeed} aria-label="Playback speed">
        {SPEEDS.map((v) => (
          <option key={v} value={v}>
            {v}×
          </option>
        ))}
      </select>
      <EventNavButton dir={1} />
      <div className="timeline-track">
        <EventMarkers />
        <input
          className="timeline-range"
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={Math.floor(playhead)}
          onChange={onSeek}
          aria-label="Playhead"
        />
        <TempFanTrack />
      </div>
      <TempFanReadout />
      <span className="timeline-time" aria-label="Elapsed and total estimated time">
        {formatHms(elapsed)} / {formatHms(parse.totalTime)}
      </span>
      <span className="timeline-index">
        Move {Math.floor(playhead) + 1} / {n}
      </span>
    </div>
  )
}
