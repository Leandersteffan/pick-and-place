"""Turn a sliced tray and housing into one file with pause, pick, and place."""

import os
import re

from gcode_writer import GcodeWriter
from pipeline.settings import CONFIG, PART_START_EXTRA_PRIME, PART_START_Z_HOP, PLACE_HOVER_DWELL_TIME_MS


class Vec(object):
    def __init__(self, x, y, z):
        self.X = float(x)
        self.Y = float(y)
        self.Z = float(z)


class _PointRecord(object):
    def __init__(self, data):
        self.Position = Vec(data["x"], data["y"], data["z"])
        self.Type = int(data.get("type", 0))
        self.Overrides = data.get("overrides") or {}


class Part(object):
    def __init__(self, data):
        place = data["place"]
        pick = data.get("pick") or place
        self.kind = data["type"]
        self.PickPt = Vec(pick["x"], pick["y"], pick["z"])
        self.PlacePt = Vec(place["x"], place["y"], place["z"])
        layer = data.get("pause_layer")
        self.PauseLayer = int(layer) if layer is not None else None
        self.TampingPts = [_PointRecord(item) for item in data.get("tamps") or []]
        self.PrinjectionPoints = [_PointRecord(item) for item in data.get("prinjection") or []]
        self.Overrides = data.get("overrides") or {}


def _moved(pt, shift):
    return Vec(pt.X + shift[0], pt.Y + shift[1], pt.Z)


def _merge_config(base_config, overrides):
    if not overrides:
        return base_config.copy()
    merged = base_config.copy()
    for key, value in overrides.items():
        try:
            if key in merged:
                orig_val = merged[key]
                if isinstance(orig_val, bool):
                    merged[key] = str(value).lower() in ("true", "1", "yes")
                elif isinstance(orig_val, int) and not isinstance(orig_val, bool):
                    merged[key] = int(float(value))
                elif isinstance(orig_val, float):
                    merged[key] = float(value)
                else:
                    merged[key] = value
            else:
                try:
                    merged[key] = float(value)
                except (TypeError, ValueError):
                    merged[key] = value
        except Exception as error:
            print("Warning: Could not parse override {0}={1}: {2}".format(key, value, error))
    return merged


def _wipe(writer, location, retract_amount):
    writer.comment("Nozzle Wipe Sequence")
    wx, wy, wz = location
    writer.move_to(x=wx, y=wy, z=wz + 10, feedrate=24000)
    writer.move_to(z=wz, feedrate=24000)
    writer.extrude(amount=10.0, feedrate=2400)
    writer.write_line("G4 P500")
    writer.retract(amount=retract_amount)
    for _ in range(1):
        writer.move_to(x=wx + 30, feedrate=12000)
        writer.move_to(x=wx, feedrate=12000)
    writer.move_to(x=wx + 30, feedrate=12000)
    writer.move_to(z=wz + 10, feedrate=24000)


def _pick_and_place(writer, part, wipe_location, retract_amount, tray_shift, model_shift):
    cfg = _merge_config(CONFIG[part.kind], part.Overrides)
    writer.comment("=== Pick and Place: {0} ===".format(part.kind.upper()))
    pick_pt = _moved(part.PickPt, tray_shift)
    place_pt = _moved(part.PlacePt, model_shift)
    tamp_pts = part.TampingPts or []

    writer.move_to(z=writer.state.current_z + 10, feedrate=cfg["z_lift_feedrate"])
    writer.write_line("M107")
    _wipe(writer, wipe_location, retract_amount)

    writer.comment("Pick Sequence")
    writer.move_to(x=pick_pt.X, y=pick_pt.Y, feedrate=cfg["travel_feedrate"])
    writer.move_to(z=pick_pt.Z + 10, feedrate=cfg["z_lift_feedrate"])
    writer.unretract(amount=retract_amount)

    if cfg.get("pick_pre_extrude_amount", 0) > 0:
        writer.move_to(z=pick_pt.Z, feedrate=cfg["z_lift_feedrate"])
        writer.extrude(amount=cfg["pick_pre_extrude_amount"], feedrate=cfg["pick_extrude_feedrate"])
        writer.move_to(z=pick_pt.Z + cfg["pick_z_offset"], feedrate=cfg["z_lift_feedrate"])
    else:
        writer.move_to(z=pick_pt.Z + cfg["pick_z_offset"], feedrate=cfg["z_lift_feedrate"])

    writer.extrude(amount=cfg["pick_extrude_amount"], feedrate=cfg["pick_extrude_feedrate"])
    writer.comment("Cooling to grab...")
    writer.set_extruder_temp(cfg["pick_cool_temp"], wait=True)
    pick_dwell_time = cfg.get("pick_dwell_time", 0)
    if pick_dwell_time > 0:
        writer.write_line("G4 P{0}".format(pick_dwell_time))

    writer.comment("Place Sequence")
    writer.move_to(z=place_pt.Z + 10, feedrate=cfg["z_lift_feedrate"])
    writer.move_to(x=place_pt.X, y=place_pt.Y, feedrate=cfg["travel_feedrate"])

    if PLACE_HOVER_DWELL_TIME_MS > 0:
        writer.comment("Hover dwell before placing into cavity ({0} ms)".format(PLACE_HOVER_DWELL_TIME_MS))
        writer.write_line("G4 P{0}".format(PLACE_HOVER_DWELL_TIME_MS))

    if part.kind == "pcb":
        writer.move_to(z=place_pt.Z + cfg["place_preheat_height"], feedrate=cfg["z_lift_feedrate"])
        writer.move_to(z=place_pt.Z + cfg["place_z_offset"], feedrate=cfg["place_feedrate"])
        writer.extrude(-1, feedrate=2000)
        writer.write_line("G4 P{0}".format(cfg["place_dwell_time"]))
        writer.comment("Moving aside while cold...")
        writer.move_to(x=place_pt.X + cfg.get("place_side_offset", 1.0), feedrate=cfg["travel_feedrate"])
        writer.extrude(-2.5, feedrate=2000)
        writer.move_to(z=place_pt.Z + 10, feedrate=cfg["z_lift_feedrate"])
        wx, wy, wz = wipe_location
        writer.comment("Traveling to wipe station to release...")
        writer.move_to(x=wx, y=wy, z=wz + 10, feedrate=cfg["travel_feedrate"])
        writer.move_to(z=wz, feedrate=cfg["z_lift_feedrate"])
        writer.set_extruder_temp(cfg["place_heat_temp"], wait=True)
    elif part.kind == "print":
        writer.move_to(z=place_pt.Z + cfg["place_preheat_height"], feedrate=cfg["z_lift_feedrate"])
        writer.move_to(z=place_pt.Z + cfg["place_z_offset"], feedrate=cfg["place_feedrate"])
        writer.extrude(-1, feedrate=2000)
        writer.comment("Heating to release...")
        writer.set_extruder_temp(cfg["place_heat_temp"], wait=True)
    elif cfg["place_preheat_height"] > 0:
        writer.move_to(z=place_pt.Z + cfg["place_preheat_height"], feedrate=cfg["z_lift_feedrate"])
        writer.comment("Preheating before placement...")
        writer.set_extruder_temp(cfg["place_heat_temp"], wait=True)
        writer.move_to(z=place_pt.Z + cfg["place_z_offset"], feedrate=cfg["place_feedrate"])
        writer.extrude(-1, feedrate=2000)
    else:
        writer.move_to(z=place_pt.Z + cfg["place_z_offset"], feedrate=cfg["place_feedrate"])
        writer.comment("Heating to release...")
        writer.set_extruder_temp(cfg["place_heat_temp"], wait=True)

    writer.write_line("G4 P{0}".format(cfg["place_dwell_time"]))

    if part.kind == "print" and "place_side_offset" in cfg:
        writer.comment("Shear moving aside to release...")
        writer.move_to(z=place_pt.Z, feedrate=cfg.get("post_place_lift_feedrate", cfg["z_lift_feedrate"]))
        writer.move_to(x=place_pt.X + cfg["place_side_offset"], feedrate=cfg["travel_feedrate"])

    if part.kind == "pcb" and part.PrinjectionPoints:
        writer.comment("Starting Prinjection Sequence for PCB holes")
        _wipe(writer, wipe_location, retract_amount)
        prinjection_cfg = cfg["prinjection"]
        writer.write_line("M106")
        writer.unretract(amount=retract_amount)
        writer.retract(amount=prinjection_cfg["retract_amount"])
        is_first_hole = True
        for hole_idx, pt in enumerate(part.PrinjectionPoints):
            hole_pos = _moved(pt.Position, model_shift)
            pt_cfg = dict(prinjection_cfg)
            if pt.Overrides:
                for key, value in pt.Overrides.items():
                    if not str(key).startswith("prinjection_"):
                        continue
                    prinjection_key = str(key)[12:]
                    try:
                        if prinjection_key in pt_cfg:
                            orig_val = pt_cfg[prinjection_key]
                            if isinstance(orig_val, bool):
                                pt_cfg[prinjection_key] = str(value).lower() in ("true", "1", "yes")
                            elif isinstance(orig_val, int) and not isinstance(orig_val, bool):
                                pt_cfg[prinjection_key] = int(float(value))
                            elif isinstance(orig_val, float):
                                pt_cfg[prinjection_key] = float(value)
                            else:
                                pt_cfg[prinjection_key] = value
                        else:
                            try:
                                pt_cfg[prinjection_key] = float(value)
                            except (TypeError, ValueError):
                                pt_cfg[prinjection_key] = value
                    except Exception as error:
                        print("Warning: Could not parse point prinjection override {0}={1}: {2}".format(key, value, error))
            hover_z = hole_pos.Z + pt_cfg["hover_z_offset"]
            target_z = hole_pos.Z + pt_cfg["inject_z_offset"]
            writer.move_to(x=hole_pos.X, y=hole_pos.Y, feedrate=cfg["travel_feedrate"])
            writer.move_to(z=hover_z, feedrate=cfg["z_lift_feedrate"])
            writer.move_to(z=target_z, feedrate=cfg["z_lift_feedrate"])
            unretract_amt = pt_cfg["retract_amount"]
            if is_first_hole and "initial_extra_prime" in pt_cfg:
                unretract_amt += pt_cfg["initial_extra_prime"]
                is_first_hole = False
            writer.unretract(amount=unretract_amt)
            writer.extrude(amount=pt_cfg["extrude_amount"], feedrate=pt_cfg["extrude_feedrate"])
            writer.retract(amount=pt_cfg["retract_amount"])
            if pt_cfg["inject_z_offset"] < pt_cfg["swipe_z_offset"]:
                writer.move_to(z=hole_pos.Z + pt_cfg["swipe_z_offset"], feedrate=cfg["place_feedrate"])
            writer.comment("Side swipe to break stringing")
            writer.move_to(x=hole_pos.X + 1.5, y=hole_pos.Y + 1.5, feedrate=cfg["travel_feedrate"])
            writer.move_to(z=hover_z, feedrate=cfg["z_lift_feedrate"])
        writer.write_line("M107")
    elif part.kind == "print" and "place_side_offset" in cfg:
        writer.extrude(-2.5, feedrate=2000)
        writer.move_to(z=place_pt.Z + 10, feedrate=cfg.get("post_place_lift_feedrate", cfg["z_lift_feedrate"]))
        wx, wy, _wz = wipe_location
        writer.comment("Moving to wipe location before adjusting temp...")
        writer.move_to(x=wx, y=wy, feedrate=cfg["travel_feedrate"])
        writer.comment("Cooling down to wipe temp ({0})...".format(cfg.get("wipe_temp", 210)))
        writer.set_extruder_temp(cfg.get("wipe_temp", 210), wait=True)
    else:
        writer.extrude(-2.5, feedrate=2000)
        writer.move_to(z=place_pt.Z + 2, feedrate=cfg["z_lift_feedrate"])

    if tamp_pts:
        writer.comment("Tamping {0} Points".format(len(tamp_pts)))
        tamp_cfg = CONFIG["tamping"]
        for tamp_pt in tamp_pts:
            position = _moved(tamp_pt.Position, model_shift)
            type_cfg = dict(tamp_cfg[int(tamp_pt.Type)])
            if tamp_pt.Overrides:
                for key, value in tamp_pt.Overrides.items():
                    if str(key).startswith("prinjection_"):
                        continue
                    try:
                        if key in type_cfg:
                            orig_val = type_cfg[key]
                            if isinstance(orig_val, bool):
                                type_cfg[key] = str(value).lower() in ("true", "1", "yes")
                            elif isinstance(orig_val, int) and not isinstance(orig_val, bool):
                                type_cfg[key] = int(float(value))
                            elif isinstance(orig_val, float):
                                type_cfg[key] = float(value)
                            else:
                                type_cfg[key] = value
                        else:
                            try:
                                type_cfg[key] = float(value)
                            except (TypeError, ValueError):
                                type_cfg[key] = value
                    except Exception as error:
                        print("Warning: Could not parse tamping point override {0}={1}: {2}".format(key, value, error))
            writer.move_to(x=position.X, y=position.Y, feedrate=tamp_cfg["travel_feedrate"])
            writer.move_to(z=position.Z - type_cfg["depth_offset"], feedrate=type_cfg["feedrate"])
            writer.write_line("G4 P{0}".format(type_cfg["dwell_time"]))
            writer.move_to(z=position.Z + tamp_cfg["lift_height"], feedrate=tamp_cfg["lift_feedrate"])

    writer.write_line("M106")


def assemble(spec, parts, output_dir, project_dir, setup_gcode, part_gcode, final_output, wipe_location, retract_amount, tray_shift, model_shift, use_orca, file_prefix):
    snippet_dir = os.path.join(project_dir, "resources", "gcode_snippets")
    with GcodeWriter(final_output) as writer:
        if use_orca:
            writer.firmware = "klipper"
        if use_orca:
            with open(setup_gcode, "r", encoding="utf-8", errors="replace") as handle:
                lines = handle.readlines()
            end_idx = next((i for i, line in enumerate(lines) if line.strip() == "PRINT_END"), len(lines))
            for line in lines[:end_idx]:
                writer.write_line(line.rstrip())
        else:
            with open(os.path.join(snippet_dir, "{0}preamble.gcode".format(file_prefix)), "r") as handle:
                for line in handle:
                    writer.write_line(line.rstrip())
            with open(setup_gcode, "r", encoding="utf-8", errors="replace") as handle:
                lines = handle.readlines()
                start_idx = next((i for i, line in enumerate(lines) if ";LAYER_CHANGE" in line), 0)
                for line in lines[start_idx:]:
                    writer.write_line(line.rstrip())

        last_setup_z = writer.state.current_z
        writer.pause()
        post_pause_position = writer.state.position
        _wipe(writer, wipe_location, retract_amount)
        writer.move_to(
            x=post_pause_position.x,
            y=post_pause_position.y,
            z=post_pause_position.z,
            feedrate=24000,
        )
        writer.unretract(amount=retract_amount)

        writer.state.current_layer = 0
        z_has_been_adjusted = False
        part_start_prime_done = False
        completed = set()

        def place_group(group, label):
            if not group:
                return
            writer.comment("=== {0} ===".format(label))
            saved_position = writer.state.position
            saved_pa = writer.get_pressure_advance()
            writer.set_pressure_advance(extruder=saved_pa[0], value=0.0)
            for index, part in group:
                writer.comment("Placing {0} #{1}".format(part.kind.upper(), index + 1))
                _pick_and_place(writer, part, wipe_location, retract_amount, tray_shift, model_shift)
                completed.add(index)
            _wipe(writer, wipe_location, retract_amount)
            writer.move_to(x=saved_position.x, y=saved_position.y, z=saved_position.z + 10, feedrate=6000)
            writer.unretract(amount=retract_amount)
            writer.set_pressure_advance(extruder=saved_pa[0], value=saved_pa[1], time_range=saved_pa[2])

        with open(part_gcode, "r", encoding="utf-8", errors="replace") as handle:
            part_lines = handle.readlines()
        start_idx = next((i for i, line in enumerate(part_lines) if ";LAYER_CHANGE" in line), 0)
        end_section_idx = next(
            (i for i in range(start_idx, len(part_lines)) if part_lines[i].rstrip().startswith(";TYPE:Custom")),
            None,
        )
        max_layer = sum(1 for line in part_lines[start_idx:] if line.rstrip().startswith(";LAYER_CHANGE"))
        print("Detected {0} printable layers in part.gcode".format(max_layer))

        for line_idx in range(start_idx, len(part_lines)):
            clean_line = part_lines[line_idx].rstrip()
            if end_section_idx is not None and line_idx == end_section_idx:
                pending = [(i, part) for i, part in enumerate(parts) if i not in completed]
                if pending:
                    print("Inserting {0} late operation(s) after the last print layer.".format(len(pending)))
                    place_group(pending, "Late Placement After Last Print Move")
            if clean_line.startswith(";LAYER_CHANGE"):
                writer.write_line(clean_line)
                layer_parts = [
                    (i, part) for i, part in enumerate(parts)
                    if part.PauseLayer is not None
                    and writer.state.current_layer == part.PauseLayer
                    and i not in completed
                ]
                if layer_parts:
                    place_group(layer_parts, "Layer {0} Placement".format(writer.state.current_layer))
                continue
            if not z_has_been_adjusted and "G1" in clean_line and "Z" in clean_line:
                adjusted_z = last_setup_z + PART_START_Z_HOP
                clean_line = re.sub(r"Z[\d\.]+", "Z{0:.1f}".format(adjusted_z), clean_line)
                z_has_been_adjusted = True
            writer.write_line(clean_line)
            if (
                not part_start_prime_done
                and z_has_been_adjusted
                and re.match(r"^G1\s+E\.?8\b", clean_line)
            ):
                writer.comment("Part-start extra prime")
                writer.write_line("G1 E{0:.2f} F1500".format(PART_START_EXTRA_PRIME))
                part_start_prime_done = True

        pending = [(i, part) for i, part in enumerate(parts) if i not in completed]
        if pending:
            print("Appending {0} fallback late operation(s).".format(len(pending)))
            place_group(pending, "Fallback Late Placement")

        if not use_orca:
            with open(os.path.join(snippet_dir, "{0}end.gcode".format(file_prefix)), "r") as handle:
                for line in handle:
                    writer.write_line(line.rstrip())
    print("Wrote " + final_output)
