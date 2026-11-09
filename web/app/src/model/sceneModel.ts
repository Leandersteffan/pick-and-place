// Scene model for the Scene_View (design section 7, Requirements 4.2, 4.3, 4.6).
//
// Pure: Spec + offsets + space in, a flat list of SceneItems out. Mesh items carry
// the file name and a translation, not vertex data; the renderer moves the decoded
// mesh. In Bed_Space the tray mesh and pick points get the tray offset; the housing,
// part meshes, traces, tamps and prinjection points get the model offset. In
// Design_Space no offset is applied.
import type { BedOffsets, XY } from './project'
import type { Spec, TampType, TracePart, Vec3 } from './spec'

export type SceneSpace = 'design' | 'bed'

/** [dx, dy, 0] added to the decoded mesh. */
export type Translation = [number, number, number]

interface ItemBase {
  partIndex?: number
  partUid?: string
}

export interface MeshItem extends ItemBase {
  kind: 'housing' | 'tray' | 'partMesh'
  file: string
  translation: Translation
}

export interface TraceItem extends ItemBase {
  kind: 'trace'
  partIndex: number
  center: Vec3
  length: number
  width: number
  height: number
  /** rotation about Z of the box's length axis, atan2(dy, dx) */
  rotZ: number
}

export interface TampItem extends ItemBase {
  kind: 'tamp'
  partIndex: number
  tampIndex: number
  pos: Vec3
  tampType: TampType
}

export interface PrinjectionItem extends ItemBase {
  kind: 'prinjection'
  partIndex: number
  holeIndex: number
  pos: Vec3
}

export interface PickItem extends ItemBase {
  kind: 'pick'
  partIndex: number
  pos: Vec3
}

export type SceneItem = MeshItem | TraceItem | TampItem | PrinjectionItem | PickItem
export type SceneItemKind = SceneItem['kind']

export const TRAY_FILE = 'tray.stl'

function translation(o: XY): Translation {
  return [o[0], o[1], 0]
}

function shift(p: Vec3, o: XY): Vec3 {
  return { x: p.x + o[0], y: p.y + o[1], z: p.z }
}

/** Box spanning line_from to line_to; top face at line Z (C# CreateBoxFromLine extrudes -h). */
export function traceBox(part: TracePart): Pick<TraceItem, 'center' | 'length' | 'width' | 'height' | 'rotZ'> {
  const a = part.line_from
  const b = part.line_to
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lineZ = (a.z + b.z) / 2
  return {
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: lineZ - part.height / 2 },
    length: Math.hypot(dx, dy),
    width: part.width,
    height: part.height,
    rotZ: Math.atan2(dy, dx),
  }
}

export function buildSceneModel(
  spec: Spec,
  offsets: Pick<BedOffsets, 'tray' | 'model'>,
  space: SceneSpace,
  partUids?: readonly string[],
): SceneItem[] {
  const zero: XY = [0, 0]
  const tray: XY = space === 'bed' ? offsets.tray : zero
  const model: XY = space === 'bed' ? offsets.model : zero

  const items: SceneItem[] = [
    { kind: 'housing', file: spec.housing, translation: translation(model) },
    { kind: 'tray', file: TRAY_FILE, translation: translation(tray) },
  ]

  spec.parts.forEach((part, partIndex) => {
    const uid = partUids?.[partIndex]
    const ref: { partIndex: number; partUid?: string } = uid === undefined ? { partIndex } : { partIndex, partUid: uid }

    if (part.type === 'pcb' || part.type === 'print') {
      items.push({ kind: 'partMesh', file: part.mesh, translation: translation(model), ...ref })
      part.prinjection?.forEach((h, holeIndex) => {
        items.push({ kind: 'prinjection', holeIndex, pos: shift(h, model), ...ref })
      })
    } else if (part.type === 'trace_cloth' || part.type === 'trace_braid') {
      const box = traceBox(part)
      items.push({ kind: 'trace', ...box, center: shift(box.center, model), ...ref })
    }

    part.tamps?.forEach((t, tampIndex) => {
      items.push({ kind: 'tamp', tampIndex, tampType: t.type, pos: shift(t, model), ...ref })
    })

    // Pick points are in the tray frame (tray_origin is (0,0,0) for v1 Specs).
    if (part.pick) items.push({ kind: 'pick', pos: shift(part.pick, tray), ...ref })
  })

  return items
}
