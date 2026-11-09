// Playback loop (design section 6, "Playback"; Requirements 6.5, 6.6, 6.7).
//
// While viewerStore.playing is true, each requestAnimationFrame advances simTime by
// dt * speed and moves the playhead to the Move at that time. Pause stops the loop
// and keeps the playhead. The loop stops by itself at the end of the toolpath.
import { viewerStore } from '../store/viewerStore'
import { advance, startTime } from './playbackLogic'

let frame = 0
let lastMs: number | null = null

function tick(nowMs: number): void {
  const s = viewerStore.getState()
  if (!s.playing || !s.parse) {
    frame = 0
    return
  }
  const dt = lastMs === null ? 0 : (nowMs - lastMs) / 1000
  lastMs = nowMs
  const next = advance(s.parse.moves, s.parse.totalTime, s.simTime, dt, s.speed)
  s.setPlayState(next)
  if (next.done) {
    s.setPlaying(false)
    frame = 0
    return
  }
  frame = requestAnimationFrame(tick)
}

/** Start playing; at the end of the toolpath, restart from 0. */
export function play(): void {
  const s = viewerStore.getState()
  if (!s.parse || s.parse.moves.n === 0 || s.playing) return
  const t = startTime(s.parse.moves, s)
  if (t !== s.simTime) s.setPlayState(advance(s.parse.moves, s.parse.totalTime, t, 0, 0))
  s.setPlaying(true)
}

export function pause(): void {
  viewerStore.getState().setPlaying(false)
}

export function togglePlay(): void {
  if (viewerStore.getState().playing) pause()
  else play()
}

// Start or stop the rAF loop when `playing` flips (also when a new parse resets it).
viewerStore.subscribe((s, prev) => {
  if (s.playing === prev.playing) return
  if (s.playing && frame === 0) {
    lastMs = null
    frame = requestAnimationFrame(tick)
  } else if (!s.playing && frame !== 0) {
    cancelAnimationFrame(frame)
    frame = 0
  }
})
