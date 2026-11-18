"""Build spec.json parts from plain coordinates.

The numbers match the Grasshopper sliders used for the last cloth-trace print:
trace width 2.5 mm plus 0.15 mm on each side, trace height 0.2 mm, layer height 0.2 mm.
Pause layer is round(Z / layer height) + 1. The pipeline overwrites pick points.
"""

import math

LAYER_HEIGHT = 0.2
TRACE_HEIGHT = 0.2
TRACE_WIDTH = 2.8
END_OFFSET = 0.15
ANGLE_LIMIT = 0.01


def xyz(x, y, z):
    return {"x": float(x), "y": float(y), "z": float(z)}


def pause_layer(height):
    layer = int(round(float(height) / LAYER_HEIGHT)) + 1
    if layer < 1:
        return 1
    return layer


def _unit(x0, y0, x1, y1):
    dx = x1 - x0
    dy = y1 - y0
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return None
    return dx / length, dy / length, length


def _segment_gap(px, py, ax, ay, bx, by):
    abx = bx - ax
    aby = by - ay
    span = abx * abx + aby * aby
    if span < 1e-12:
        return None
    t = ((px - ax) * abx + (py - ay) * aby) / span
    if t < -0.01 or t > 1.01:
        return None
    return math.hypot(px - (ax + t * abx), py - (ay + t * aby))


def trace_record(ends, contacts):
    """One axis-aligned line. ends is (x0, y0, z0, x1, y1, z1). Returns (record, error)."""
    x0, y0, z0, x1, y1, z1 = ends
    direction = _unit(x0, y0, x1, y1)
    if direction is None:
        return None, "A trace is too short."
    ux, uy, length = direction
    horizontal = abs(uy) < ANGLE_LIMIT
    vertical = abs(ux) < ANGLE_LIMIT
    if not horizontal and not vertical:
        return None, "A trace is not horizontal or vertical."
    z = z0 if z0 >= z1 else z1
    for cx, cy, cz in contacts:
        if math.hypot(cx - x0, cy - y0) <= 0.5 or math.hypot(cx - x1, cy - y1) <= 0.5:
            raised = cz + TRACE_HEIGHT
            if raised > z:
                z = raised
    extension = TRACE_WIDTH / 2.0 + END_OFFSET
    from_x = x0 - ux * extension
    from_y = y0 - uy * extension
    to_x = x1 + ux * extension
    to_y = y1 + uy * extension
    tamps = []
    if length >= max(TRACE_WIDTH, 0.0):
        tamps.append({"x": float(x0), "y": float(y0), "z": float(z), "type": 0})
        tamps.append({"x": float(x1), "y": float(y1), "z": float(z), "type": 0})
    top = z
    bottom = z - TRACE_HEIGHT - 0.01
    for cx, cy, cz in contacts:
        if cz > top or cz < bottom:
            continue
        gap = _segment_gap(cx, cy, from_x, from_y, to_x, to_y)
        if gap is None or gap >= TRACE_WIDTH / 2.0 + 0.001:
            continue
        tamps.append({"x": float(cx), "y": float(cy), "z": float(z), "type": 3})
    contacts_only = [item for item in tamps if item["type"] != 0]
    kept = []
    for item in tamps:
        if item["type"] == 0 and any(
            math.hypot(item["x"] - other["x"], item["y"] - other["y"]) <= 3.0
            for other in contacts_only
        ):
            continue
        kept.append(item)
    record = {
        "type": "trace_cloth",
        "place": xyz((from_x + to_x) / 2.0, (from_y + to_y) / 2.0, z),
        "pause_layer": pause_layer(z),
        "length": math.hypot(to_x - from_x, to_y - from_y),
        "width": TRACE_WIDTH,
        "height": TRACE_HEIGHT,
        "horizontal": horizontal,
        "line_from": xyz(from_x, from_y, z),
        "line_to": xyz(to_x, to_y, z),
    }
    if kept:
        record["tamps"] = kept
    return record, None


def _inside(point, box, margin):
    x, y, z = point
    minx, miny, minz, maxx, maxy, maxz = box
    return (
        minx - margin <= x <= maxx + margin
        and miny - margin <= y <= maxy + margin
        and minz - margin <= z <= maxz + margin
    )


def component_record(kind, box, contacts):
    minx, miny, minz, maxx, maxy, maxz = box
    size_x = maxx - minx
    size_y = maxy - miny
    size_z = maxz - minz
    if size_x <= 0 or size_y <= 0:
        return None
    record = {
        "type": kind,
        "place": xyz((minx + maxx) / 2.0, (miny + maxy) / 2.0, maxz),
        "pause_layer": pause_layer(maxz),
        "size": xyz(size_x, size_y, size_z),
        "bbox_center": xyz((minx + maxx) / 2.0, (miny + maxy) / 2.0, (minz + maxz) / 2.0),
        "bbox_min": xyz(minx, miny, minz),
        "tray_offset": 2.0,
    }
    holes = []
    for point in contacts:
        if _inside(point, box, 0.5):
            holes.append(xyz(point[0], point[1], point[2]))
    if holes:
        record["prinjection"] = holes
    return record


def build_parts(traces, contacts, components):
    """traces are end tuples, components are (kind, box). Returns (parts, errors)."""
    parts = []
    errors = []
    for ends in traces:
        record, error = trace_record(ends, contacts)
        if error:
            errors.append(error)
            continue
        parts.append(record)
    for kind, box in components:
        record = component_record(kind, box, contacts)
        if record is None:
            errors.append("A component has no area.")
            continue
        parts.append(record)
    for index, record in enumerate(parts):
        if record["type"] in ("pcb", "print"):
            record["mesh"] = "part-{0}.stl".format(index)
    return parts, errors


def spec_document(parts):
    return {
        "version": 1,
        "printer": "snapmaker u1",
        "use_trace_braid": False,
        "housing": "housing.3mf",
        "tray": "generated",
        "tray_spacing": 3.0,
        "tray_origin": {"x": 0.0, "y": 0.0, "z": 0.0},
        "parts": parts,
    }
