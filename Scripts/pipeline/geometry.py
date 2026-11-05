"""Mesh measurements and the bed shift. STL and 3MF, no Rhino."""

import os
import re
import zipfile


_BED_MIN_X = 0.5
_BED_MIN_Y = 1.0
_BED_MAX_X = 270.5
_BED_MAX_Y = 271.0
_XY_WORD = re.compile(r"([XxYy])(-?(?:\d+\.?\d*|\.\d+))")
_STL_VERTEX = re.compile(
    r"vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)"
)


def _vertices(path):
    lower = path.lower()
    if lower.endswith(".stl"):
        return _stl_vertices(path)
    return _3mf_vertices(path)


def _3mf_vertices(path):
    archive = zipfile.ZipFile(path)
    text = ""
    for name in archive.namelist():
        if name.endswith(".model"):
            text += archive.read(name).decode("utf-8", "replace")
    found = re.findall(r'vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', text)
    return [(float(item[0]), float(item[1]), float(item[2])) for item in found]


def _stl_vertices(path):
    data = open(path, "rb").read()
    if data[:5].lower() == b"solid" and b"facet" in data[:4000].lower():
        text = data.decode("utf-8", "replace")
        found = _STL_VERTEX.findall(text)
        return [(float(item[0]), float(item[1]), float(item[2])) for item in found]
    if len(data) < 84:
        return []
    count = int.from_bytes(data[80:84], "little")
    verts = []
    offset = 84
    for _ in range(count):
        chunk = data[offset + 12:offset + 48]
        if len(chunk) < 36:
            break
        for index in range(0, 36, 12):
            import struct
            x, y, z = struct.unpack_from("<fff", chunk, index)
            verts.append((x, y, z))
        offset += 50
    return verts


def mesh_center(path):
    verts = _vertices(path)
    if not verts:
        return None
    xs = [item[0] for item in verts]
    ys = [item[1] for item in verts]
    return ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)


def mesh_bounds(path):
    verts = _vertices(path)
    if not verts:
        return None
    xs = [item[0] for item in verts]
    ys = [item[1] for item in verts]
    return (min(xs), min(ys), max(xs), max(ys))


def extrusion_center(path):
    xs = []
    ys = []
    in_object = False
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if "; printing object" in line:
                in_object = True
                continue
            if "; stop printing object" in line:
                in_object = False
                continue
            if not in_object or not line.startswith("G1"):
                continue
            xm = re.search(r"\bX(-?(?:\d+\.?\d*|\.\d+))", line)
            ym = re.search(r"\bY(-?(?:\d+\.?\d*|\.\d+))", line)
            em = re.search(r"\bE(-?(?:\d+\.?\d*|\.\d+))", line)
            if xm and ym and em and float(em.group(1)) > 0:
                xs.append(float(xm.group(1)))
                ys.append(float(ym.group(1)))
    if len(xs) < 4:
        return None
    return ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)


def slicer_shift(mesh_path, gcode_path):
    mesh = mesh_center(mesh_path)
    printed = extrusion_center(gcode_path)
    if mesh is None or printed is None:
        return None
    return (printed[0] - mesh[0], printed[1] - mesh[1])


def housing_clearance(tray_bounds, model_bounds, gap=10.0):
    """How far to move the housing in +Y so it clears the tray."""
    if not tray_bounds or not model_bounds:
        return 0.0
    x_apart = model_bounds[2] < tray_bounds[0] or tray_bounds[2] < model_bounds[0]
    if x_apart:
        return 0.0
    needed = tray_bounds[3] + gap - model_bounds[1]
    if needed > 0.0:
        return needed
    return 0.0


def shared_bed_shift(bounds):
    minx = min(item[0] for item in bounds)
    miny = min(item[1] for item in bounds)
    maxx = max(item[2] for item in bounds)
    maxy = max(item[3] for item in bounds)
    dx = _BED_MIN_X - minx if minx < _BED_MIN_X else 0.0
    dy = _BED_MIN_Y - miny if miny < _BED_MIN_Y else 0.0
    if maxx + dx > _BED_MAX_X:
        dx = _BED_MAX_X - maxx
    if maxy + dy > _BED_MAX_Y:
        dy = _BED_MAX_Y - maxy
    if minx + dx < _BED_MIN_X - 0.05 or miny + dy < _BED_MIN_Y - 0.05:
        return None
    if maxx + dx > _BED_MAX_X + 0.05 or maxy + dy > _BED_MAX_Y + 0.05:
        return None
    return (dx, dy)


def _shift_move_line(line, dx, dy):
    ending = ""
    body = line
    if body.endswith("\r\n"):
        body = body[:-2]
        ending = "\r\n"
    elif body.endswith("\n"):
        body = body[:-1]
        ending = "\n"
    if not re.match(r"[Gg]0*([0-3])(?!\d)", body.lstrip()):
        return line

    def repl(match):
        axis = match.group(1).upper()
        value = float(match.group(2)) + (dx if axis == "X" else dy)
        text = "{:.3f}".format(value).rstrip("0").rstrip(".")
        if text in ("", "-", "-0"):
            text = "0"
        return match.group(1) + text

    return _XY_WORD.sub(repl, body) + ending


def rewrite_bed_mesh(path, bounds, shift):
    minx = min(item[0] for item in bounds) + shift[0]
    miny = min(item[1] for item in bounds) + shift[1]
    maxx = max(item[2] for item in bounds) + shift[0]
    maxy = max(item[3] for item in bounds) + shift[1]
    pad = 2.0
    minx = max(_BED_MIN_X, minx - pad)
    miny = max(_BED_MIN_Y, miny - pad)
    maxx = min(_BED_MAX_X, maxx + pad)
    maxy = min(_BED_MAX_Y, maxy + pad)
    replacement = "mesh_min={:.3f},{:.3f} mesh_max={:.3f},{:.3f}".format(minx, miny, maxx, maxy)
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as handle:
        lines = handle.readlines()
    found = False
    for index, line in enumerate(lines):
        if line.startswith("BED_MESH_CALIBRATE"):
            lines[index] = re.sub(
                r"mesh_min=[-\d.]+,[-\d.]+ mesh_max=[-\d.]+,[-\d.]+",
                replacement,
                line,
                count=1,
            )
            found = True
            break
    if not found:
        return
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.writelines(lines)


def shift_layer_moves(path, shift):
    dx, dy = shift
    if abs(dx) < 0.01 and abs(dy) < 0.01:
        return
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as handle:
        lines = handle.readlines()
    start = next((i for i, line in enumerate(lines) if line.startswith(";LAYER_CHANGE")), None)
    if start is None:
        raise RuntimeError("No layer marker in " + os.path.basename(path))
    end = next((i for i in range(start, len(lines)) if lines[i].startswith(";TYPE:Custom")), len(lines))
    for index in range(start, end):
        lines[index] = _shift_move_line(lines[index], dx, dy)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.writelines(lines)
