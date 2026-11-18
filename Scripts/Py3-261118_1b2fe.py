import subprocess
import os
import shutil
import sys
import json
import Rhino


# Paths inside the Designer folder are found from this Grasshopper file.
# Python and Orca are read from machine.json in that folder.

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
    print("Project folder not found. Save this Grasshopper file inside the Designer folder, next to Scripts and resources.")
    return None


def _tool_from_machine(project_dir, key):
    """A program path from machine.json. Nothing outside the Designer folder is searched."""
    import machine_config
    try:
        return machine_config.tool_path(machine_config.load_machine(project_dir), key)
    except RuntimeError as error:
        print(str(error))
        return None


def resolve_orca(project_dir):
    return _tool_from_machine(project_dir, "orca")



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

def _outside_python(project_dir):
    """The system Python named in machine.json. Rhino's own Python does not have the tray libraries."""
    path = _tool_from_machine(project_dir, "python")
    if not path:
        return None
    return [path]


def _outside_env():
    """Drop Rhino's Python settings so the outside program can start."""
    env = os.environ.copy()
    for key in ("PYTHONHOME", "PYTHONPATH", "PYTHONNOUSERSITE", "PYTHONSTARTUP", "PYTHONSAFEPATH"):
        env.pop(key, None)
    return env


def process_print():
    """Export the housing and the spec, then run the outside pipeline."""
    global MODULE_PATH

    project_dir = resolve_project_root(globals().get("path"))
    if not project_dir:
        return
    MODULE_PATH = os.path.join(project_dir, "Scripts")
    if MODULE_PATH not in sys.path:
        sys.path.append(MODULE_PATH)

    use_trace_braid = bool(globals().get("braid", True))
    printer_name = str(globals().get("printer", "") or "").strip().lower()
    if printer_name in ("", "none"):
        printer_name = "snapmaker u1"
        print("Printer input was empty. Using snapmaker u1.")

    slicer_path = resolve_orca(project_dir)
    if not slicer_path:
        return

    print("Project folder: " + project_dir)
    print("OrcaSlicer: " + slicer_path)

    output_dir = os.path.join(project_dir, "output")
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir)

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

    python_cmd = _outside_python(project_dir)
    if not python_cmd:
        return
    command = python_cmd + ["-m", "pipeline", spec_dir, "--project", project_dir]
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
