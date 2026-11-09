// Spec v1 types. Mirrors web/schema/spec.v1.schema.json.

export interface Vec3 { x: number; y: number; z: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export type Overrides = Record<string, string | number | boolean>
/** 0 End, 1 TraceTrace, 2 TracePlug, 3 TracePCB */
export type TampType = 0 | 1 | 2 | 3
export interface Tamp extends Vec3 { type: TampType; overrides?: Overrides }
export interface Hole extends Vec3 { overrides?: Overrides }

export interface PartBase {
  place: Vec3
  pause_layer: number
  /** traygen write-back */
  pick?: Vec3
  overrides?: Overrides
  name?: string
  tamps?: Tamp[]
  /** traygen write-back */
  slot?: Rect
}

export interface TracePart extends PartBase {
  type: 'trace_cloth' | 'trace_braid'
  length: number
  width: number
  height: number
  horizontal: boolean
  /** extended ModelLine */
  line_from: Vec3
  line_to: Vec3
}

export interface PlugPart extends PartBase {
  type: 'plug'
  radius: number
  height: number
  slot_shape?: 'circle'
}

export interface ComponentPart extends PartBase {
  type: 'pcb' | 'print'
  size: Vec3
  bbox_center: Vec3
  bbox_min: Vec3
  tray_offset: number
  mesh: string
  prinjection?: Hole[]
  /** traygen write-back */
  pocket?: Rect
  /** traygen write-back */
  pocket_depth?: number
}

export type Part = TracePart | PlugPart | ComponentPart

export interface Spec {
  version: 1
  printer: string
  use_trace_braid: boolean
  housing: 'housing.3mf' | 'housing.stl'
  tray: 'generated'
  tray_spacing: number
  tray_origin: Vec3
  parts: Part[]
}
