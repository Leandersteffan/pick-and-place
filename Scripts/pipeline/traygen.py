"""Build the tray the way the Grasshopper Tray class does.

Traces lie on the bed in a rectangular opening the length and width of the
trace. Plugs get a round opening through the same 0.4 mm sheet. Every LED,
PCB, or other placed part gets the same pocket: a block 0.5 mm shallower
than the part, then the part's own mesh cut out of it. The mesh is moved so
its bounding box sits on z=0 and is centered in the slot. Whatever solid is
left — side shelves, a deep middle, a different shape next time — is the
pocket. Pick points are written back onto the spec so the nozzle meets those
openings.
"""

import os
import re
import struct

_TRACE_DEPTH = 0.4
_MAX_COLUMN = 110.0
_PICK_TO_PLUG = 15.0
_PLUG_CLEARANCE = 0.25
_DEFAULT_SPACING = 3.0
_DEFAULT_PCB_OFFSET = 2.0


def _origin(spec):
    origin = spec.get("tray_origin") or {}
    return (
        float(origin.get("x", 0.0)),
        float(origin.get("y", 0.0)),
        float(origin.get("z", 0.0)),
    )


def _spacing(spec):
    return float(spec.get("tray_spacing", _DEFAULT_SPACING))


def _num(part, key):
    if key not in part or part[key] is None:
        return None
    return float(part[key])


def _along_line(part):
    start = part.get("line_from") or {}
    end = part.get("line_to") or {}
    place = part.get("place") or {}
    dx = float(end.get("x", 0.0)) - float(start.get("x", 0.0))
    dy = float(end.get("y", 0.0)) - float(start.get("y", 0.0))
    length = (dx * dx + dy * dy) ** 0.5
    if length < 1e-9:
        return 0.0, 0.0, 0.0
    ux, uy = dx / length, dy / length
    dist = (float(place.get("x", 0.0)) - float(start.get("x", 0.0))) * ux
    dist += (float(place.get("y", 0.0)) - float(start.get("y", 0.0))) * uy
    limit = _num(part, "length") or length
    dist = max(0.0, min(limit, dist))
    return dist, ux, uy


def _trace_pick(part, x0, y0, x1, y1, centre_x, centre_y):
    dist, ux, uy = _along_line(part)
    length = _num(part, "length")
    horizontal_slot = (x1 - x0) > (y1 - y0)
    points_left = ux < -0.5
    points_down = uy < -0.5
    if (horizontal_slot and points_left) or ((not horizontal_slot) and points_down):
        dist = length - dist
    if horizontal_slot:
        pick_x, pick_y = x0 + dist, centre_y
    else:
        pick_x, pick_y = centre_x, y0 + dist
    return {"x": pick_x, "y": pick_y, "z": _num(part, "height") or 0.2}


def _slot_record(x0, y0, x1, y1):
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1}


def _grouped(items, key_fn):
    groups = []
    index = {}
    for item in items:
        key = key_fn(item)
        if key not in index:
            index[key] = []
            groups.append((key, index[key]))
        index[key].append(item)
    groups.sort(key=lambda pair: pair[0])
    return [items for _key, items in groups]


def layout_tray(spec):
    """Assign each part a slot and a pick point. Same rules as the C# Tray class."""
    ox, oy, _oz = _origin(spec)
    spacing = _spacing(spec)
    parts = spec["parts"]
    traces = [part for part in parts if part.get("length") is not None and part.get("width") is not None]
    plugs = [part for part in parts if part.get("radius") is not None and part.get("length") is None]
    pockets = [part for part in parts if part.get("type") in ("pcb", "print") and part.get("size")]
    missing = [
        part for part in parts
        if part.get("type", "").startswith("trace") and part not in traces
    ]
    if missing:
        raise RuntimeError(
            "A trace has no length or width in spec.json. Press Slice again so Grasshopper exports them."
        )

    def width_of(part):
        return _num(part, "width")

    def height_of(part):
        return _num(part, "height") or 0.0

    h_groups = _grouped(
        [part for part in traces if part.get("horizontal")],
        lambda part: (width_of(part), height_of(part)),
    )
    v_groups = _grouped(
        [part for part in traces if not part.get("horizontal")],
        lambda part: (width_of(part), height_of(part)),
    )

    h_columns = []
    current_h = []
    h_column_x = ox + spacing
    h_column_max = 0.0
    current_y = oy + spacing
    h_count = 0
    h_required_height = spacing * 2
    for group in h_groups:
        group_width = width_of(group[0])
        for trace in group:
            if h_count == 0:
                h_count = 1
            elif current_y + group_width + spacing - oy > _MAX_COLUMN:
                if current_h:
                    h_columns.append(current_h)
                current_h = []
                h_column_x += h_column_max + spacing
                h_column_max = 0.0
                current_y = oy + spacing
                h_count += 1
            length = _num(trace, "length")
            if length > h_column_max:
                h_column_max = length
            x0, y0 = h_column_x, current_y
            x1, y1 = x0 + length, y0 + group_width
            trace["slot"] = _slot_record(x0, y0, x1, y1)
            centre_x, centre_y = (x0 + x1) / 2.0, (y0 + y1) / 2.0
            trace["pick"] = _trace_pick(trace, x0, y0, x1, y1, centre_x, centre_y)
            current_h.append(trace["slot"])
            current_y += group_width + spacing
            required = current_y + spacing - oy
            if required > h_required_height:
                h_required_height = required
    if current_h:
        h_columns.append(current_h)

    h_right = ox
    if h_count > 0:
        h_right = h_column_x + h_column_max

    v_columns = []
    current_x = h_right + spacing
    for group in v_groups:
        group_width = width_of(group[0])
        for trace in group:
            length = _num(trace, "length")
            x0, y0 = current_x, oy + spacing
            x1, y1 = x0 + group_width, y0 + length
            trace["slot"] = _slot_record(x0, y0, x1, y1)
            centre_x, centre_y = (x0 + x1) / 2.0, (y0 + y1) / 2.0
            trace["pick"] = _trace_pick(trace, x0, y0, x1, y1, centre_x, centre_y)
            v_columns.append([trace["slot"]])
            current_x += group_width + spacing
    v_right = current_x

    if traces:
        max_pick_x = max(part["pick"]["x"] for part in traces)
        if v_right < max_pick_x + _PICK_TO_PLUG:
            v_right = max_pick_x + _PICK_TO_PLUG

    plug_slots = []
    plug_right = v_right
    if plugs:
        target_cols = max(1, int(round((len(plugs) * 3.0) ** 0.5)))
        plug_groups = _grouped(plugs, lambda part: (_num(part, "radius"), height_of(part)))
        plug_x = v_right
        plug_y = oy + spacing
        column = 0
        for group in plug_groups:
            radius = _num(group[0], "radius")
            step = radius * 2.0 + spacing
            for plug in group:
                if column >= target_cols:
                    plug_x = v_right
                    plug_y += step
                    column = 0
                centre_x = plug_x + radius
                centre_y = plug_y + radius
                opening = radius + _PLUG_CLEARANCE
                plug["slot"] = _slot_record(
                    centre_x - opening, centre_y - opening, centre_x + opening, centre_y + opening
                )
                plug["pick"] = {"x": centre_x, "y": centre_y, "z": height_of(plug)}
                plug["slot_shape"] = "circle"
                plug_slots.append(plug["slot"])
                plug_x += step
                column += 1
                if plug_x > plug_right:
                    plug_right = plug_x

    pcb_columns = []
    current_pcb = []
    pcb_x = plug_right + spacing
    pcb_y = oy + spacing
    pcb_column_width = 0.0
    for pocket in pockets:
        size = pocket["size"]
        offset = _num(pocket, "tray_offset")
        if offset is None:
            offset = _DEFAULT_PCB_OFFSET
        pocket_w = float(size["x"]) + 2.0 * offset
        pocket_h = float(size["y"]) + 2.0 * offset
        if pcb_y + pocket_h + spacing - oy > _MAX_COLUMN and pcb_y > oy + spacing:
            if current_pcb:
                pcb_columns.append(current_pcb)
            current_pcb = []
            pcb_x += pcb_column_width + spacing
            pcb_y = oy + spacing
            pcb_column_width = 0.0
        if pocket_w > pcb_column_width:
            pcb_column_width = pocket_w
        x0, y0 = pcb_x, pcb_y
        x1, y1 = x0 + pocket_w, y0 + pocket_h
        pocket["slot"] = _slot_record(x0, y0, x1, y1)
        inner_x0 = x0 + offset
        inner_y0 = y0 + offset
        pocket["pocket"] = _slot_record(
            inner_x0, inner_y0, inner_x0 + float(size["x"]), inner_y0 + float(size["y"])
        )
        depth = float(size["z"]) - 0.5
        pocket["pocket_depth"] = depth if depth > _TRACE_DEPTH else _TRACE_DEPTH
        centre_x = x0 + pocket_w / 2.0
        centre_y = y0 + pocket_h / 2.0
        place = pocket.get("place") or {}
        center = pocket.get("bbox_center")
        if center:
            shift_x = float(place.get("x", 0.0)) - float(center["x"])
            shift_y = float(place.get("y", 0.0)) - float(center["y"])
        else:
            shift_x = 0.0
            shift_y = 0.0
        pocket["pick"] = {
            "x": centre_x + shift_x,
            "y": centre_y + shift_y,
            "z": float(size["z"]) + 1.0,
        }
        current_pcb.append(pocket["slot"])
        pcb_y += pocket_h + spacing
    if current_pcb:
        pcb_columns.append(current_pcb)

    columns = []
    columns.extend(h_columns)
    columns.extend(v_columns)
    if plug_slots:
        columns.append(plug_slots)
    columns.extend(pcb_columns)
    return columns


def _padded_box(slots, spacing):
    x0 = min(slot["x0"] for slot in slots) - spacing
    y0 = min(slot["y0"] for slot in slots) - spacing
    x1 = max(slot["x1"] for slot in slots) + spacing
    y1 = max(slot["y1"] for slot in slots) + spacing
    return (x0, y0, x1, y1)


def _add_rect(existing, rect):
    pieces = []
    for old in existing:
        pieces.extend(_subtract_rect(old, rect))
    pieces.append(rect)
    return pieces


def _subtract_rect(rect, hole):
    ix0 = max(rect[0], hole[0])
    iy0 = max(rect[1], hole[1])
    ix1 = min(rect[2], hole[2])
    iy1 = min(rect[3], hole[3])
    if ix0 >= ix1 - 1e-9 or iy0 >= iy1 - 1e-9:
        return [rect]
    pieces = []
    if rect[0] < ix0 - 1e-9:
        pieces.append((rect[0], rect[1], ix0, rect[3]))
    if ix1 < rect[2] - 1e-9:
        pieces.append((ix1, rect[1], rect[2], rect[3]))
    if rect[1] < iy0 - 1e-9:
        pieces.append((ix0, rect[1], ix1, iy0))
    if iy1 < rect[3] - 1e-9:
        pieces.append((ix0, iy1, ix1, rect[3]))
    return [piece for piece in pieces if piece[2] - piece[0] > 1e-6 and piece[3] - piece[1] > 1e-6]


def _union_rects(rects):
    merged = []
    for rect in rects:
        merged = _add_rect(merged, rect)
    return merged


def _plate_rects(spec, columns):
    spacing = _spacing(spec)
    boxes = [_padded_box(column, spacing) for column in columns if column]
    boxes.sort(key=lambda box: box[0])
    bridged = []
    for index, box in enumerate(boxes):
        if index < len(boxes) - 1 and box[2] < boxes[index + 1][0] + 0.1:
            box = (box[0], box[1], boxes[index + 1][0] + 0.1, box[3])
        bridged.append(box)
    plate = _union_rects(bridged)
    holes = []
    for part in spec["parts"]:
        slot = part.get("slot")
        if not slot:
            continue
        if part.get("pocket"):
            holes.append((slot["x0"], slot["y0"], slot["x1"], slot["y1"]))
        elif part.get("length") is not None or part.get("radius") is not None:
            holes.append((slot["x0"], slot["y0"], slot["x1"], slot["y1"]))
    for hole in holes:
        remaining = []
        for rect in plate:
            remaining.extend(_subtract_rect(rect, hole))
        plate = remaining
    return plate


def _manifolds():
    try:
        import numpy as np
        from manifold3d import Manifold, Mesh
    except ImportError as error:
        raise RuntimeError(
            "Cutting a component pocket needs manifold3d. Install it with: py -3 -m pip install manifold3d"
        ) from error
    return np, Manifold, Mesh


def _triangles_from_stl(path):
    raw = open(path, "rb").read()
    if raw[:5].lower() == b"solid" and b"facet" in raw[:4096]:
        text = raw.decode("utf-8", errors="replace")
        triples = re.findall(
            r"vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)",
            text,
        )
        points = [(float(a), float(b), float(c)) for a, b, c in triples]
        return [points[index:index + 3] for index in range(0, len(points) - 2, 3)]
    if len(raw) < 84:
        return []
    count = struct.unpack_from("<I", raw, 80)[0]
    triangles = []
    offset = 84
    for _ in range(count):
        if offset + 50 > len(raw):
            break
        numbers = struct.unpack_from("<12f", raw, offset)
        triangles.append([numbers[3:6], numbers[6:9], numbers[9:12]])
        offset += 50
    return triangles


def _mesh_from_triangles(triangles):
    """Weld vertices that land on the same point. An STL stores each triangle alone."""
    np, _manifold, mesh_type = _manifolds()
    index = {}
    verts = []
    faces = []
    for tri in triangles:
        face = []
        for point in tri:
            key = (round(float(point[0]), 4), round(float(point[1]), 4), round(float(point[2]), 4))
            slot = index.get(key)
            if slot is None:
                slot = len(verts)
                index[key] = slot
                verts.append(key)
            face.append(slot)
        if len(set(face)) == 3:
            faces.append(face)
    if not faces:
        raise RuntimeError("status empty mesh")
    faces.extend(_caps_for_open_edges(faces))
    return mesh_type(
        vert_properties=np.ascontiguousarray(verts, dtype=np.float32),
        tri_verts=np.ascontiguousarray(faces, dtype=np.uint32),
    )


def _caps_for_open_edges(faces):
    """Close the small gaps a mesh export leaves in a component shell.

    Grasshopper subtracts the component brep. The exported triangles are that
    same shape, sometimes with a few open edges. Each open loop is capped so
    the tray cut can subtract the component.
    """
    counts = {}
    for a, b, c in faces:
        for u, v in ((a, b), (b, c), (c, a)):
            key = (u, v) if u < v else (v, u)
            counts[key] = counts.get(key, 0) + 1
    nxt = {}
    for a, b, c in faces:
        for u, v in ((a, b), (b, c), (c, a)):
            key = (u, v) if u < v else (v, u)
            if counts[key] == 1:
                nxt[u] = v
    seen = set()
    caps = []
    for start in list(nxt):
        if start in seen:
            continue
        loop = []
        cur = start
        while cur not in seen and cur in nxt:
            seen.add(cur)
            loop.append(cur)
            cur = nxt[cur]
            if cur == start:
                break
        if cur != start or len(loop) < 3:
            continue
        origin = loop[0]
        for index in range(len(loop) - 1, 1, -1):
            caps.append((origin, loop[index], loop[index - 1]))
    return caps


def _solid_from_mesh(mesh):
    _np, manifold, mesh_type = _manifolds()
    solid = manifold(mesh)
    status = str(solid.status())
    if "NoError" not in status:
        flipped = mesh_type(
            vert_properties=_np.ascontiguousarray(mesh.vert_properties[:, :3], dtype=_np.float32),
            tri_verts=_np.ascontiguousarray(mesh.tri_verts[:, ::-1], dtype=_np.uint32),
        )
        solid = manifold(flipped)
        status = str(solid.status())
    if "NoError" not in status or solid.is_empty():
        raise RuntimeError("status " + status)
    return solid


def _part_label(part, index):
    name = part.get("name") or part.get("type") or "component"
    return "{0} (part {1})".format(name, index + 1)


def _component_solid(part, spec_dir, index):
    """Move this part's own mesh onto its slot, bottom on z=0, then return it."""
    mesh_name = part.get("mesh")
    if not mesh_name:
        raise RuntimeError(
            _part_label(part, index)
            + " has no mesh. The pocket is the slot block minus that component, so Slice has to export the component mesh."
        )
    mesh_path = mesh_name if os.path.isabs(mesh_name) else os.path.join(spec_dir, mesh_name)
    if not os.path.isfile(mesh_path):
        raise RuntimeError("Component mesh is missing: " + mesh_path)
    triangles = _triangles_from_stl(mesh_path)
    if not triangles:
        raise RuntimeError("Component mesh is empty: " + mesh_path)
    try:
        solid = _solid_from_mesh(_mesh_from_triangles(triangles))
    except RuntimeError as error:
        raise RuntimeError(
            _part_label(part, index)
            + " is not a closed solid, so its pocket was not cut. "
            + str(error)
        ) from error

    center = part.get("bbox_center") or {}
    size = part.get("size") or {}
    box_min = part.get("bbox_min") or {}
    if "z" in box_min:
        min_z = float(box_min["z"])
    else:
        min_z = float(center.get("z", 0.0)) - float(size.get("z", 0.0)) / 2.0
    slot = part["slot"]
    centre_x = (float(slot["x0"]) + float(slot["x1"])) / 2.0
    centre_y = (float(slot["y0"]) + float(slot["y1"])) / 2.0
    solid = solid.translate([
        centre_x - float(center.get("x", 0.0)),
        centre_y - float(center.get("y", 0.0)),
        -min_z,
    ])
    rotation = (part.get("overrides") or {}).get("tray_rotation")
    if rotation not in (None, "", 0, 0.0):
        degrees = float(rotation)
        if abs(degrees) > 0.001:
            solid = solid.translate([-centre_x, -centre_y, 0.0])
            solid = solid.rotate([0.0, 0.0, degrees])
            solid = solid.translate([centre_x, centre_y, 0.0])
    return solid


def _cube(x0, y0, z0, x1, y1, z1):
    _np, manifold, _mesh_type = _manifolds()
    return manifold.cube([x1 - x0, y1 - y0, z1 - z0], True).translate([
        (x0 + x1) / 2.0,
        (y0 + y1) / 2.0,
        (z0 + z1) / 2.0,
    ])


def _write_solid(solid, path):
    mesh = solid.to_mesh()
    verts = mesh.vert_properties
    faces = mesh.tri_verts
    folder = os.path.dirname(path)
    if folder and not os.path.isdir(folder):
        os.makedirs(folder)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("solid tray\n")
        for face in faces:
            a = verts[int(face[0])]
            b = verts[int(face[1])]
            c = verts[int(face[2])]
            ux, uy, uz = float(b[0] - a[0]), float(b[1] - a[1]), float(b[2] - a[2])
            vx, vy, vz = float(c[0] - a[0]), float(c[1] - a[1]), float(c[2] - a[2])
            handle.write("  facet normal {0} {1} {2}\n".format(
                uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            ))
            handle.write("    outer loop\n")
            for point in (a, b, c):
                handle.write("      vertex {0} {1} {2}\n".format(float(point[0]), float(point[1]), float(point[2])))
            handle.write("    endloop\n")
            handle.write("  endfacet\n")
        handle.write("endsolid tray\n")


def write_tray(spec, stl_path):
    columns = layout_tray(spec)
    if not columns:
        raise RuntimeError("The spec has no parts, so there is nothing to put in a tray.")
    _np, _manifold, _mesh_type = _manifolds()
    tray = None
    for x0, y0, x1, y1 in _plate_rects(spec, columns):
        piece = _cube(x0, y0, 0.0, x1, y1, _TRACE_DEPTH)
        tray = piece if tray is None else tray + piece
    spec_dir = os.path.dirname(os.path.abspath(stl_path))
    for index, part in enumerate(spec["parts"]):
        if not part.get("pocket"):
            continue
        slot = part["slot"]
        depth = float(part.get("pocket_depth", _TRACE_DEPTH))
        block = _cube(float(slot["x0"]), float(slot["y0"]), 0.0, float(slot["x1"]), float(slot["y1"]), depth)
        tray = block if tray is None else tray + block
        tray = tray - _component_solid(part, spec_dir, index)
    status = str(tray.status())
    if tray is None or "NoError" not in status or tray.is_empty():
        raise RuntimeError("The tray boolean failed (" + status + ").")
    _write_solid(tray, stl_path)
    return stl_path


def ensure_pick_points(spec, housing_bounds):
    """Kept so older callers still work. The tray layout assigns the real pick points."""
    del housing_bounds
    layout_tray(spec)
