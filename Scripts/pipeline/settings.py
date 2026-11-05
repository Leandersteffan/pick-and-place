"""Temperatures, speeds, and wipe spots. This used to live inside the Grasshopper script."""

XL_WIPE_LOCATION = (225, -8, 3)
MINI_WIPE_LOCATION = (150, -3, 3)
U1_WIPE_LOCATION = (220, 15, 3)
PART_START_Z_HOP = 30.0
PART_START_EXTRA_PRIME = 0.25
PLACE_HOVER_DWELL_TIME_MS = 0

CONFIG = {
    "trace_braid": {
        "pick_z_offset": -0.06,
        "pick_pre_extrude_amount": 1.0,
        "pick_extrude_amount": 0.5,
        "pick_extrude_feedrate": 100,
        "pick_cool_temp": 160,
        "place_z_offset": -0.4,
        "place_heat_temp": 210,
        "place_preheat_height": 0,
        "place_dwell_time": 1000,
        "travel_feedrate": 6000,
        "z_lift_feedrate": 1000,
        "place_feedrate": 300,
    },
    "trace_cloth": {
        "pick_z_offset": -0.3,
        "pick_pre_extrude_amount": 1.0,
        "pick_extrude_amount": 0,
        "pick_extrude_feedrate": 100,
        "pick_cool_temp": 180,
        "place_z_offset": -0.3,
        "place_heat_temp": 210,
        "place_preheat_height": 0,
        "place_dwell_time": 1000,
        "travel_feedrate": 6000,
        "z_lift_feedrate": 1000,
        "place_feedrate": 300,
    },
    "plug": {
        "pick_z_offset": -0.65,
        "pick_extrude_amount": 1.8,
        "pick_extrude_feedrate": 100,
        "pick_cool_temp": 140,
        "place_z_offset": -1.4,
        "place_heat_temp": 210,
        "place_preheat_height": 0.25,
        "place_dwell_time": 1000,
        "travel_feedrate": 6000,
        "z_lift_feedrate": 1000,
        "place_feedrate": 100,
    },
    "pcb": {
        "pick_z_offset": -0.45,
        "pick_extrude_amount": 2.0,
        "pick_extrude_feedrate": 200,
        "pick_cool_temp": 100,
        "place_z_offset": -1.0,
        "place_heat_temp": 210,
        "place_preheat_height": 0.25,
        "place_dwell_time": 1000,
        "place_side_offset": 1.0,
        "prinjection": {
            "hover_z_offset": 5.0,
            "inject_z_offset": -1.4,
            "swipe_z_offset": -0.4,
            "extrude_amount": 0.5,
            "initial_extra_prime": 0.5,
            "extrude_feedrate": 300,
            "retract_amount": 3,
        },
        "travel_feedrate": 6000,
        "z_lift_feedrate": 1000,
        "place_feedrate": 100,
    },
    "print": {
        "pick_z_offset": -0.65,
        "pick_extrude_amount": 5.0,
        "pick_extrude_feedrate": 200,
        "pick_cool_temp": 50,
        "place_z_offset": -1.4,
        "place_heat_temp": 230,
        "wipe_temp": 210,
        "place_preheat_height": 0.25,
        "place_dwell_time": 1000,
        "place_side_offset": 3.0,
        "travel_feedrate": 6000,
        "z_lift_feedrate": 1000,
        "place_feedrate": 50,
        "post_place_lift_feedrate": 50,
    },
    "tamping": {
        0: {"depth_offset": 0.6, "feedrate": 300, "dwell_time": 250},
        1: {"depth_offset": 1.8, "feedrate": 200, "dwell_time": 500},
        2: {"depth_offset": 2.8, "feedrate": 200, "dwell_time": 500},
        3: {"depth_offset": 2.3, "feedrate": 200, "dwell_time": 500},
        "travel_feedrate": 3000,
        "lift_feedrate": 1000,
        "lift_height": 2.0,
    },
}

DEFAULT_SIZE = {
    "trace_braid": (14.0, 3.0, 0.6),
    "trace_cloth": (14.0, 3.0, 0.4),
    "plug": (8.0, 8.0, 3.0),
    "pcb": (7.0, 5.0, 2.0),
    "print": (10.0, 10.0, 2.0),
}
