"""
Configuration parameters for Pick-and-Place printing system.
"""

# Paths are resolved by the Grasshopper script from the file location.
# PrusaSlicer is searched in Program Files unless the PRUSASLICER panel is filled in.
SLICER_PATH = r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe"
MODULE_PATH = ""

# --- WIPE LOCATIONS (X, Y, Z) ---
XL_WIPE_LOCATION = (225, -8, 3)
MINI_WIPE_LOCATION = (150, -3, 3)

# --- PART START PARAMETERS ---
PART_START_Z_HOP = 30.0          # Z hop distance before starting part (mm)
PART_START_EXTRA_PRIME = 0.25    # Extra prime amount before starting part (mm)

# --- PLACEMENT PARAMETERS ---
PLACE_HOVER_DWELL_TIME_MS = 0   # Dwell time while hovering before placement (ms)

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
