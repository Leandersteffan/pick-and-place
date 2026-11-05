import subprocess
import os
import shutil
import re
import sys
import zipfile
import json
import Rhino
import System


# Paths are resolved when this script runs.
# Project folder: the folder that contains the Grasshopper file, if Scripts and resources sit beside it.
# Override: the PROJECT ROOT panel, only when this file is saved somewhere else.
# Slicer: PrusaSlicer for the Prusa machines, OrcaSlicer for the Snapmaker U1.
# The PRUSASLICER panel can point at either exe. An empty panel uses the normal install folder.
XL_WIPE_LOCATION = (225, -8, 3)
MINI_WIPE_LOCATION = (150, -3, 3)
U1_WIPE_LOCATION = (220, 15, 3)
PART_START_Z_HOP = 30.0
PART_START_EXTRA_PRIME = 0.25
PLACE_HOVER_DWELL_TIME_MS = 0
SLICER_PATH = ""
MODULE_PATH = ""


class _ShiftedPoint(object):
    def __init__(self, x, y, z):
        self.X = x
        self.Y = y
        self.Z = z


def _moved(pt, shift):
    return _ShiftedPoint(float(pt.X) + shift[0], float(pt.Y) + shift[1], float(pt.Z))


def _mesh_center(path):
    archive = zipfile.ZipFile(path)
    text = ""
    for name in archive.namelist():
        if name.endswith(".model"):
            text += archive.read(name).decode("utf-8", "replace")
    verts = re.findall(r'vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', text)
    if not verts:
        return None
    xs = [float(v[0]) for v in verts]
    ys = [float(v[1]) for v in verts]
    return ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)


def _extrusion_center(path):
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


def _slicer_shift(mesh_path, gcode_path):
    mesh = _mesh_center(mesh_path)
    printed = _extrusion_center(gcode_path)
    if mesh is None or printed is None:
        return None
    return (printed[0] - mesh[0], printed[1] - mesh[1])


def _mesh_bounds(path):
    archive = zipfile.ZipFile(path)
    text = ""
    for name in archive.namelist():
        if name.endswith(".model"):
            text += archive.read(name).decode("utf-8", "replace")
    verts = re.findall(r'vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', text)
    if not verts:
        return None
    xs = [float(v[0]) for v in verts]
    ys = [float(v[1]) for v in verts]
    return (min(xs), min(ys), max(xs), max(ys))


# Snapmaker U1 printable area. A shared nudge keeps the Rhino gap and stays on the bed.
_BED_MIN_X = 0.5
_BED_MIN_Y = 1.0
_BED_MAX_X = 270.5
_BED_MAX_Y = 271.0
_XY_WORD = re.compile(r"([XxYy])(-?(?:\d+\.?\d*|\.\d+))")


def _shared_bed_shift(bounds):
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


def _rewrite_bed_mesh(path, bounds, shift):
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


def _shift_layer_moves(path, shift):
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


def _as_text(value):
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        if not value:
            return ""
        value = value[0]
    return str(value).strip().strip('"')


def _is_project(folder):
    if not folder or not os.path.isdir(folder):
        return False
    return os.path.isdir(os.path.join(folder, "Scripts")) and os.path.isdir(os.path.join(folder, "resources"))


def _project_candidates():
    found = []
    try:
        doc = ghenv.Component.OnPingDocument()
        file_path = doc.FilePath if doc is not None else ""
    except Exception:
        file_path = ""
    if not file_path:
        return found
    folder = os.path.dirname(file_path)
    parent = os.path.dirname(folder)
    found.extend([
        folder,
        parent,
        os.path.join(folder, "Designer"),
        os.path.join(folder, "Designer", "Designer"),
        os.path.join(parent, "Designer"),
        os.path.join(parent, "Designer", "Designer"),
    ])
    return found


def resolve_project_root(path_input):
    typed = _as_text(path_input)
    if typed and os.path.isfile(typed):
        typed = os.path.dirname(typed)
    if _is_project(typed):
        return typed
    for candidate in _project_candidates():
        if _is_project(candidate):
            return candidate
    print("Project folder not found. Save this Grasshopper file inside the Designer folder (next to Scripts and resources), or paste that folder into the PROJECT ROOT panel.")
    return None


def resolve_slicer(slicer_input):
    typed = _as_text(slicer_input)
    if typed and os.path.isfile(typed):
        return typed
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    defaults = [
        os.path.join(program_files, "Prusa3D", "PrusaSlicer", "prusa-slicer-console.exe"),
        r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe",
    ]
    for candidate in defaults:
        if candidate and os.path.isfile(candidate):
            return candidate
    print("PrusaSlicer was not found. Install it, or paste the full path of prusa-slicer-console.exe into the PRUSASLICER panel.")
    return None


def resolve_orca(slicer_input):
    typed = _as_text(slicer_input)
    if typed and os.path.isfile(typed) and os.path.basename(typed).lower().startswith("orca-slicer"):
        return typed
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    defaults = [
        os.path.join(program_files, "OrcaSlicer", "orca-slicer.exe"),
        r"C:\Program Files\OrcaSlicer\orca-slicer.exe",
    ]
    for candidate in defaults:
        if candidate and os.path.isfile(candidate):
            return candidate
    print("OrcaSlicer was not found. Install it, or paste the full path of orca-slicer.exe into the PRUSASLICER panel.")
    return None


def _is_u1(printer_name):
    return "u1" in printer_name or "snapmaker" in printer_name

# --- PICK AND PLACE CONFIGURATION ---
CONFIG = {
    'trace_braid': {
        # Pick parameters
        'pick_z_offset': -0.06,          # Z offset below pick point (mm)
        'pick_pre_extrude_amount': 1.0,  # Pre-extrusion before descending to pick (mm)
        'pick_extrude_amount': 0.5,      # Extrusion during pick (mm)
        'pick_extrude_feedrate': 100,    # Feedrate during pick extrusion (mm/min)
        'pick_cool_temp': 160,           # Temperature to cool to for grabbing (°C)
        
        # Place parameters
        'place_z_offset': -0.4,          # Final Z offset below place point (mm)
        'place_heat_temp': 210,          # Temperature to heat to for release (°C)
        'place_preheat_height': 0,       # Height above place point to pre-heat (mm) - 0 means at place point
        'place_dwell_time': 1000,        # Dwell time after placement (ms)
        
        # Movement feedrates
        'travel_feedrate': 6000,         # XY travel speed (mm/min)
        'z_lift_feedrate': 1000,         # Z lift speed (mm/min)
        'place_feedrate': 300,           # Z approach speed for placement (mm/min)
    },
    'trace_cloth': {
        # Pick parameters
        'pick_z_offset': -0.3,          # Z offset below pick point (mm)
        'pick_pre_extrude_amount': 1.0,  # Pre-extrusion before descending to pick (mm)
        'pick_extrude_amount': 0,      # Extrusion during pick (mm)
        'pick_extrude_feedrate': 100,    # Feedrate during pick extrusion (mm/min)
        'pick_cool_temp': 180,           # Temperature to cool to for grabbing (°C)
        
        # Place parameters
        'place_z_offset': -0.3,          # Final Z offset below place point (mm)
        'place_heat_temp': 210,          # Temperature to heat to for release (°C)
        'place_preheat_height': 0,       # Height above place point to pre-heat (mm) - 0 means at place point
        'place_dwell_time': 1000,        # Dwell time after placement (ms)
        
        # Movement feedrates
        'travel_feedrate': 6000,         # XY travel speed (mm/min)
        'z_lift_feedrate': 1000,         # Z lift speed (mm/min)
        'place_feedrate': 300,           # Z approach speed for placement (mm/min)
    },
    'plug': {
        # Pick parameters
        'pick_z_offset': -0.65,          # Z offset below pick point (mm)
        'pick_extrude_amount': 1.8,      # Extrusion during pick (mm)
        'pick_extrude_feedrate': 100,    # Feedrate during pick extrusion (mm/min)
        'pick_cool_temp': 140,           # Temperature to cool to for grabbing (°C)
        
        # Place parameters
        'place_z_offset': -1.4,          # Final Z offset below place point (mm)
        'place_heat_temp': 210,          # Temperature to heat to for release (°C)
        'place_preheat_height': 0.25,    # Height above place point to pre-heat (mm)
        'place_dwell_time': 1000,        # Dwell time after placement (ms)
        
        # Movement feedrates
        'travel_feedrate': 6000,         # XY travel speed (mm/min)
        'z_lift_feedrate': 1000,         # Z lift speed (mm/min)
        'place_feedrate': 100,           # Z approach speed for placement (mm/min)
    },
    'pcb': {
        # Pick parameters
        'pick_z_offset': -0.45,          # Z offset below pick point (mm)
        'pick_extrude_amount': 2.0,      # Extrusion during pick (mm)
        'pick_extrude_feedrate': 200,    # Feedrate during pick extrusion (mm/min)
        'pick_cool_temp': 100,           # Temperature to cool to for grabbing (°C) - colder for PCBs
        
        # Place parameters
        'place_z_offset': -1.0,          # Final Z offset below place point (mm)
        'place_heat_temp': 210,          # Temperature to heat to for release (°C)
        'place_preheat_height': 0.25,    # Height above place point to pre-heat (mm)
        'place_dwell_time': 1000,        # Dwell time after placement (ms)
        'place_side_offset': 1.0,        # X offset to move aside after placement (mm)
        
        # Prinjection parameters
        'prinjection': {
            'hover_z_offset': 5.0,       # Height above point to hover before injecting (mm)
            'inject_z_offset': -1.4,     # Z offset relative to point for extrusion (mm)
            'swipe_z_offset': -0.4,      # Z offset relative to point to perform swipe (mm)
            'extrude_amount': 0.5,       # Amount to extrude (mm)
            'initial_extra_prime': 0.5,  # Extra unretract amount for the very first hole (mm)
            'extrude_feedrate': 300,     # Feedrate for extrusion (mm/min)
            'retract_amount': 3,         # Amount to retract after injection (mm)
        },
        
        # Movement feedrates
        'travel_feedrate': 6000,         # XY travel speed (mm/min)
        'z_lift_feedrate': 1000,         # Z lift speed (mm/min)
        'place_feedrate': 100,           # Z approach speed for placement (mm/min)
    },
    'print': {
        # Pick parameters (PCB-like, but colder grab)
        'pick_z_offset': -0.65,          # Z offset below pick point (mm)
        'pick_extrude_amount': 5.0,      # Extrusion during pick (mm)
        'pick_extrude_feedrate': 200,    # Feedrate during pick extrusion (mm/min)
        'pick_cool_temp': 50,            # Cool lower for printed inserts (°C)

        # Place parameters
        'place_z_offset': -1.4,         # Final Z offset below place point (mm)
        'place_heat_temp': 230,          # Heat to print/release temperature (°C)
        'wipe_temp': 210,                # Heat to wipe temperature (°C) before wiping
        'place_preheat_height': 0.25,    # Height above place point to pre-heat (mm)
        'place_dwell_time': 1000,        # Dwell time after placement (ms)
        'place_side_offset': 3.0,        # X offset to move aside after placement (mm)

        # Movement feedrates
        'travel_feedrate': 6000,         # XY travel speed (mm/min)
        'z_lift_feedrate': 1000,         # Z lift speed (mm/min)
        'place_feedrate': 50,           # Z approach speed for placement (mm/min)
        'post_place_lift_feedrate': 50,  # extremely slow lift after placing
    },
    'tamping': {
        # Tamping parameters by type (TampingType enum: 0=End, 1=TraceTrace, 2=TracePlug, 3=TracePCB)
        0: {  # End
            'depth_offset': 0.6,         # Depth below tamp position (mm)
            'feedrate': 300,             # Z approach speed (mm/min)
            'dwell_time': 250,           # Dwell time at tamp position (ms)
        },
        1: {  # TraceTrace
            'depth_offset': 1.8,         # Depth below tamp position (mm)
            'feedrate': 200,             # Z approach speed (mm/min)
            'dwell_time': 500,           # Dwell time at tamp position (ms)
        },
        2: {  # TracePlug
            'depth_offset': 2.8,         # Depth below tamp position (mm)
            'feedrate': 200,             # Z approach speed (mm/min)
            'dwell_time': 500,          # Dwell time at tamp position (ms)
        },
        3: {  # TracePCB
            'depth_offset': 2.3,         # Depth below tamp position (mm)
            'feedrate': 200,             # Z approach speed (mm/min)
            'dwell_time': 500,           # Dwell time at tamp position (ms)
        },
        'travel_feedrate': 3000,         # XY travel speed to tamping points (mm/min)
        'lift_feedrate': 1000,           # Z lift speed after tamping (mm/min)
        'lift_height': 2.0,              # Height to lift after tamping (mm)
    }
}

def _jsonable(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    try:
        return float(value)
    except Exception:
        return str(value)


def _plain_dict(value):
    if not value:
        return {}
    pairs = None
    try:
        pairs = list(value.items())
    except Exception:
        try:
            pairs = [(key, value[key]) for key in value.Keys]
        except Exception:
            return {}
    return {str(key): _jsonable(item) for key, item in pairs}


def _xyz(point):
    if point is None:
        return None
    try:
        return {"x": float(point.X), "y": float(point.Y), "z": float(point.Z)}
    except Exception:
        return None


def _flatten_operations(value):
    if value is None:
        return []
    if hasattr(value, "PickPt") or hasattr(value, "PlacePt"):
        return [value]
    try:
        if hasattr(value, "Branches"):
            items = []
            for branch in value.Branches:
                items.extend(list(branch))
            return items
    except Exception:
        pass
    try:
        return [item for item in value]
    except TypeError:
        return [value]


def _part_type(embeddable, use_trace_braid):
    type_name = ""
    if hasattr(embeddable, "GetType"):
        try:
            type_name = str(embeddable.GetType().Name).lower()
        except Exception:
            type_name = ""
    if type_name == "print":
        return "print"
    if hasattr(embeddable, "Radius"):
        return "plug"
    if hasattr(embeddable, "Geometry"):
        return "pcb"
    return "trace_braid" if use_trace_braid else "trace_cloth"


def _point_records(items, with_type):
    records = []
    if not items:
        return records
    try:
        sequence = list(items)
    except Exception:
        return records
    for item in sequence:
        pos = _xyz(getattr(item, "Position", item))
        if pos is None:
            continue
        record = dict(pos)
        if with_type:
            try:
                record["type"] = int(item.Type)
            except Exception:
                record["type"] = 0
        overrides = _plain_dict(getattr(item, "Overrides", None))
        if overrides:
            record["overrides"] = overrides
        records.append(record)
    return records


def _part_size(embeddable):
    geo = getattr(embeddable, "Geometry", None)
    if geo is None:
        return None
    try:
        box = geo.GetBoundingBox(True)
    except Exception:
        return None
    size = {
        "x": float(box.Max.X - box.Min.X),
        "y": float(box.Max.Y - box.Min.Y),
        "z": float(box.Max.Z - box.Min.Z),
    }
    if size["x"] <= 0 or size["y"] <= 0:
        return None
    return size


def _bbox_center(embeddable):
    geo = getattr(embeddable, "Geometry", None)
    if geo is None:
        return None
    try:
        box = geo.GetBoundingBox(True)
    except Exception:
        return None
    return {
        "x": float((box.Max.X + box.Min.X) / 2.0),
        "y": float((box.Max.Y + box.Min.Y) / 2.0),
        "z": float((box.Max.Z + box.Min.Z) / 2.0),
    }


def _bbox_min(embeddable):
    geo = getattr(embeddable, "Geometry", None)
    if geo is None:
        return None
    try:
        box = geo.GetBoundingBox(True)
    except Exception:
        return None
    return {
        "x": float(box.Min.X),
        "y": float(box.Min.Y),
        "z": float(box.Min.Z),
    }


def _write_part_stl(meshes, path):
    """Write the component mesh Slice will subtract from its tray pocket."""
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("solid part\n")
        for mesh in meshes:
            copy = mesh.DuplicateMesh()
            copy.UnifyNormals()
            copy.Faces.ConvertQuadsToTriangles()
            for index in range(copy.Faces.Count):
                face = copy.Faces[index]
                a = copy.Vertices[face.A]
                b = copy.Vertices[face.B]
                c = copy.Vertices[face.C]
                ux, uy, uz = b.X - a.X, b.Y - a.Y, b.Z - a.Z
                vx, vy, vz = c.X - a.X, c.Y - a.Y, c.Z - a.Z
                handle.write("  facet normal {0} {1} {2}\n".format(
                    uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
                ))
                handle.write("    outer loop\n")
                for point in (a, b, c):
                    handle.write("      vertex {0} {1} {2}\n".format(point.X, point.Y, point.Z))
                handle.write("    endloop\n")
                handle.write("  endfacet\n")
        handle.write("endsolid part\n")


def _part_record(embeddable, use_trace_braid):
    place = _xyz(getattr(embeddable, "PlacePt", None))
    if place is None:
        print("A part has no place point. It was left out of the spec.")
        return None
    record = {
        "type": _part_type(embeddable, use_trace_braid),
        "place": place,
    }
    pick = _xyz(getattr(embeddable, "PickPt", None))
    if pick is not None:
        record["pick"] = pick
    layer = getattr(embeddable, "PauseLayer", None)
    if layer is not None:
        try:
            record["pause_layer"] = int(layer)
        except Exception:
            pass
    size = _part_size(embeddable)
    if size is not None:
        record["size"] = size
        box_center = _bbox_center(embeddable)
        if box_center is not None:
            record["bbox_center"] = box_center
        box_min = _bbox_min(embeddable)
        if box_min is not None:
            record["bbox_min"] = box_min
    length = getattr(embeddable, "Length", None)
    width = getattr(embeddable, "Width", None)
    if length is not None and width is not None:
        record["length"] = float(length)
        record["width"] = float(width)
        height = getattr(embeddable, "Height", None)
        if height is not None:
            record["height"] = float(height)
        horizontal = getattr(embeddable, "IsHorizontal", None)
        if horizontal is not None:
            record["horizontal"] = bool(horizontal)
        line = getattr(embeddable, "ModelLine", None)
        if line is not None:
            record["line_from"] = _xyz(line.From)
            record["line_to"] = _xyz(line.To)
    elif getattr(embeddable, "Radius", None) is not None:
        record["radius"] = float(embeddable.Radius)
        height = getattr(embeddable, "Height", None)
        if height is not None:
            record["height"] = float(height)
    tray_offset = getattr(embeddable, "TrayOffset", None)
    if tray_offset is not None:
        record["tray_offset"] = float(tray_offset)
    overrides = _plain_dict(getattr(embeddable, "Overrides", None))
    if overrides:
        record["overrides"] = overrides
    name = getattr(embeddable, "Name", None)
    if name:
        record["name"] = str(name)
    tamps = _point_records(getattr(embeddable, "TampingPts", None), True)
    if tamps:
        record["tamps"] = tamps
    holes = _point_records(getattr(embeddable, "PrinjectionPoints", None), False)
    if holes:
        record["prinjection"] = holes
    return record

def _outside_python():
    """The system Python that has the tray libraries. Rhino's own Python does not."""
    local = os.environ.get("LOCALAPPDATA", "")
    for version in ("Python310", "Python311", "Python312", "Python313"):
        path = os.path.join(local, "Programs", "Python", version, "python.exe")
        if os.path.isfile(path):
            return [path]
    return ["py", "-3"]


def _outside_env():
    """Drop Rhino's Python settings so the outside program can start."""
    env = os.environ.copy()
    for key in ("PYTHONHOME", "PYTHONPATH", "PYTHONNOUSERSITE", "PYTHONSTARTUP", "PYTHONSAFEPATH"):
        env.pop(key, None)
    return env


def process_print():
    """Main processing function for pick-and-place printing."""
    global SLICER_PATH, MODULE_PATH

    project_dir = resolve_project_root(globals().get("path"))
    if not project_dir:
        return
    MODULE_PATH = os.path.join(project_dir, "Scripts")
    if MODULE_PATH not in sys.path:
        sys.path.append(MODULE_PATH)

    import gcode_writer
    import importlib
    importlib.reload(gcode_writer)
    from gcode_writer import GcodeWriter

    use_trace_braid = bool(globals().get("braid", True))

    # --- 1. DIRECTORY & PATH MANAGEMENT ---
    printer_name = str(globals().get("printer", "")).strip().lower()
    use_orca = _is_u1(printer_name)

    SLICER_PATH = resolve_orca(globals().get("slicer")) if use_orca else resolve_slicer(globals().get("slicer"))
    if not SLICER_PATH:
        return

    print("Project folder: " + project_dir)
    print(("OrcaSlicer: " if use_orca else "PrusaSlicer: ") + SLICER_PATH)
    
    # Determine file prefix, wipe location, and retraction amount based on printer type
    if use_orca:
        file_prefix = "U1_"
        wipe_location = U1_WIPE_LOCATION
        retract_amount = 0.8
    elif printer_name == "prusa xl" or printer_name == "xl":
        file_prefix = "XL_"
        wipe_location = XL_WIPE_LOCATION
        retract_amount = 0.7
    elif printer_name == "prusa mini" or printer_name == "mini":
        file_prefix = "MINI_"
        wipe_location = MINI_WIPE_LOCATION
        retract_amount = 0
    else:
        file_prefix = ""
        wipe_location = XL_WIPE_LOCATION
        retract_amount = 0.5
    
    output_dir = os.path.join(project_dir, "output")
    snippet_dir = os.path.join(project_dir, "resources", "gcode_snippets")

    # Clean and recreate the output folder
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir)

    # Define all file paths
    tray_3mf_path = os.path.join(output_dir, "tray.3mf")
    model_3mf_path = os.path.join(output_dir, "model.3mf")
    setup_gcode_path = os.path.join(output_dir, "setup.gcode")
    part_gcode_path = os.path.join(output_dir, "part.gcode")
    config_path = os.path.join(project_dir, "resources", f"{file_prefix}config.ini")
    final_output_path = os.path.join(output_dir, "combined_output.gcode")

    # --- 2. 3MF EXPORT STAGE ---
    def _geometry_to_meshes(geo):
        meshes = []
        if geo is None:
            return meshes
        if isinstance(geo, Rhino.Geometry.Mesh):
            if geo.IsValid and geo.Vertices.Count > 0:
                meshes.append(geo)
            return meshes
        brep = geo if isinstance(geo, Rhino.Geometry.Brep) else None
        if brep is None:
            try:
                brep = Rhino.Geometry.Brep.TryConvertBrep(geo)
            except Exception:
                brep = None
        if brep is None:
            return meshes
        created = Rhino.Geometry.Mesh.CreateFromBrep(brep, Rhino.Geometry.MeshingParameters.Default)
        if created:
            meshes.extend([item for item in created if item is not None and item.IsValid])
        return meshes

    def _meshes_from_value(value):
        if value is None:
            return []
        if isinstance(value, Rhino.Geometry.Mesh) or isinstance(value, Rhino.Geometry.Brep):
            return _geometry_to_meshes(value)
        meshes = []
        try:
            for item in value:
                meshes.extend(_meshes_from_value(item))
        except TypeError:
            meshes.extend(_geometry_to_meshes(value))
        return meshes

    def _meshes_from_layer(doc, layer_name):
        if doc is None:
            return []
        if doc.Layers.Find(layer_name, True) < 0:
            return []
        found = doc.Objects.FindByLayer(layer_name)
        if not found:
            return []
        breps = []
        meshes = []
        for obj in found:
            if obj is None or obj.Geometry is None:
                continue
            geo = obj.Geometry
            if isinstance(geo, Rhino.Geometry.Brep):
                breps.append(geo)
            elif isinstance(geo, Rhino.Geometry.Mesh):
                meshes.append(geo)
            else:
                try:
                    converted = Rhino.Geometry.Brep.TryConvertBrep(geo)
                except Exception:
                    converted = None
                if converted is not None:
                    breps.append(converted)
        if breps:
            if len(breps) > 1:
                joined = Rhino.Geometry.Brep.JoinBreps(breps, doc.ModelAbsoluteTolerance)
                if joined:
                    breps = [item for item in joined if item is not None]
            solids = [item for item in breps if item.IsSolid]
            chosen = solids if solids else breps
            result = []
            for item in chosen:
                result.extend(_geometry_to_meshes(item))
            return result
        return [item for item in meshes if item is not None and item.IsValid and item.Vertices.Count > 0]

    def export_mesh_to_3mf(mesh_data, file_path):
        """Export a single mesh to 3MF format."""
        meshes = _meshes_from_value(mesh_data)
        if not meshes:
            return False
        doc = Rhino.RhinoDoc.CreateHeadless(None)
        opts = Rhino.FileIO.File3mfWriteOptions()
        opts.Title = "Grasshopper Export"
        for mesh in meshes:
            doc.Objects.AddMesh(mesh)
        success = doc.Export(file_path, opts.ToDictionary())
        doc.Dispose()
        return success

    def export_meshes_to_3mf(mesh_list, file_path):
        """Export a list of meshes to a single 3MF file."""
        meshes = _meshes_from_value(mesh_list)
        if not meshes:
            return False
        doc = Rhino.RhinoDoc.CreateHeadless(None)
        opts = Rhino.FileIO.File3mfWriteOptions()
        opts.Title = "Grasshopper Export"
        combined = Rhino.Geometry.Mesh()
        for mesh in meshes:
            combined.Append(mesh)
        if combined.Vertices.Count == 0:
            doc.Dispose()
            return False
        doc.Objects.AddMesh(combined)
        success = doc.Export(file_path, opts.ToDictionary())
        doc.Dispose()
        return success

    model_meshes = _meshes_from_value(model)
    if not model_meshes:
        model_meshes = _meshes_from_layer(Rhino.RhinoDoc.ActiveDoc, "Default")
        if model_meshes:
            print("Solid Difference was empty. Using the closed solid on layer Default.")
    if not model_meshes:
        print("No print body. Move the box to layer Default as one closed solid. PLA is for parts you place, not for the printed box.")
        return

    spec_dir = os.path.join(output_dir, "spec")
    os.makedirs(spec_dir)
    housing_3mf = os.path.join(spec_dir, "housing.3mf")
    if not export_meshes_to_3mf(model_meshes, housing_3mf):
        print("Failed to export the housing.")
        return
    print("Housing exported.")

    def _export_extra(file_path, options_name):
        try:
            options_type = getattr(Rhino.FileIO, options_name)
            opts = options_type()
        except Exception as error:
            print("Skipped " + os.path.basename(file_path) + ": " + str(error))
            return
        doc = Rhino.RhinoDoc.CreateHeadless(None)
        try:
            combined = Rhino.Geometry.Mesh()
            for mesh in model_meshes:
                combined.Append(mesh)
            if combined.Vertices.Count == 0:
                return
            doc.Objects.AddMesh(combined)
            if doc.Export(file_path, opts.ToDictionary()):
                print("Wrote " + file_path)
        except Exception as error:
            print("Skipped " + os.path.basename(file_path) + ": " + str(error))
        finally:
            doc.Dispose()

    _export_extra(os.path.join(spec_dir, "housing.stl"), "FileStlWriteOptions")
    _export_extra(os.path.join(spec_dir, "housing.step"), "FileStpWriteOptions")

    parts = []
    for item in _flatten_operations(operations):
        record = _part_record(item, use_trace_braid)
        if record is None:
            continue
        if record["type"] in ("pcb", "print"):
            meshes = _geometry_to_meshes(getattr(item, "Geometry", None))
            if not meshes:
                print("A component has no solid mesh, so its tray pocket cannot be cut from the real part.")
                return
            mesh_name = "part-{0}.stl".format(len(parts))
            _write_part_stl(meshes, os.path.join(spec_dir, mesh_name))
            record["mesh"] = mesh_name
            print("Exported " + mesh_name)
        parts.append(record)
    if not parts:
        print("No traces or components to place. The spec was not written.")
        return
    spec = {
        "version": 1,
        "printer": printer_name,
        "use_trace_braid": use_trace_braid,
        "housing": "housing.3mf",
        "tray": "generated",
        "tray_spacing": 3.0,
        "tray_origin": {"x": 0.0, "y": 0.0, "z": 0.0},
        "parts": parts,
    }
    spec_path = os.path.join(spec_dir, "spec.json")
    with open(spec_path, "w") as handle:
        json.dump(spec, handle, indent=2)
    print("Wrote " + spec_path)
    print("Rhino exported the housing and the part list. The tray and the slicer run outside Grasshopper.")

    command = _outside_python() + ["-m", "pipeline", spec_dir, "--project", project_dir]
    log_path = os.path.join(output_dir, "slice_log.txt")
    with open(log_path, "w", encoding="utf-8") as log:
        log.write(" ".join(command) + "\n")
        log.flush()
        completed = subprocess.run(
            command,
            cwd=MODULE_PATH,
            env=_outside_env(),
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    if completed.returncode != 0:
        print("The outside slicer failed. See " + log_path)
        return
    print("Process Complete. Final G-Code saved in output folder.")


def _slice_is_on(value):
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if text in ("true", "1"):
        return True
    if text in ("false", "0", "none", ""):
        return False
    try:
        return any(_slice_is_on(item) for item in value)
    except TypeError:
        return False


_slice_was_on = False


def _slice_pressed(value):
    global _slice_was_on
    on = _slice_is_on(value)
    pressed = on and not _slice_was_on
    _slice_was_on = on
    return pressed


if _slice_pressed(run):
    process_print()
