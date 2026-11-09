// Viewer store: the parsed gcode, the playhead and the toolpath filters.
// Playback (playback.ts) and the Timeline write the playhead and simTime here.
// Vanilla zustand, no React import.
//
// The gcode of the current Project is parsed when the Project changes, on a
// timer after the change, never during a React render.
import { createStore } from 'zustand/vanilla'
import { parseGcode } from '../gcode/parser'
import type { MoveType, ParseResult } from '../gcode/types'
import { MOVE_TYPES } from '../gcode/types'
import { DEFAULT_SPEED, SPEEDS, elapsedAt, seekState, type PlayState } from '../viewer/playbackLogic'
import { allTypesVisible, defaultLayerRanges, type LayerRange } from '../viewer/visibility'
import { projectStore } from './projectStore'

export const GCODE_FILE = 'combined_output.gcode'

export interface ViewerState {
  parse: ParseResult | null
  /** Move index, 0..n-1. Defaults to the last Move (whole toolpath). */
  playhead: number
  /** Fraction of Move `playhead` drawn; 1 = complete. Below 1 only while playing. */
  frac: number
  /** Indexed like MOVE_TYPES. */
  typeMask: boolean[]
  /** Indexed by segment index (1-based). */
  layerRanges: LayerRange[]
  /** Estimated seconds into the print; drives the playhead while playing. */
  simTime: number
  /** Playback speed factor, one of SPEEDS. */
  speed: number
  playing: boolean

  setParse(parse: ParseResult | null): void
  setPlayhead(playhead: number, frac?: number): void
  /** Timeline drag: Move `index` complete, simTime at its end. */
  seek(index: number): void
  setPlayState(s: PlayState): void
  setSpeed(speed: number): void
  setPlaying(playing: boolean): void
  setTypeVisible(type: MoveType, visible: boolean): void
  setLayerRange(segment: number, range: LayerRange): void
}

export const viewerStore = createStore<ViewerState>()((set, get) => ({
  parse: null,
  playhead: 0,
  frac: 1,
  typeMask: allTypesVisible(),
  layerRanges: [],
  simTime: 0,
  speed: DEFAULT_SPEED,
  playing: false,

  setParse(parse) {
    const last = parse ? Math.max(0, parse.moves.n - 1) : 0
    set({
      parse,
      playhead: last,
      frac: 1,
      simTime: parse ? elapsedAt(parse.moves, last, 1) : 0,
      playing: false,
      layerRanges: parse ? defaultLayerRanges(parse.segments) : [],
    })
  },
  setPlayhead(playhead, frac = 1) {
    set({ playhead, frac })
  },
  seek(index) {
    const parse = get().parse
    if (!parse) return
    set(seekState(parse.moves, index))
  },
  setPlayState(s) {
    set({ playhead: s.playhead, frac: s.frac, simTime: s.simTime })
  },
  setSpeed(speed) {
    if (SPEEDS.includes(speed)) set({ speed })
  },
  setPlaying(playing) {
    set({ playing })
  },
  setTypeVisible(type, visible) {
    const i = MOVE_TYPES.indexOf(type)
    if (i < 0) return
    set((s) => {
      const typeMask = s.typeMask.slice()
      typeMask[i] = visible
      return { typeMask }
    })
  },
  setLayerRange(segment, range) {
    set((s) => {
      const layerRanges = s.layerRanges.slice()
      layerRanges[segment] = range
      return { layerRanges }
    })
  },
}))

// Parse the Project gcode when its bytes change. Only the newest request applies.
let ticket = 0
let lastBytes: Uint8Array | undefined

function scheduleParse(bytes: Uint8Array | undefined): void {
  if (bytes === lastBytes) return
  lastBytes = bytes
  const mine = ++ticket
  if (!bytes) {
    viewerStore.getState().setParse(null)
    return
  }
  setTimeout(() => {
    if (mine !== ticket) return
    let parse: ParseResult | null = null
    try {
      parse = parseGcode(new TextDecoder().decode(bytes))
    } catch (err) {
      console.error('gcode parse failed', err)
    }
    if (mine === ticket) viewerStore.getState().setParse(parse)
  }, 0)
}

projectStore.subscribe((state) => scheduleParse(state.project?.files[GCODE_FILE]))
scheduleParse(projectStore.getState().project?.files[GCODE_FILE])
