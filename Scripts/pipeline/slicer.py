"""Call OrcaSlicer or PrusaSlicer. No Rhino."""

import os
import shutil
import subprocess


def is_u1(printer_name):
    name = (printer_name or "").strip().lower()
    return "u1" in name or "snapmaker" in name


def printer_setup(printer_name):
    name = (printer_name or "").strip().lower()
    if is_u1(name):
        from pipeline.settings import U1_WIPE_LOCATION
        return "U1_", U1_WIPE_LOCATION, 0.8, True
    if name in ("prusa xl", "xl"):
        from pipeline.settings import XL_WIPE_LOCATION
        return "XL_", XL_WIPE_LOCATION, 0.7, False
    if name in ("prusa mini", "mini"):
        from pipeline.settings import MINI_WIPE_LOCATION
        return "MINI_", MINI_WIPE_LOCATION, 0, False
    from pipeline.settings import XL_WIPE_LOCATION
    return "", XL_WIPE_LOCATION, 0.5, False


def resolve_orca(project_dir):
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    candidates = [
        os.path.join(program_files, "OrcaSlicer", "orca-slicer.exe"),
        r"C:\Program Files\OrcaSlicer\orca-slicer.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def resolve_prusa():
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    candidates = [
        os.path.join(program_files, "Prusa3D", "PrusaSlicer", "prusa-slicer-console.exe"),
        r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def gcode_has_layers(path):
    if not os.path.isfile(path):
        return False
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return ";LAYER_CHANGE" in handle.read()


def slice_model(slicer_path, use_orca, project_dir, file_prefix, input_file, output_file, output_dir):
    if use_orca:
        return _run_orca(slicer_path, project_dir, input_file, output_file, output_dir)
    config_path = os.path.join(project_dir, "resources", "{}config.ini".format(file_prefix))
    cmd = [slicer_path, "-s", "-g", "--load", config_path, "-o", output_file, input_file]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.returncode != 0:
        print(result.stderr)
        print("PrusaSlicer failed on " + os.path.basename(input_file))
    return result.returncode == 0 and gcode_has_layers(output_file)


def _run_orca(slicer_path, project_dir, input_file, output_file, output_dir):
    install = os.path.dirname(slicer_path)
    machine = os.path.join(
        install, "resources", "profiles", "Snapmaker", "machine", "Snapmaker U1 (0.4 nozzle).json"
    )
    process = os.path.join(project_dir, "resources", "u1", "process.json")
    filament = os.path.join(project_dir, "resources", "u1", "filament.json")
    missing = [path for path in (machine, process, filament) if not os.path.isfile(path)]
    if missing:
        print("Missing U1 slicer profile: " + missing[0])
        return False
    orca_dir = os.path.join(output_dir, os.path.splitext(os.path.basename(output_file))[0] + "_orca")
    if os.path.exists(orca_dir):
        shutil.rmtree(orca_dir)
    os.makedirs(orca_dir)
    cmd = [
        slicer_path,
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
        return False
    produced = [
        os.path.join(orca_dir, name)
        for name in os.listdir(orca_dir)
        if name.lower().endswith(".gcode")
    ]
    if not produced:
        print("OrcaSlicer wrote no gcode for " + os.path.basename(input_file))
        return False
    shutil.copyfile(produced[0], output_file)
    return gcode_has_layers(output_file)
