# Print in place.
#
# This file is the program. Rhino runs it. Nothing is installed.
# In Rhino 8, run ScriptEditor, open this file, and press Run.
# The window builds the model: housing, traces, vias, parts, and a grid.
# Slice writes spec.json and runs the pipeline. It does not send a print.
# Grasshopper stays closed.
# Edit this file, save, close the old window, and press Run again.

import importlib
import json
import math
import os
import shutil
import subprocess
import sys

import scriptcontext as sc
import Rhino
import Rhino.DocObjects as docobjects
import Rhino.Geometry as geometry
import Eto.Drawing as drawing
import Eto.Forms as forms
import System.Drawing as system_drawing
import System.Reflection
from Rhino.UI import EtoExtensions

WINDOW_KEY = "print_in_place_window"
GRID_MARKER = "PrintegrateGrid"
HOUSING_SIZE = (20.0, 12.0, 3.0)

PARTS = (
    ("Sequin", "Sequin.3dm"),
    ("Xiao", "Xiao.3dm"),
    ("WS2812b", "WS2812b.3dm"),
    ("Flora", "FloraPixel.3dm"),
    ("CR2032", "CR2032.3dm"),
)

LAYER_COLORS = {
    "Default": system_drawing.Color.FromArgb(180, 180, 180),
    "Traces": system_drawing.Color.FromArgb(220, 90, 40),
    "Part": system_drawing.Color.FromArgb(40, 90, 200),
    "PLA": system_drawing.Color.FromArgb(40, 160, 80),
    "Pick": system_drawing.Color.FromArgb(180, 40, 180),
    "Subtract": system_drawing.Color.FromArgb(120, 40, 160),
    "Grid": system_drawing.Color.FromArgb(20, 20, 20),
}

POINT = 1
CURVE = 4
SURFACE = 8
BREP = 16
MESH = 32
BLOCK = 4096
EXTRUSION = 1073741824
SOLID_TYPES = BREP | EXTRUSION | SURFACE

NAMES = {
    "closed solid": ("closed solid", "closed solids"),
    "open solid": ("open solid", "open solids"),
    "curve": ("curve", "curves"),
    "point": ("point", "points"),
    "mesh": ("mesh", "meshes"),
    "block": ("block", "blocks"),
    "other": ("other object", "other objects"),
}

LAYER_KINDS = (
    ("Default", ("closed solid", "open solid", "mesh", "curve", "point", "block")),
    ("Traces", ("curve", "point", "closed solid", "block")),
    ("Part", ("closed solid", "open solid", "mesh", "point", "block")),
    ("PLA", ("closed solid", "open solid", "mesh", "block")),
    ("Pick", ("point", "curve", "closed solid")),
    ("Subtract", ("closed solid", "open solid", "mesh")),
)

_after_command = []
_slicing = False


def project_root():
    here = globals().get("__file__")
    if not here:
        return None
    return os.path.dirname(os.path.dirname(os.path.abspath(here)))


def count_phrase(count, kind):
    singular, plural = NAMES[kind]
    if count == 1:
        return "1 " + singular
    return "{0} {1}".format(count, plural)


def is_closed_solid(shape):
    brep = None
    if isinstance(shape, geometry.Brep):
        brep = shape
    elif isinstance(shape, geometry.Extrusion):
        brep = shape.ToBrep()
    elif isinstance(shape, geometry.Surface):
        brep = shape.ToBrep()
    return brep is not None and bool(brep.IsSolid)


def classify(obj):
    flags = int(obj.ObjectType)
    if flags & BLOCK:
        return "block"
    if flags & POINT:
        return "point"
    if flags & CURVE:
        return "curve"
    if flags & MESH:
        return "mesh"
    if flags & SOLID_TYPES:
        if is_closed_solid(obj.Geometry):
            return "closed solid"
        return "open solid"
    return "other"


def iter_objects(doc):
    found = doc.Objects.GetObjectList(docobjects.ObjectType.AnyObject)
    if not found:
        return []
    return list(found)


def find_layer(doc, name):
    wanted = name.lower()
    for layer in doc.Layers:
        if layer is None or layer.IsDeleted:
            continue
        if layer.Name.lower() == wanted:
            return layer.Index
    return -1


def ensure_layer(doc, name):
    index = find_layer(doc, name)
    if index >= 0:
        return index
    layer = docobjects.Layer()
    layer.Name = name
    layer.Color = LAYER_COLORS.get(name, system_drawing.Color.Black)
    return doc.Layers.Add(layer)


def ensure_model_layers(doc):
    for name in LAYER_COLORS:
        ensure_layer(doc, name)


def use_layer(doc, name):
    index = ensure_layer(doc, name)
    doc.Layers.SetCurrentLayerIndex(index, True)
    return index


def on_named_layer(doc, obj, name):
    try:
        layer = doc.Layers[obj.Attributes.LayerIndex]
    except Exception:
        return False
    path = layer.FullPath
    return path == name or path.startswith(name + "::")


def objects_on_layer(doc, name):
    return [obj for obj in iter_objects(doc) if on_named_layer(doc, obj, name)]


def layer_line(doc, name, kinds):
    if find_layer(doc, name) < 0:
        return "{0}: layer is missing".format(name)
    counts = {}
    for obj in objects_on_layer(doc, name):
        kind = classify(obj)
        counts[kind] = counts.get(kind, 0) + 1
    if not counts:
        return "{0}: nothing".format(name)
    phrases = []
    for kind in kinds:
        count = counts.pop(kind, 0)
        if count:
            phrases.append(count_phrase(count, kind))
    rest = sum(counts.values())
    if rest:
        phrases.append(count_phrase(rest, "other"))
    return "{0}: {1}".format(name, ", ".join(phrases))


def housing_line(doc):
    if find_layer(doc, "Default") < 0:
        return "Layer Default is missing. The housing goes on that layer."
    objects = objects_on_layer(doc, "Default")
    closed = [obj for obj in objects if classify(obj) == "closed solid"]
    if len(closed) == 1 and len(objects) == 1:
        return "The housing is one closed solid."
    if len(closed) == 0:
        return "No housing yet."
    if len(closed) == 1:
        return "One closed solid is on Default, with other objects on that layer."
    return "Default has {0} closed solids.".format(len(closed))


def report(doc):
    lines = ["Model: {0}".format(doc.Name or "Untitled"), ""]
    for name, kinds in LAYER_KINDS:
        lines.append(layer_line(doc, name, kinds))
    lines.append("")
    lines.append(housing_line(doc))
    return "\n".join(lines)


def run_later(script):
    def on_idle(sender, args):
        Rhino.RhinoApp.Idle -= on_idle
        Rhino.RhinoApp.RunScript(script, False)

    Rhino.RhinoApp.Idle += on_idle


def schedule(action):
    def on_idle(sender, args):
        Rhino.RhinoApp.Idle -= on_idle
        try:
            action()
        except Exception as exc:
            Rhino.RhinoApp.WriteLine(str(exc))

    Rhino.RhinoApp.Idle += on_idle


def on_command_finished(sender, args):
    try:
        Rhino.Commands.Command.EndCommand -= on_command_finished
    except Exception:
        pass
    pending = list(_after_command)
    del _after_command[:]
    for action in pending:
        try:
            action()
        except Exception:
            pass


def after_next_command(action):
    if not _after_command:
        Rhino.Commands.Command.EndCommand += on_command_finished
    _after_command.append(action)


POINT = 512


def release_stuck_snap():
    """Leave only point snap. Grid snap and the other object snaps stay off."""
    Rhino.ApplicationSettings.ModelAidSettings.GridSnap = False
    Rhino.ApplicationSettings.ModelAidSettings.Ortho = False
    Rhino.ApplicationSettings.ModelAidSettings.Osnap = True
    try:
        Rhino.ApplicationSettings.ModelAidSettings.OsnapModes = Rhino.ApplicationSettings.OsnapModes.Point
    except Exception:
        try:
            import rhinoscriptsyntax as rs
            rs.Osnap(True)
            rs.OsnapMode(POINT)
        except Exception:
            pass


def read_height(text):
    try:
        return float(str(text).strip().replace(",", "."))
    except Exception:
        return None


def read_spacing(text):
    try:
        value = float(str(text).strip().replace(",", "."))
    except Exception:
        return None
    if value < 0.2:
        return None
    return value


def remove_grid(doc):
    ids = []
    for obj in iter_objects(doc):
        if obj.Attributes.GetUserString(GRID_MARKER) == "1":
            ids.append(obj.Id)
    for item in ids:
        try:
            doc.Objects.Unlock(item, True)
        except Exception:
            pass
        doc.Objects.Delete(item, True)
    return len(ids)


def model_box(doc):
    box = geometry.BoundingBox.Empty
    for obj in iter_objects(doc):
        if obj.Geometry is None:
            continue
        if obj.Attributes.GetUserString(GRID_MARKER) == "1":
            continue
        box.Union(obj.Geometry.GetBoundingBox(True))
    return box


def show_grid(doc, spacing, height):
    release_stuck_snap()
    box = model_box(doc)
    if not box.IsValid or box.Diagonal.Length < 1.0:
        box = geometry.BoundingBox(
            geometry.Point3d(-15, -15, height),
            geometry.Point3d(15, 15, height),
        )
    else:
        box.Inflate(spacing * 2.0)
    min_x = math_floor(box.Min.X / spacing) * spacing
    max_x = math_ceil(box.Max.X / spacing) * spacing
    min_y = math_floor(box.Min.Y / spacing) * spacing
    max_y = math_ceil(box.Max.Y / spacing) * spacing
    if max_x <= min_x:
        max_x = min_x + spacing
    if max_y <= min_y:
        max_y = min_y + spacing
    count_x = int(round((max_x - min_x) / spacing)) + 1
    count_y = int(round((max_y - min_y) / spacing)) + 1
    if count_x > 400 or count_y > 400:
        return "That spacing is too fine for this area. Use a larger spacing."

    cloud = geometry.PointCloud()
    x_index = 0
    while x_index < count_x:
        y_index = 0
        x = min_x + x_index * spacing
        while y_index < count_y:
            cloud.Add(geometry.Point3d(x, min_y + y_index * spacing, height))
            y_index += 1
        x_index += 1

    remove_grid(doc)
    attributes = docobjects.ObjectAttributes()
    attributes.LayerIndex = ensure_layer(doc, "Grid")
    attributes.ColorSource = docobjects.ObjectColorSource.ColorFromObject
    attributes.ObjectColor = system_drawing.Color.Black
    attributes.SetUserString(GRID_MARKER, "1")
    doc.Objects.AddPointCloud(cloud, attributes)
    doc.Views.Redraw()
    return "Grid on: {0} dots, {1} mm apart, at height {2} mm. Point snap is on.".format(
        cloud.Count, spacing, height
    )


def math_floor(value):
    return int(value) if value >= 0 or value == int(value) else int(value) - 1


def math_ceil(value):
    floored = math_floor(value)
    if abs(value - floored) < 1e-9:
        return floored
    return floored + 1


def make_housing(doc):
    ensure_model_layers(doc)
    existing = [obj for obj in objects_on_layer(doc, "Default") if classify(obj) == "closed solid"]
    if existing:
        return "A housing is already on Default."
    width, depth, height = HOUSING_SIZE
    box = geometry.BoundingBox(
        geometry.Point3d(0, 0, 0),
        geometry.Point3d(width, depth, height),
    )
    attributes = docobjects.ObjectAttributes()
    attributes.LayerIndex = ensure_layer(doc, "Default")
    attributes.Name = "Housing"
    serial = doc.BeginUndoRecord("Make housing")
    doc.Objects.Add(box.ToBrep(), attributes)
    doc.EndUndoRecord(serial)
    view = doc.Views.ActiveView
    if view is not None:
        padded = geometry.BoundingBox(
            geometry.Point3d(-10, -10, -5),
            geometry.Point3d(width + 10, depth + 10, height + 10),
        )
        view.ActiveViewport.ZoomBoundingBox(padded)
    doc.Views.Redraw()
    return "A {0:g} by {1:g} by {2:g} mm housing is on Default.".format(width, depth, height)


def draw_housing(doc):
    ensure_model_layers(doc)
    use_layer(doc, "Default")
    release_stuck_snap()
    Rhino.ApplicationSettings.ModelAidSettings.Ortho = True

    def finish():
        Rhino.ApplicationSettings.ModelAidSettings.Ortho = False

    after_next_command(finish)
    run_later("! _Box")
    return "Click the housing corners in the view, then click its height."


def unlock_all(doc):
    for obj in iter_objects(doc):
        try:
            if obj.IsLocked:
                doc.Objects.Unlock(obj.Id, True)
        except Exception:
            pass


def mark_contact_points(doc):
    """The two red dots are the Part-layer points Grasshopper used as contacts."""
    for obj in iter_objects(doc):
        if obj.Geometry is None or not isinstance(obj.Geometry, geometry.Point):
            continue
        try:
            name = doc.Layers[obj.Attributes.LayerIndex].Name
        except Exception:
            continue
        if name not in ("Part", "Parts") and obj.Attributes.GetUserString("pip_snap") != "1":
            continue
        attr = obj.Attributes.Duplicate()
        attr.SetUserString("pip_snap", "1")
        attr.ColorSource = docobjects.ObjectColorSource.ColorFromObject
        attr.ObjectColor = system_drawing.Color.FromArgb(220, 30, 30)
        doc.Objects.ModifyAttributes(obj, attr, True)


def draw_trace(doc):
    # Same sequence as Scripts/draw_trace.py: Traces layer, ortho, Rhino's line.
    ensure_model_layers(doc)
    use_layer(doc, "Traces")
    unlock_all(doc)
    mark_contact_points(doc)
    release_stuck_snap()
    Rhino.ApplicationSettings.ModelAidSettings.Ortho = True

    def finish():
        Rhino.ApplicationSettings.ModelAidSettings.Ortho = False

    after_next_command(finish)
    run_later("! _Line")
    return "Click the two ends. Ortho is on. The line snaps to the red points."


def add_via(doc):
    ensure_model_layers(doc)
    use_layer(doc, "Traces")
    unlock_all(doc)
    mark_contact_points(doc)
    release_stuck_snap()
    run_later("! _Point")
    return "Click the via. It snaps to the red points."


def object_box(doc, ids):
    box = geometry.BoundingBox.Empty
    for item in ids:
        obj = doc.Objects.FindId(item)
        if obj is None or obj.Geometry is None:
            continue
        box.Union(obj.Geometry.GetBoundingBox(True))
    return box


def transform_ids(doc, ids, xform):
    for item in ids:
        doc.Objects.Transform(item, xform, True)


def axis_length(box, axis):
    if axis == 0:
        return box.Max.X - box.Min.X
    if axis == 1:
        return box.Max.Y - box.Min.Y
    return box.Max.Z - box.Min.Z


def block_name_taken(doc, name):
    """Find returns the definition, or null. It does not return an index."""
    try:
        found = doc.InstanceDefinitions.Find(name, True)
    except TypeError:
        found = doc.InstanceDefinitions.Find(name)
    if found is None:
        return False
    try:
        return int(found) >= 0
    except Exception:
        return True


def unique_block_name(doc, name):
    base = name or "Part"
    candidate = base
    number = 2
    while block_name_taken(doc, candidate):
        candidate = "{0} {1}".format(base, number)
        number += 1
        if number > 500:
            break
    return candidate


def add_block(doc, name, description, geoms, attrs):
    return doc.InstanceDefinitions.Add(
        unique_block_name(doc, name),
        description or "",
        geometry.Point3d.Origin,
        list(geoms),
        list(attrs),
    )


def part_attributes(source, layer_index, snap_point):
    attr = source.Attributes.Duplicate()
    attr.LayerIndex = layer_index
    attr.SetUserString("pip_snap" if snap_point else "pip_body", "1")
    if snap_point:
        attr.ColorSource = docobjects.ObjectColorSource.ColorFromObject
        attr.ObjectColor = system_drawing.Color.FromArgb(220, 30, 30)
    return attr


def source_layer(doc, model, attributes):
    try:
        layers = list(model.AllLayers)
    except Exception:
        layers = list(model.Layers)
    name = "Part"
    index = int(attributes.LayerIndex)
    if 0 <= index < len(layers) and layers[index].Name:
        name = layers[index].Name
    return ensure_layer(doc, name), name


def file_object_id(attributes):
    """Rhino's own attributes type does not expose Id the way the file reader does."""
    flags = (
        System.Reflection.BindingFlags.Instance
        | System.Reflection.BindingFlags.Public
        | System.Reflection.BindingFlags.NonPublic
    )
    current = attributes.GetType()
    while current is not None:
        for prop_name in ("Id", "ObjectId"):
            prop = current.GetProperty(prop_name, flags)
            if prop is not None:
                return prop.GetValue(attributes, None)
        field = current.GetField("m_uuid", flags)
        if field is not None:
            return field.GetValue(attributes)
        current = current.BaseType
    raise RuntimeError("Rhino did not expose the object id in this file.")


def guid_key(value):
    return str(value).strip().lower()


def load_component(doc, path, layer_index):
    """Copy the component file into the model without asking Rhino to insert it."""
    model = Rhino.FileIO.File3dm.Read(path)
    if model is None:
        return []
    scale = Rhino.RhinoMath.UnitScale(model.Settings.ModelUnitSystem, doc.ModelUnitSystem)
    by_id = {}
    for obj in model.Objects:
        by_id[guid_key(file_object_id(obj.Attributes))] = obj

    definitions = list(model.AllInstanceDefinitions)
    id_to_new = {}
    pending = list(definitions)
    for _unused in range(len(definitions) + 2):
        if not pending:
            break
        still = []
        for idef in pending:
            geoms = []
            attrs = []
            waiting = False
            for member_id in idef.GetObjectIds():
                source = by_id.get(guid_key(member_id))
                if source is None or source.Geometry is None:
                    continue
                copy = source.Geometry.Duplicate()
                if isinstance(copy, geometry.InstanceReferenceGeometry):
                    parent = guid_key(copy.ParentIdefId)
                    if parent not in id_to_new:
                        waiting = True
                        break
                    copy = geometry.InstanceReferenceGeometry(id_to_new[parent], copy.Xform)
                if abs(scale - 1.0) > 1e-9:
                    copy.Transform(geometry.Transform.Scale(geometry.Point3d.Origin, scale))
                geoms.append(copy)
                attrs.append(part_attributes(source, layer_index, False))
            if waiting:
                still.append(idef)
                continue
            if not geoms:
                continue
            added = add_block(doc, idef.Name, idef.Description, geoms, attrs)
            if added is None:
                raise RuntimeError("Could not add the block {0}.".format(idef.Name))
            added_index = int(added)
            if added_index < 0:
                raise RuntimeError("Could not add the block {0}.".format(idef.Name))
            definition = doc.InstanceDefinitions[added_index]
            if definition is None:
                raise RuntimeError("Could not add the block {0}.".format(idef.Name))
            id_to_new[guid_key(idef.Id)] = definition.Id
        if len(still) == len(pending):
            break
        pending = still

    members = set()
    for idef in definitions:
        for member_id in idef.GetObjectIds():
            members.add(guid_key(member_id))

    added_ids = []
    for obj in model.Objects:
        if guid_key(file_object_id(obj.Attributes)) in members or obj.Geometry is None:
            continue
        copy = obj.Geometry.Duplicate()
        if isinstance(copy, geometry.InstanceReferenceGeometry):
            parent = guid_key(copy.ParentIdefId)
            if parent not in id_to_new:
                continue
            xform = copy.Xform
            if abs(scale - 1.0) > 1e-9:
                xform = geometry.Transform.Multiply(
                    geometry.Transform.Scale(geometry.Point3d.Origin, scale),
                    xform,
                )
            copy = geometry.InstanceReferenceGeometry(id_to_new[parent], xform)
        elif abs(scale - 1.0) > 1e-9:
            copy.Transform(geometry.Transform.Scale(geometry.Point3d.Origin, scale))
        layer_for_object, layer_name = source_layer(doc, model, obj.Attributes)
        snap_point = isinstance(copy, geometry.Point) and layer_name in ("Part", "Parts")
        guid = doc.Objects.Add(copy, part_attributes(obj, layer_for_object, snap_point))
        if guid.ToString() != "00000000-0000-0000-0000-000000000000":
            added_ids.append(guid)
    return added_ids


def settle_on_housing(doc, ids):
    box = object_box(doc, ids)
    if not box.IsValid:
        return box
    target_x = 0.0
    target_y = 0.0
    seat = 0.0
    housing = [obj for obj in objects_on_layer(doc, "Default") if classify(obj) == "closed solid"]
    if housing:
        bounds = geometry.BoundingBox.Empty
        for obj in housing:
            bounds.Union(obj.Geometry.GetBoundingBox(True))
        target_x = bounds.Center.X
        target_y = bounds.Center.Y
    transform_ids(doc, ids, geometry.Transform.Translation(
        target_x - box.Center.X,
        target_y - box.Center.Y,
        seat - box.Min.Z,
    ))
    try:
        doc.Groups.Add(ids)
    except Exception:
        pass
    box = object_box(doc, ids)
    view = doc.Views.ActiveView
    if view is not None and box.IsValid:
        padded = geometry.BoundingBox(box.Min, box.Max)
        padded.Inflate(8.0)
        view.ActiveViewport.ZoomBoundingBox(padded)
    doc.Views.Redraw()
    return box


def import_part(doc, filename):
    root = project_root()
    if root is None:
        return "This script has no file path, so the part library cannot be found."
    path = os.path.join(root, "resources", "Components", filename)
    if not os.path.isfile(path):
        return "Missing " + filename
    ensure_model_layers(doc)
    use_layer(doc, "Part")
    release_stuck_snap()
    layer_index = ensure_layer(doc, "Part")
    serial = doc.BeginUndoRecord("Import " + filename)
    try:
        ids = load_component(doc, path, layer_index)
        box = settle_on_housing(doc, ids) if ids else None
    finally:
        doc.EndUndoRecord(serial)
    if not ids or box is None or not box.IsValid:
        return "{0} was read, but no geometry was added.".format(filename)
    snaps = 0
    for item in ids:
        obj = doc.Objects.FindId(item)
        if obj is not None and obj.Attributes.GetUserString("pip_snap") == "1":
            snaps += 1
    return "{0} added. Its bottom is at Z=0, centered in the housing. {1} contact points stick while a trace is drawn. Delete the copy that is sitting on the lid.".format(
        filename,
        snaps,
    )


def hide_grid(doc):
    removed = remove_grid(doc)
    doc.Views.Redraw()
    if removed:
        return "Grid dots are hidden."
    return "No grid dots were in the model."


def load_spec_build():
    folder = os.path.join(project_root(), "plugin")
    if folder not in sys.path:
        sys.path.insert(0, folder)
    import spec_build
    return importlib.reload(spec_build)


def object_layer_name(doc, obj):
    try:
        return doc.Layers[obj.Attributes.LayerIndex].Name
    except Exception:
        return ""


def as_brep(shape):
    if isinstance(shape, geometry.Brep):
        return shape
    if isinstance(shape, geometry.Extrusion) or isinstance(shape, geometry.Surface):
        return shape.ToBrep()
    return None


def curve_ends(curve):
    if isinstance(curve, geometry.LineCurve):
        line = curve.Line
        start, end = line.From, line.To
        return (start.X, start.Y, start.Z, end.X, end.Y, end.Z)
    try:
        if curve.IsLinear(0.01):
            start = curve.PointAtStart
            end = curve.PointAtEnd
            return (start.X, start.Y, start.Z, end.X, end.Y, end.Z)
    except Exception:
        return None
    return None


def enlarge_cutter(brep):
    """Grasshopper scales the cutters by 1.001 so the boolean opens a real pocket."""
    box = brep.GetBoundingBox(True)
    copy = brep.DuplicateBrep()
    copy.Transform(geometry.Transform.Scale(box.Center, 1.001))
    return copy


def trace_cutter_brep(record):
    start = record["line_from"]
    end = record["line_to"]
    width = float(record["width"])
    height = float(record["height"])
    ax, ay, az = float(start["x"]), float(start["y"]), float(start["z"])
    bx, by = float(end["x"]), float(end["y"])
    dx = bx - ax
    dy = by - ay
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return None
    side_x = -dy / length * width / 2.0
    side_y = dx / length * width / 2.0
    corners = [
        geometry.Point3d(ax + side_x, ay + side_y, az),
        geometry.Point3d(ax - side_x, ay - side_y, az),
        geometry.Point3d(bx - side_x, by - side_y, az),
        geometry.Point3d(bx + side_x, by + side_y, az),
        geometry.Point3d(ax + side_x, ay + side_y, az),
    ]
    curve = geometry.Polyline(corners).ToNurbsCurve()
    extrusion = geometry.Extrusion.Create(curve, -height, True)
    if extrusion is None:
        return None
    brep = extrusion.ToBrep()
    if brep is None or not brep.IsSolid:
        return None
    return brep


def solid_volume(brep):
    try:
        result = brep.GetVolume()
    except Exception:
        return None
    if isinstance(result, tuple):
        return float(result[-1])
    try:
        return float(result)
    except Exception:
        return None


def cut_pockets(housing, cutters):
    """Housing minus trace grooves minus the Subtract-layer solids. Same difference Grasshopper sliced."""
    if not cutters:
        raise RuntimeError("There is nothing to cut out of the housing.")
    current = housing
    before = solid_volume(housing)
    for cutter in cutters:
        opened = enlarge_cutter(cutter)
        result = geometry.Brep.CreateBooleanDifference(current, opened, 0.001)
        pieces = [item for item in list(result or []) if item is not None and item.IsSolid]
        if not pieces:
            raise RuntimeError("A pocket could not be cut from the housing. The housing has to cover the part and the traces.")
        current = max(pieces, key=lambda item: item.GetBoundingBox(True).Volume)
    after = solid_volume(current)
    if before is not None and after is not None and after >= before - 0.01:
        raise RuntimeError("The housing was not reduced. The pockets were not cut.")
    return current


def pocket_cutters(doc, parts):
    cutters = []
    for record in parts:
        if record["type"] != "trace_cloth":
            continue
        cutter = trace_cutter_brep(record)
        if cutter is None:
            raise RuntimeError("A trace groove could not be built.")
        cutters.append(cutter)
    subtractors = [
        as_brep(obj.Geometry)
        for obj in objects_on_layer(doc, "Subtract")
        if classify(obj) == "closed solid"
    ]
    subtractors = [item for item in subtractors if item is not None]
    if not subtractors:
        raise RuntimeError("The part has no closed solid on the Subtract layer, so its pocket cannot be cut.")
    cutters.extend(subtractors)
    return cutters


def housing_brep(doc):
    solids = [obj for obj in objects_on_layer(doc, "Default") if classify(obj) == "closed solid"]
    if len(solids) != 1:
        if not solids:
            raise RuntimeError("Put one closed housing on the Default layer.")
        raise RuntimeError("Default has {0} closed solids. Leave one housing.".format(len(solids)))
    brep = as_brep(solids[0].Geometry)
    if brep is None:
        raise RuntimeError("The housing on Default is not a solid.")
    return brep


def collect_model(doc):
    contacts = []
    traces = []
    bad_traces = 0
    components = []
    for obj in iter_objects(doc):
        if obj.Attributes.GetUserString(GRID_MARKER) == "1":
            continue
        shape = obj.Geometry
        if shape is None:
            continue
        name = object_layer_name(doc, obj)
        if isinstance(shape, geometry.Point):
            tagged = obj.Attributes.GetUserString("pip_snap") == "1"
            if tagged or name in ("Part", "Parts"):
                point = shape.Location
                contacts.append((point.X, point.Y, point.Z))
            continue
        if name == "Traces" and int(obj.ObjectType) & CURVE:
            ends = curve_ends(shape)
            if ends is None:
                bad_traces += 1
            else:
                traces.append(ends)
            continue
        if name in ("Part", "Parts", "PLA"):
            brep = as_brep(shape)
            if brep is None:
                continue
            box = brep.GetBoundingBox(True)
            if not box.IsValid or box.Diagonal.Length < 0.2:
                continue
            if (box.Max.X - box.Min.X) <= 0 or (box.Max.Y - box.Min.Y) <= 0:
                continue
            kind = "print" if name == "PLA" else "pcb"
            components.append((kind, brep, (
                box.Min.X, box.Min.Y, box.Min.Z, box.Max.X, box.Max.Y, box.Max.Z,
            )))
    if bad_traces:
        raise RuntimeError("{0} trace(s) are not straight. Draw them with Draw trace.".format(bad_traces))
    return contacts, traces, components


def meshes_from_brep(brep):
    created = geometry.Mesh.CreateFromBrep(brep, geometry.MeshingParameters.Default)
    if not created:
        return []
    return [item for item in created if item is not None and item.IsValid and item.Vertices.Count > 0]


def write_stl(meshes, path):
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


def export_housing_3mf(meshes, path):
    headless = Rhino.RhinoDoc.CreateHeadless(None)
    try:
        options = Rhino.FileIO.File3mfWriteOptions()
        options.Title = "Print in place"
        combined = geometry.Mesh()
        for mesh in meshes:
            combined.Append(mesh)
        if combined.Vertices.Count == 0:
            return False
        headless.Objects.AddMesh(combined)
        return bool(headless.Export(path, options.ToDictionary()))
    finally:
        headless.Dispose()


def export_housing_extra(meshes, path, options_name):
    try:
        options = getattr(Rhino.FileIO, options_name)()
    except Exception:
        return
    headless = Rhino.RhinoDoc.CreateHeadless(None)
    try:
        combined = geometry.Mesh()
        for mesh in meshes:
            combined.Append(mesh)
        if combined.Vertices.Count == 0:
            return
        headless.Objects.AddMesh(combined)
        headless.Export(path, options.ToDictionary())
    finally:
        headless.Dispose()


def outside_env():
    env = os.environ.copy()
    for key in ("PYTHONHOME", "PYTHONPATH", "PYTHONNOUSERSITE", "PYTHONSTARTUP", "PYTHONSAFEPATH"):
        env.pop(key, None)
    return env


def gather_job(doc):
    root = project_root()
    if root is None:
        raise RuntimeError("This script has no file path, so the project folder cannot be found.")
    scripts = os.path.join(root, "Scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    import machine_config
    machine = machine_config.load_machine(root)
    python_path = machine_config.tool_path(machine, "python")
    machine_config.tool_path(machine, "orca")
    contacts, traces, components = collect_model(doc)
    builder = load_spec_build()
    boxes = [(kind, box) for kind, _brep, box in components]
    parts, errors = builder.build_parts(traces, contacts, boxes)
    if errors:
        raise RuntimeError(errors[0])
    if not parts:
        raise RuntimeError("Draw a trace or place a part before slicing.")
    housing = cut_pockets(housing_brep(doc), pocket_cutters(doc, parts))
    trace_count = sum(1 for item in parts if item["type"] == "trace_cloth")
    component_count = len(parts) - trace_count
    return {
        "root": root,
        "python": python_path,
        "housing": housing,
        "parts": parts,
        "components": components,
        "trace_count": trace_count,
        "component_count": component_count,
        "spec": builder.spec_document(parts),
    }


def run_slice(job):
    root = job["root"]
    output_dir = os.path.join(root, "output")
    try:
        if os.path.isdir(output_dir):
            shutil.rmtree(output_dir)
    except Exception:
        raise RuntimeError("Could not clear output. Close combined_output.gcode if it is open in Orca.")
    spec_dir = os.path.join(output_dir, "spec")
    os.makedirs(spec_dir)
    housing_meshes = meshes_from_brep(job["housing"])
    if not housing_meshes:
        raise RuntimeError("The housing did not mesh.")
    housing_path = os.path.join(spec_dir, "housing.3mf")
    if not export_housing_3mf(housing_meshes, housing_path):
        raise RuntimeError("The housing did not export.")
    export_housing_extra(housing_meshes, os.path.join(spec_dir, "housing.stl"), "FileStlWriteOptions")
    export_housing_extra(housing_meshes, os.path.join(spec_dir, "housing.step"), "FileStpWriteOptions")
    component_index = 0
    for record in job["parts"]:
        if record["type"] not in ("pcb", "print"):
            continue
        _kind, brep, _box = job["components"][component_index]
        component_index += 1
        meshes = meshes_from_brep(brep)
        if not meshes:
            raise RuntimeError("A component did not mesh, so its tray pocket cannot be cut.")
        write_stl(meshes, os.path.join(spec_dir, record["mesh"]))
    spec_path = os.path.join(spec_dir, "spec.json")
    with open(spec_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(job["spec"], handle, indent=2)
        handle.write("\n")
    scripts = os.path.join(root, "Scripts")
    command = [job["python"], "-m", "pipeline", spec_dir, "--project", root]
    log_path = os.path.join(output_dir, "slice_log.txt")
    with open(log_path, "w", encoding="utf-8") as log:
        log.write(" ".join(command) + "\n")
        log.flush()
        completed = subprocess.run(
            command,
            cwd=scripts,
            env=outside_env(),
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    if completed.returncode != 0:
        raise RuntimeError("The slicer failed. See output/slice_log.txt.")
    return "Sliced. The printer file is output/combined_output.gcode."


def show_window():
    """Open one modeless builder for the active Rhino document."""
    if sc.doc is None:
        print("Open a Rhino model, then run this file again.")
        return

    previous = sc.sticky.get(WINDOW_KEY)
    if previous is not None:
        try:
            previous.Close()
        except Exception:
            pass

    doc = sc.doc
    release_stuck_snap()
    ensure_model_layers(doc)
    doc.Views.Redraw()

    instruction = forms.Label()
    instruction.Text = "Only point snap is on. Ortho is on while you draw a trace or a housing."
    instruction.Wrap = forms.WrapMode.Word

    status = forms.Label()
    status.Text = report(doc)
    status.Wrap = forms.WrapMode.Word

    spacing_box = forms.TextBox()
    spacing_box.Text = "2"
    spacing_box.Width = 64

    height_box = forms.TextBox()
    height_box.Text = "0"
    height_box.Width = 64

    def current_spacing():
        return read_spacing(spacing_box.Text)

    def current_height():
        value = read_height(height_box.Text)
        if value is None:
            return 0.0
        return value

    def guarded(action):
        def handler(sender, args):
            try:
                instruction.Text = action()
                status.Text = report(doc)
            except Exception as exc:
                instruction.Text = "That did not run: {0}".format(exc)
        return handler

    def refresh_later():
        def refresh():
            status.Text = report(doc)
        after_next_command(refresh)

    def on_make_housing():
        return make_housing(doc)

    def on_draw_housing():
        refresh_later()
        return draw_housing(doc)

    def on_trace():
        refresh_later()
        return draw_trace(doc)

    def on_via():
        refresh_later()
        return add_via(doc)

    def on_show_grid():
        spacing = current_spacing()
        if spacing is None:
            return "Type a grid spacing of 0.2 mm or more."
        return show_grid(doc, spacing, current_height())

    def on_hide_grid():
        return hide_grid(doc)

    def on_slice():
        global _slicing
        if _slicing:
            return "A slice is already running."
        try:
            job = gather_job(doc)
        except Exception as exc:
            return str(exc)

        def work():
            global _slicing
            _slicing = True
            try:
                instruction.Text = run_slice(job)
            except Exception as exc:
                instruction.Text = str(exc)
            finally:
                _slicing = False
            status.Text = report(doc)

        schedule(work)
        return "Slicing {0} traces and {1} components. The pockets are cut out of the housing first. Rhino waits until Orca finishes.".format(
            job["trace_count"], job["component_count"]
        )

    def on_part(filename):
        def action():
            return import_part(doc, filename)
        return action

    def button(caption, action):
        item = forms.Button()
        item.Text = caption
        item.MinimumSize = drawing.Size(140, 28)
        item.Click += guarded(action)
        return item

    def caption(text):
        item = forms.Label()
        item.Text = text
        item.VerticalAlignment = forms.VerticalAlignment.Center
        return item

    def pair(left, right):
        row = forms.TableLayout()
        row.Spacing = drawing.Size(8, 0)
        row.Rows.Add(forms.TableRow(
            forms.TableCell(left, True),
            forms.TableCell(right, True),
        ))
        return row

    fields = forms.StackLayout()
    fields.Orientation = forms.Orientation.Horizontal
    fields.Spacing = 8
    fields.VerticalContentAlignment = forms.VerticalAlignment.Center
    fields.Items.Add(forms.StackLayoutItem(caption("Grid mm"), False))
    fields.Items.Add(forms.StackLayoutItem(spacing_box, False))
    fields.Items.Add(forms.StackLayoutItem(caption("Height mm"), False))
    fields.Items.Add(forms.StackLayoutItem(height_box, False))

    stack = forms.StackLayout()
    stack.Orientation = forms.Orientation.Vertical
    stack.Padding = drawing.Padding(12)
    stack.Spacing = 8
    stack.HorizontalContentAlignment = forms.HorizontalAlignment.Stretch
    stack.Items.Add(forms.StackLayoutItem(instruction))
    stack.Items.Add(forms.StackLayoutItem(pair(button("Make housing", on_make_housing), button("Draw housing", on_draw_housing))))
    stack.Items.Add(forms.StackLayoutItem(pair(button("Draw trace", on_trace), button("Add via", on_via))))
    stack.Items.Add(forms.StackLayoutItem(pair(button("Sequin", on_part("Sequin.3dm")), button("Xiao", on_part("Xiao.3dm")))))
    stack.Items.Add(forms.StackLayoutItem(pair(button("WS2812b", on_part("WS2812b.3dm")), button("Flora", on_part("FloraPixel.3dm")))))
    stack.Items.Add(forms.StackLayoutItem(pair(button("CR2032", on_part("CR2032.3dm")), button("Refresh", lambda: "Counts updated."))))
    stack.Items.Add(forms.StackLayoutItem(fields))
    stack.Items.Add(forms.StackLayoutItem(pair(button("Show grid", on_show_grid), button("Hide grid", on_hide_grid))))
    stack.Items.Add(forms.StackLayoutItem(button("Slice", on_slice)))
    stack.Items.Add(forms.StackLayoutItem(status))

    form = forms.Form()
    form.Title = "Print in place"
    form.ClientSize = drawing.Size(360, 520)
    form.MinimumSize = drawing.Size(360, 480)
    form.Content = stack

    def forget_window(sender, args):
        if sc.sticky.get(WINDOW_KEY) is form:
            sc.sticky.pop(WINDOW_KEY, None)

    form.Closed += forget_window
    sc.sticky[WINDOW_KEY] = form
    EtoExtensions.Show(form, doc)


show_window()
