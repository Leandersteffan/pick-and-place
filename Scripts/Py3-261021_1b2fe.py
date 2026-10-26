import subprocess
import os
import shutil
import re
import sys
import zipfile
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

    if export_mesh_to_3mf(tray, tray_3mf_path) and export_meshes_to_3mf(model_meshes, model_3mf_path):
        print("3MF Files Exported Successfully.")
    else:
        print("Failed to export 3MF files.")
        return

    # --- 3. SLICING STAGE ---
    def orca_profile_paths():
        install = os.path.dirname(SLICER_PATH)
        machine = os.path.join(install, "resources", "profiles", "Snapmaker", "machine", "Snapmaker U1 (0.4 nozzle).json")
        process = os.path.join(project_dir, "resources", "u1", "process.json")
        filament = os.path.join(project_dir, "resources", "u1", "filament.json")
        missing = [path for path in (machine, process, filament) if not os.path.isfile(path)]
        if missing:
            print("Missing U1 slicer profile: " + missing[0])
            return None
        return machine, process, filament

    def run_prusa(input_file, output_file):
        cmd = [
            SLICER_PATH, "-s", "-g",
            "--load", config_path,
            "-o", output_file,
            input_file
        ]
        return subprocess.run(cmd, capture_output=True, text=True).stdout

    def run_orca(input_file, output_file):
        profiles = orca_profile_paths()
        if profiles is None:
            return ""
        machine, process, filament = profiles
        orca_dir = os.path.join(output_dir, os.path.splitext(os.path.basename(output_file))[0] + "_orca")
        if os.path.exists(orca_dir):
            shutil.rmtree(orca_dir)
        os.makedirs(orca_dir)
        cmd = [
            SLICER_PATH,
            "--load-settings", machine,
            "--load-settings", process,
            "--load-filaments", filament,
            "--outputdir", orca_dir,
            "--slice", "0",
            input_file,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.stdout:
            print(result.stdout)
        if result.returncode != 0:
            print(result.stderr)
            print("OrcaSlicer failed on " + os.path.basename(input_file))
            return ""
        produced = [
            os.path.join(orca_dir, name)
            for name in os.listdir(orca_dir)
            if name.lower().endswith(".gcode")
        ]
        if not produced:
            print("OrcaSlicer wrote no gcode for " + os.path.basename(input_file))
            return ""
        shutil.copyfile(produced[0], output_file)
        return result.stdout

    def gcode_has_layers(path):
        if not os.path.isfile(path):
            return False
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            return ";LAYER_CHANGE" in handle.read()

    print("Slicing Setup...")
    if use_orca:
        run_orca(tray_3mf_path, setup_gcode_path)
    else:
        run_prusa(tray_3mf_path, setup_gcode_path)
    print("Slicing Part...")
    if use_orca:
        run_orca(model_3mf_path, part_gcode_path)
    else:
        run_prusa(model_3mf_path, part_gcode_path)
    if not gcode_has_layers(setup_gcode_path) or not gcode_has_layers(part_gcode_path):
        print("Slicing did not produce layer changes. Stopped before writing combined_output.gcode.")
        return

    tray_shift = (0.0, 0.0)
    model_shift = (0.0, 0.0)
    if use_orca:
        tray_shift = _slicer_shift(tray_3mf_path, setup_gcode_path)
        model_shift = _slicer_shift(model_3mf_path, part_gcode_path)
        if tray_shift is None or model_shift is None:
            print("Could not match the sliced position to the model. Stopped before writing combined_output.gcode.")
            return
        tray_bounds = _mesh_bounds(tray_3mf_path)
        model_bounds = _mesh_bounds(model_3mf_path)
        if tray_bounds is None or model_bounds is None:
            print("Could not read the model size. Stopped before writing combined_output.gcode.")
            return
        bed_shift = _shared_bed_shift((tray_bounds, model_bounds))
        if bed_shift is None:
            print("Tray and box do not fit on the bed together. Move them in Rhino, then Slice again.")
            return
        _shift_layer_moves(
            setup_gcode_path,
            (-tray_shift[0] + bed_shift[0], -tray_shift[1] + bed_shift[1]),
        )
        _shift_layer_moves(
            part_gcode_path,
            (-model_shift[0] + bed_shift[0], -model_shift[1] + bed_shift[1]),
        )
        _rewrite_bed_mesh(setup_gcode_path, (tray_bounds, model_bounds), bed_shift)
        tray_shift = bed_shift
        model_shift = bed_shift
        if abs(bed_shift[0]) < 0.05 and abs(bed_shift[1]) < 0.05:
            print("Tray and box keep their Rhino positions.")
        else:
            print(
                "Tray and box keep their Rhino gap. Both were nudged by {0:+.1f}, {1:+.1f} mm so the tray stays on the bed."
                .format(bed_shift[0], bed_shift[1])
            )

    # --- 4. G-CODE GENERATION FUNCTIONS ---
    def merge_config_with_overrides(base_config, embeddable_overrides):
        """
        Merge embeddable overrides with base config, handling type conversions.
        Non-prinjection_ keys override base config directly.
        Returns a merged config dict.
        """
        merged = dict(base_config)
        
        if not embeddable_overrides:
            return merged
        
        for key, value in embeddable_overrides.items():
            if key.startswith('prinjection_'):
                # Handle prinjection overrides
                prinjection_key = key[12:]  # Remove 'prinjection_' prefix (12 chars, not 11!)
                if 'prinjection' not in merged:
                    merged['prinjection'] = {}
                else:
                    merged['prinjection'] = dict(merged['prinjection'])
                
                # Try to convert to appropriate type
                try:
                    if prinjection_key in merged['prinjection']:
                        orig_val = merged['prinjection'][prinjection_key]
                        if isinstance(orig_val, bool):
                            merged['prinjection'][prinjection_key] = value.lower() in ('true', '1', 'yes')
                        elif isinstance(orig_val, int):
                            merged['prinjection'][prinjection_key] = int(float(value))
                        elif isinstance(orig_val, float):
                            merged['prinjection'][prinjection_key] = float(value)
                        else:
                            merged['prinjection'][prinjection_key] = value
                    else:
                        # Try to infer type
                        try:
                            merged['prinjection'][prinjection_key] = float(value)
                        except ValueError:
                            merged['prinjection'][prinjection_key] = value
                except Exception as e:
                    print(f"Warning: Could not parse prinjection override {key}={value}: {e}")
            else:
                # Handle regular config overrides
                try:
                    if key in merged:
                        orig_val = merged[key]
                        if isinstance(orig_val, bool):
                            merged[key] = value.lower() in ('true', '1', 'yes')
                        elif isinstance(orig_val, int):
                            merged[key] = int(float(value))
                        elif isinstance(orig_val, float):
                            merged[key] = float(value)
                        else:
                            merged[key] = value
                    else:
                        # Try to infer type
                        try:
                            merged[key] = float(value)
                        except ValueError:
                            merged[key] = value
                except Exception as e:
                    print(f"Warning: Could not parse override {key}={value}: {e}")
        
        return merged

    def perform_nozzle_wipe(writer, location, retract_amount=2.5):
        """Perform nozzle wipe sequence at specified location.
        
        Args:
            writer: GcodeWriter instance
            location: Tuple of (x, y, z) coordinates for wipe location
            retract_amount: Amount to retract before wipe movements (mm), default 2.5mm
        """
        writer.comment("Nozzle Wipe Sequence")
        wx, wy, wz = location
        
        # Move to wipe station
        writer.move_to(x=wx, y=wy, z=wz+10, feedrate=24000)
        writer.move_to(z=wz, feedrate=24000)
        writer.extrude(amount=10.0, feedrate=2400)
        writer.write_line("G4 P500")  # Dwell for 500ms
        
        # Retract before wipe movements
        writer.retract(amount=retract_amount)
        
        # Back and forth wipes
        for _ in range(1):
            writer.move_to(x=wx + 30, feedrate=12000)
            writer.move_to(x=wx, feedrate=12000)
        writer.move_to(x=wx + 30, feedrate=12000)
        
        # Clear and stay near wipe station; caller controls return/unretract timing.
        writer.move_to(z=wz+10, feedrate=24000)

    def perform_pick_and_place(writer, embeddable, embeddable_type):
        """
        Execute pick and place operation for an embeddable element.
        
        Args:
            writer: GcodeWriter instance
            embeddable: The embeddable object (TraceElement, Plug, or PCB) from C#
            embeddable_type: 'trace_braid', 'trace_cloth', 'plug', 'pcb', or 'print'
        """
        cfg = CONFIG[embeddable_type]
        
        # Merge embeddable-level overrides
        if hasattr(embeddable, 'Overrides') and embeddable.Overrides:
            cfg = merge_config_with_overrides(cfg, embeddable.Overrides)
        
        writer.comment(f"=== Pick and Place: {embeddable_type.upper()} ===")

        pick_pt = _moved(embeddable.PickPt, tray_shift)
        place_pt = _moved(embeddable.PlacePt, model_shift)
        tamp_pts = embeddable.TampingPts or []

        # Lift nozzle
        writer.move_to(z=writer.state.current_z + 10, feedrate=cfg['z_lift_feedrate'])

        # Turn off part cooling fan to prevent blowing parts away
        writer.write_line("M107")

        # Wipe nozzle and retract
        perform_nozzle_wipe(writer, wipe_location, retract_amount)

        # === PICK SEQUENCE ===
        writer.comment("Pick Sequence")
        writer.move_to(x=pick_pt.X, y=pick_pt.Y, feedrate=cfg['travel_feedrate'])
        writer.move_to(z=pick_pt.Z + 10, feedrate=cfg['z_lift_feedrate'])
        writer.unretract(amount=retract_amount)
        
        # Pre-extrude step if configured
        if 'pick_pre_extrude_amount' in cfg and cfg['pick_pre_extrude_amount'] > 0:
            writer.move_to(z=pick_pt.Z, feedrate=cfg['z_lift_feedrate'])
            writer.extrude(amount=cfg['pick_pre_extrude_amount'], feedrate=cfg['pick_extrude_feedrate'])
            writer.move_to(z=pick_pt.Z + cfg['pick_z_offset'], feedrate=cfg['z_lift_feedrate'])
        else:
            writer.move_to(z=pick_pt.Z + cfg['pick_z_offset'], feedrate=cfg['z_lift_feedrate'])
        
        writer.extrude(amount=cfg['pick_extrude_amount'], feedrate=cfg['pick_extrude_feedrate'])
        
        writer.comment("Cooling to grab...")
        writer.set_extruder_temp(cfg['pick_cool_temp'], wait=True)
        pick_dwell_time = cfg.get('pick_dwell_time', 0)
        if pick_dwell_time > 0:
            writer.write_line(f"G4 P{pick_dwell_time}")

        # === PLACE SEQUENCE ===
        writer.comment("Place Sequence")
        writer.move_to(z=place_pt.Z + 10, feedrate=cfg['z_lift_feedrate'])
        writer.move_to(x=place_pt.X, y=place_pt.Y, feedrate=cfg['travel_feedrate'])
        
        if PLACE_HOVER_DWELL_TIME_MS > 0:
            writer.comment(f"Hover dwell before placing into cavity ({PLACE_HOVER_DWELL_TIME_MS} ms)")
            writer.write_line(f"G4 P{PLACE_HOVER_DWELL_TIME_MS}")
        
        # Pre-heat and place behavior
        if embeddable_type == 'pcb':
            # PCB-style: place cold, then release at wipe station
            writer.move_to(z=place_pt.Z + cfg['place_preheat_height'], feedrate=cfg['z_lift_feedrate'])
            writer.move_to(z=place_pt.Z + cfg['place_z_offset'], feedrate=cfg['place_feedrate'])
            writer.extrude(-1, feedrate=2000)
            writer.write_line(f"G4 P{cfg['place_dwell_time']}")
            
            # Move aside while still cold
            writer.comment("Moving aside while cold...")
            writer.move_to(x=place_pt.X + cfg.get('place_side_offset', 1.0), feedrate=cfg['travel_feedrate'])
            writer.extrude(-2.5, feedrate=2000)
            writer.move_to(z=place_pt.Z + 10, feedrate=cfg['z_lift_feedrate'])
            
            # Travel to wipe station, then heat to release
            wx, wy, wz = wipe_location
            writer.comment("Traveling to wipe station to release...")
            writer.move_to(x=wx, y=wy, z=wz + 10, feedrate=cfg['travel_feedrate'])
            writer.move_to(z=wz, feedrate=cfg['z_lift_feedrate'])
            writer.set_extruder_temp(cfg['place_heat_temp'], wait=True)
        elif embeddable_type == 'print':
            # Print-style: place cold, heat to print temperature, then shear move to release.
            writer.move_to(z=place_pt.Z + cfg['place_preheat_height'], feedrate=cfg['z_lift_feedrate'])
            writer.move_to(z=place_pt.Z + cfg['place_z_offset'], feedrate=cfg['place_feedrate'])
            writer.extrude(-1, feedrate=2000)
            writer.comment("Heating to release...")
            writer.set_extruder_temp(cfg['place_heat_temp'], wait=True)
        elif cfg['place_preheat_height'] > 0:
            # Plug/PCB-style: pre-heat above the place point, then press down
            writer.move_to(z=place_pt.Z + cfg['place_preheat_height'], feedrate=cfg['z_lift_feedrate'])
            writer.comment("Preheating before placement...")
            writer.set_extruder_temp(cfg['place_heat_temp'], wait=True)
            writer.move_to(z=place_pt.Z + cfg['place_z_offset'], feedrate=cfg['place_feedrate'])
            writer.extrude(-1, feedrate=2000)
        else:
            # Trace-style: pre-heat at the final place position
            writer.move_to(z=place_pt.Z + cfg['place_z_offset'], feedrate=cfg['place_feedrate'])
            writer.comment("Heating to release...")
            writer.set_extruder_temp(cfg['place_heat_temp'], wait=True)
        
        writer.write_line(f"G4 P{cfg['place_dwell_time']}")
        
        # Print-specific: perform a shear move to release the part
        if embeddable_type == 'print' and 'place_side_offset' in cfg:
            writer.comment("Shear moving aside to release...")
            writer.move_to(z=place_pt.Z, feedrate=cfg.get('post_place_lift_feedrate', cfg['z_lift_feedrate']))
            writer.move_to(x=place_pt.X + cfg['place_side_offset'], feedrate=cfg['travel_feedrate'])

        # Prinjection sequence for PCB
        if embeddable_type == 'pcb':
            if hasattr(embeddable, 'PrinjectionPoints') and embeddable.PrinjectionPoints and len(list(embeddable.PrinjectionPoints)) > 0:
                writer.comment("Starting Prinjection Sequence for PCB holes")
                
                # Perform an interim wipe to clear oozing after heating up
                perform_nozzle_wipe(writer, wipe_location, retract_amount)
                
                prinjection_cfg = cfg['prinjection']
                
                # Turn cooling fan back on during prinjection if desired (optional, maybe leave it off)
                writer.write_line("M106")
                
                # Unretract after wipe. Note we map the main parameter first to neutralise the manual system retract, 
                # then shift to local prinjection cfg length for inter-hole stringing mitigation.
                writer.unretract(amount=retract_amount)
                writer.retract(amount=prinjection_cfg['retract_amount'])
                
                is_first_hole = True
                
                for hole_idx, pt in enumerate(list(embeddable.PrinjectionPoints)):
                    # Extract position from PrinjectionPoint object
                    hole_pos = _moved(pt.Position, model_shift)
                    
                    # Merge point-level overrides (takes precedence over embeddable-level prinjection config)
                    pt_prinjection_cfg = dict(prinjection_cfg)
                    
                    # DEBUG: Check if Overrides exist
                    has_overrides = hasattr(pt, 'Overrides') and pt.Overrides
                    overrides_count = len(pt.Overrides) if has_overrides else 0
                    print(f"[DEBUG] Hole {hole_idx}: hasattr(pt, 'Overrides')={hasattr(pt, 'Overrides')}, overrides_count={overrides_count}")
                    
                    if has_overrides:
                        print(f"[DEBUG]   Overrides dict keys: {list(pt.Overrides.keys())}")
                        for key, value in pt.Overrides.items():
                            print(f"[DEBUG]   Processing override: {key}={value}")
                            if key.startswith('prinjection_'):
                                prinjection_key = key[12:]  # Remove 'prinjection_' prefix (12 chars, not 11!)
                                print(f"[DEBUG]     Stripped key: {prinjection_key}")
                                try:
                                    if prinjection_key in pt_prinjection_cfg:
                                        orig_val = pt_prinjection_cfg[prinjection_key]
                                        print(f"[DEBUG]     Found in cfg, orig_val={orig_val} (type={type(orig_val).__name__})")
                                        if isinstance(orig_val, bool):
                                            pt_prinjection_cfg[prinjection_key] = value.lower() in ('true', '1', 'yes')
                                        elif isinstance(orig_val, int):
                                            pt_prinjection_cfg[prinjection_key] = int(float(value))
                                        elif isinstance(orig_val, float):
                                            pt_prinjection_cfg[prinjection_key] = float(value)
                                        else:
                                            pt_prinjection_cfg[prinjection_key] = value
                                        print(f"[DEBUG]     Updated to: {pt_prinjection_cfg[prinjection_key]}")
                                    else:
                                        print(f"[DEBUG]     NOT found in cfg")
                                        try:
                                            pt_prinjection_cfg[prinjection_key] = float(value)
                                        except ValueError:
                                            pt_prinjection_cfg[prinjection_key] = value
                                except Exception as e:
                                    print(f"Warning: Could not parse point prinjection override {key}={value}: {e}")
                    
                    print(f"[DEBUG]   Final extrude_amount for hole {hole_idx}: {pt_prinjection_cfg['extrude_amount']}")
                    
                    # Hover over the hole
                    hover_z = hole_pos.Z + pt_prinjection_cfg['hover_z_offset']
                    target_z = hole_pos.Z + pt_prinjection_cfg['inject_z_offset']
                    
                    # Move to hover position
                    writer.move_to(x=hole_pos.X, y=hole_pos.Y, feedrate=cfg['travel_feedrate'])
                    writer.move_to(z=hover_z, feedrate=cfg['z_lift_feedrate'])
                    
                    # Lower to injection point at a normal speed instead of the slow place speed
                    writer.move_to(z=target_z, feedrate=cfg['z_lift_feedrate'])
                    
                    # Unretract from previous hole or initial wipe if retract_amount from config matches what was pulled
                    unretract_amt = pt_prinjection_cfg['retract_amount']
                    if is_first_hole and 'initial_extra_prime' in pt_prinjection_cfg:
                        unretract_amt += pt_prinjection_cfg['initial_extra_prime']
                        is_first_hole = False
                        
                    writer.unretract(amount=unretract_amt)
                    
                    # Inject filament
                    writer.extrude(amount=pt_prinjection_cfg['extrude_amount'], feedrate=pt_prinjection_cfg['extrude_feedrate'])
                    
                    # Retract and lift
                    writer.retract(amount=pt_prinjection_cfg['retract_amount'])
                    
                    # If we injected below the swipe offset, lift to the swipe offset first
                    if pt_prinjection_cfg['inject_z_offset'] < pt_prinjection_cfg['swipe_z_offset']:
                        writer.move_to(z=hole_pos.Z + pt_prinjection_cfg['swipe_z_offset'], feedrate=cfg['place_feedrate'])

                    # Do a little side swipe to break the string
                    writer.comment("Side swipe to break stringing")
                    writer.move_to(x=hole_pos.X + 1.5, y=hole_pos.Y + 1.5, feedrate=cfg['travel_feedrate'])
                    
                    # Quick lift to hover z
                    writer.move_to(z=hover_z, feedrate=cfg['z_lift_feedrate'])
                    
                # Turn cooling fan back off if we turned it on
                writer.write_line("M107")

        elif embeddable_type == 'print' and 'place_side_offset' in cfg:
            # Print-specific: lift, move to wipe station, and cool to wipe temp
            writer.extrude(-2.5, feedrate=2000)
            writer.move_to(z=place_pt.Z + 10, feedrate=cfg.get('post_place_lift_feedrate', cfg['z_lift_feedrate']))
            
            wx, wy, wz = wipe_location
            writer.comment("Moving to wipe location before adjusting temp...")
            writer.move_to(x=wx, y=wy, feedrate=cfg['travel_feedrate'])
            writer.comment(f"Cooling down to wipe temp ({cfg.get('wipe_temp', 210)})...")
            writer.set_extruder_temp(cfg.get('wipe_temp', 210), wait=True)

        else:
            writer.extrude(-2.5, feedrate=2000)
            writer.move_to(z=place_pt.Z + 2, feedrate=cfg['z_lift_feedrate'])

        # === TAMPING SEQUENCE ===
        if tamp_pts and len(tamp_pts) > 0:
            writer.comment(f"Tamping {len(tamp_pts)} Points")
            tamp_cfg = CONFIG['tamping']
            
            for tamp_pt in tamp_pts:
                # Access TampingPoint properties from C#
                position = _moved(tamp_pt.Position, model_shift)
                tamp_type = int(tamp_pt.Type)
                
                # Get type-specific parameters from Python CONFIG
                type_cfg = dict(tamp_cfg[tamp_type])
                
                # Merge point-level overrides (takes precedence over embeddable-level)
                if hasattr(tamp_pt, 'Overrides') and tamp_pt.Overrides:
                    for key, value in tamp_pt.Overrides.items():
                        # Skip prinjection_ prefix for tamping points
                        if not key.startswith('prinjection_'):
                            try:
                                if key in type_cfg:
                                    orig_val = type_cfg[key]
                                    if isinstance(orig_val, bool):
                                        type_cfg[key] = value.lower() in ('true', '1', 'yes')
                                    elif isinstance(orig_val, int):
                                        type_cfg[key] = int(float(value))
                                    elif isinstance(orig_val, float):
                                        type_cfg[key] = float(value)
                                    else:
                                        type_cfg[key] = value
                                else:
                                    try:
                                        type_cfg[key] = float(value)
                                    except ValueError:
                                        type_cfg[key] = value
                            except Exception as e:
                                print(f"Warning: Could not parse tamping point override {key}={value}: {e}")
                
                depth_offset = type_cfg['depth_offset']
                
                # Perform tamping motion
                writer.move_to(x=position.X, y=position.Y, feedrate=tamp_cfg['travel_feedrate'])
                writer.move_to(z=position.Z - depth_offset, feedrate=type_cfg['feedrate'])
                writer.write_line(f"G4 P{type_cfg['dwell_time']}")
                writer.move_to(z=position.Z + tamp_cfg['lift_height'], feedrate=tamp_cfg['lift_feedrate'])

        # Turn part cooling fan back on
        writer.write_line("M106")

    # --- 5. FINAL G-CODE ASSEMBLY ---
    with GcodeWriter(final_output_path) as writer:
        if use_orca:
            writer.firmware = "klipper"

        # The U1 file keeps Orca's own startup (home, mesh, nozzle clean, prime line).
        # Prusa files replace that startup with the saved preamble.
        if use_orca:
            with open(setup_gcode_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            end_idx = next((i for i, line in enumerate(lines) if line.strip() == "PRINT_END"), len(lines))
            for line in lines[:end_idx]:
                writer.write_line(line.rstrip())
        else:
            with open(os.path.join(snippet_dir, f"{file_prefix}preamble.gcode"), "r") as f:
                for line in f:
                    writer.write_line(line.rstrip())
            with open(setup_gcode_path, "r") as f:
                lines = f.readlines()
                start_idx = next((i for i, l in enumerate(lines) if ";LAYER_CHANGE" in l), 0)
                for line in lines[start_idx:]:
                    writer.write_line(line.rstrip())

        last_setup_z = writer.state.current_z
        writer.pause()
        post_pause_position = writer.state.position
        perform_nozzle_wipe(writer, wipe_location, retract_amount)
        writer.move_to(x=post_pause_position.x, y=post_pause_position.y, z=post_pause_position.z, feedrate=24000)
        writer.unretract(amount=retract_amount)

        # Process part G-code with dynamic pick and place insertion
        writer.state.current_layer = 0
        z_has_been_adjusted = False
        part_start_prime_done = False
        completed_embeddable_indices = set()

        def get_embeddable_type(embeddable):
            """Resolve embeddable type from CLR object shape/name."""
            type_name = ""
            if hasattr(embeddable, 'GetType'):
                try:
                    type_name = str(embeddable.GetType().Name).lower()
                except Exception:
                    type_name = ""

            if type_name == 'print':
                return 'print'
            if hasattr(embeddable, 'Radius'):
                return 'plug'
            if hasattr(embeddable, 'Geometry'):
                return 'pcb'
            return 'trace_braid' if use_trace_braid else 'trace_cloth'

        def process_layer_embeddables(layer_embeddables, context_label):
            """Run pick-and-place for a list of (index, embeddable) pairs."""
            if not layer_embeddables:
                return

            writer.comment(f"=== {context_label} ===")

            # Save current position and pressure advance before pick and place operations
            saved_position = writer.state.position
            saved_pa = writer.get_pressure_advance()

            # Disable pressure advance for pick and place operations
            writer.set_pressure_advance(extruder=saved_pa[0], value=0.0)

            # Process all embeddables for this insertion point
            for i, embeddable in layer_embeddables:
                embeddable_type = get_embeddable_type(embeddable)

                writer.comment(f"Placing {embeddable_type.upper()} #{i+1}")
                perform_pick_and_place(writer, embeddable, embeddable_type)
                completed_embeddable_indices.add(i)

            # After all placements, wipe and return to saved position
            perform_nozzle_wipe(writer, wipe_location, retract_amount)
            writer.move_to(x=saved_position.x, y=saved_position.y, z=saved_position.z + 10, feedrate=6000)
            writer.unretract(amount=retract_amount)

            # Restore pressure advance
            writer.set_pressure_advance(extruder=saved_pa[0], value=saved_pa[1], time_range=saved_pa[2])

        with open(part_gcode_path, "r", encoding="utf-8", errors="replace") as f:
            part_lines = f.readlines()
            start_idx = next((i for i, l in enumerate(part_lines) if ";LAYER_CHANGE" in l), 0)

            # Find where post-print footer begins (after last printable moves).
            end_section_idx = next(
                (i for i in range(start_idx, len(part_lines)) if part_lines[i].rstrip().startswith(";TYPE:Custom")),
                None
            )

            # Determine the number of printable layers from layer-change markers.
            max_layer_in_part = sum(1 for l in part_lines[start_idx:] if l.rstrip().startswith(";LAYER_CHANGE"))
            print(f"Detected {max_layer_in_part} printable layers in part.gcode")
            if end_section_idx is not None:
                print(f"Late-placement anchor found at line {end_section_idx + 1} (;TYPE:Custom)")
            
            for line_idx in range(start_idx, len(part_lines)):
                line = part_lines[line_idx]
                clean_line = line.rstrip()

                # Insert any remaining operations right before the end/custom section.
                if end_section_idx is not None and line_idx == end_section_idx:
                    pending_embeddables = [
                        (i, embeddable) for i, embeddable in enumerate(operations)
                        if i not in completed_embeddable_indices
                    ]
                    if pending_embeddables:
                        print(
                            f"Inserting {len(pending_embeddables)} late operation(s) after last print layer "
                            f"(current layer={writer.state.current_layer}, max layer={max_layer_in_part})."
                        )
                        process_layer_embeddables(pending_embeddables, "Late Placement After Last Print Move")
                
                # Check for layer change to trigger pick and place
                if clean_line.startswith(";LAYER_CHANGE"):
                    writer.write_line(clean_line)
                    
                    # Find all embeddables scheduled for this layer
                    layer_embeddables = [
                        (i, embeddable) for i, embeddable in enumerate(operations)
                        if writer.state.current_layer == embeddable.PauseLayer and i not in completed_embeddable_indices
                    ]
                    
                    if layer_embeddables:
                        process_layer_embeddables(layer_embeddables, f"Layer {writer.state.current_layer} Placement")
                    
                    continue

                # Adjust the very first Z-move to be relative to the previous setup height
                if not z_has_been_adjusted and "G1" in clean_line and "Z" in clean_line:
                    adjusted_z = last_setup_z + PART_START_Z_HOP
                    clean_line = re.sub(r'Z[\d\.]+', f'Z{adjusted_z:.1f}', clean_line)
                    z_has_been_adjusted = True
                
                writer.write_line(clean_line)

                # One-time extra prime at part start to recover from transition ooze.
                if (not part_start_prime_done
                    and z_has_been_adjusted
                    and re.match(r'^G1\s+E\.?8\b', clean_line)):
                    writer.comment("Part-start extra prime")
                    writer.write_line(f"G1 E{PART_START_EXTRA_PRIME:.2f} F1500")
                    part_start_prime_done = True

        # Fallback: if no explicit end marker was found, append any still-pending operations now.
        final_pending_embeddables = [
            (i, embeddable) for i, embeddable in enumerate(operations)
            if i not in completed_embeddable_indices
        ]
        if final_pending_embeddables:
            print(f"Appending {len(final_pending_embeddables)} fallback late operation(s) at end of part stream.")
            process_layer_embeddables(final_pending_embeddables, "Fallback Late Placement")

        # Prusa files add their own end block. The U1 file already ends with PRINT_END.
        if not use_orca:
            with open(os.path.join(snippet_dir, f"{file_prefix}end.gcode"), "r") as f:
                for line in f:
                    writer.write_line(line.rstrip())

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
