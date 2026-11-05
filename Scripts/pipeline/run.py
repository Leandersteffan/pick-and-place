"""Read a spec folder, build the tray, slice, and write combined_output.gcode."""

import json
import os
import sys

from pipeline.assemble import Part, assemble
from pipeline.geometry import housing_clearance, mesh_bounds, rewrite_bed_mesh, shared_bed_shift, shift_layer_moves, slicer_shift
from pipeline.slicer import is_u1, printer_setup, resolve_orca, resolve_prusa, slice_model
from pipeline.traygen import ensure_pick_points, write_tray


def load_spec(spec_dir):
    path = os.path.join(spec_dir, "spec.json")
    with open(path, "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    if spec.get("version") != 1:
        raise RuntimeError("This tool reads spec version 1. The file says {0}.".format(spec.get("version")))
    if not spec.get("parts"):
        raise RuntimeError("spec.json has no parts.")
    housing = os.path.join(spec_dir, spec.get("housing") or "housing.3mf")
    if not os.path.isfile(housing):
        raise RuntimeError("Housing mesh is missing: " + housing)
    return spec, housing


def run(spec_dir, project_dir):
    spec_dir = os.path.abspath(spec_dir)
    project_dir = os.path.abspath(project_dir)
    scripts = os.path.join(project_dir, "Scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)

    spec, housing = load_spec(spec_dir)
    output_dir = os.path.dirname(spec_dir)
    file_prefix, wipe_location, retract_amount, use_orca = printer_setup(spec.get("printer", ""))
    slicer_path = resolve_orca(project_dir) if use_orca else resolve_prusa()
    if not slicer_path:
        which = "OrcaSlicer" if use_orca else "PrusaSlicer"
        raise RuntimeError(which + " was not found in Program Files.")

    print("Spec: " + os.path.join(spec_dir, "spec.json"))
    print(("OrcaSlicer: " if use_orca else "PrusaSlicer: ") + slicer_path)

    bounds = mesh_bounds(housing)
    ensure_pick_points(spec, bounds)
    tray_path = os.path.join(spec_dir, "tray.stl")
    write_tray(spec, tray_path)
    with open(os.path.join(spec_dir, "spec.json"), "w", encoding="utf-8") as handle:
        json.dump(spec, handle, indent=2)
    print("Tray written to " + tray_path)

    setup_gcode = os.path.join(output_dir, "setup.gcode")
    part_gcode = os.path.join(output_dir, "part.gcode")
    print("Slicing tray...")
    if not slice_model(slicer_path, use_orca, project_dir, file_prefix, tray_path, setup_gcode, output_dir):
        raise RuntimeError("Slicing the tray produced no layers.")
    print("Slicing housing...")
    if not slice_model(slicer_path, use_orca, project_dir, file_prefix, housing, part_gcode, output_dir):
        raise RuntimeError("Slicing the housing produced no layers.")

    tray_shift = (0.0, 0.0)
    model_shift = (0.0, 0.0)
    if use_orca:
        tray_shift = slicer_shift(tray_path, setup_gcode)
        model_shift = slicer_shift(housing, part_gcode)
        if tray_shift is None or model_shift is None:
            raise RuntimeError("Could not match the sliced position to the mesh.")
        tray_bounds = mesh_bounds(tray_path)
        model_bounds = mesh_bounds(housing)
        extra_y = housing_clearance(tray_bounds, model_bounds, 10.0)
        if extra_y:
            model_bounds = (
                model_bounds[0],
                model_bounds[1] + extra_y,
                model_bounds[2],
                model_bounds[3] + extra_y,
            )
            print("Moved the housing {0:.1f} mm up so it clears the tray by 10 mm.".format(extra_y))
        bed_shift = shared_bed_shift((tray_bounds, model_bounds))
        if bed_shift is None:
            raise RuntimeError("Tray and housing do not fit on the bed together.")
        shift_layer_moves(setup_gcode, (-tray_shift[0] + bed_shift[0], -tray_shift[1] + bed_shift[1]))
        shift_layer_moves(
            part_gcode,
            (-model_shift[0] + bed_shift[0], -model_shift[1] + bed_shift[1] + extra_y),
        )
        rewrite_bed_mesh(setup_gcode, (tray_bounds, model_bounds), bed_shift)
        tray_shift = bed_shift
        model_shift = (bed_shift[0], bed_shift[1] + extra_y)
        print("Shared bed nudge {0:+.1f}, {1:+.1f} mm.".format(bed_shift[0], bed_shift[1]))

    parts = [Part(item) for item in spec["parts"]]
    final_output = os.path.join(output_dir, "combined_output.gcode")
    assemble(
        spec,
        parts,
        output_dir,
        project_dir,
        setup_gcode,
        part_gcode,
        final_output,
        wipe_location,
        retract_amount,
        tray_shift,
        model_shift,
        use_orca or is_u1(spec.get("printer", "")),
        file_prefix,
    )
    return final_output
