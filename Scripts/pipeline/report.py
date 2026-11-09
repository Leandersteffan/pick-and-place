"""Bed offsets the assembler used, recomputed from the files run() leaves behind. run() does not call this."""

import os

from pipeline.geometry import housing_clearance, mesh_bounds, shared_bed_shift
from pipeline.slicer import printer_setup


def bed_offsets(spec_dir, spec):
    """Same arithmetic as the Orca branch of run.py, on tray.stl and the housing in spec_dir.

    Returns None when the tray and the housing do not fit on the bed together,
    which is where run() raises "Tray and housing do not fit on the bed together."
    """
    _prefix, _wipe, _retract, use_orca = printer_setup(spec.get("printer", ""))
    if not use_orca:
        return {
            "tray": [0.0, 0.0],
            "model": [0.0, 0.0],
            "extra_y": 0.0,
            "housing_clearance": 0.0,
            "source": "pipeline",
        }
    housing = os.path.join(spec_dir, spec.get("housing") or "housing.3mf")
    tray_bounds = mesh_bounds(os.path.join(spec_dir, "tray.stl"))
    model_bounds = mesh_bounds(housing)
    extra_y = housing_clearance(tray_bounds, model_bounds, 10.0)
    if extra_y:
        model_bounds = (model_bounds[0], model_bounds[1] + extra_y, model_bounds[2], model_bounds[3] + extra_y)
    bed = shared_bed_shift((tray_bounds, model_bounds))
    if bed is None:
        return None
    return {
        "tray": [bed[0], bed[1]],
        "model": [bed[0], bed[1] + extra_y],
        "extra_y": extra_y,
        "housing_clearance": extra_y,
        "source": "pipeline",
    }
