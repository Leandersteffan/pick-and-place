"""
GcodeWriter - A class for writing and tracking G-code state during generation.

This module provides a GcodeWriter class that manages G-code output while
tracking machine state like position, speed, temperature, and other parameters.
"""

import re
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Tuple
from enum import Enum

# Snapmaker U1 refuses every filament move, including retracts, below this.
U1_MIN_EXTRUDE_TEMP = 170
# Klipper treats a heater as arrived within about 2 degrees of the target.
U1_TEMP_WINDOW = 2


class ExtrusionMode(Enum):
    """Extrusion coordinate mode."""
    ABSOLUTE = "M82"  # Absolute extrusion
    RELATIVE = "M83"  # Relative extrusion


class PrintType(Enum):
    """Type of print being performed."""
    PERIMETER = "Perimeter"
    EXTERNAL_PERIMETER = "External perimeter"
    INFILL = "Infill"
    INTERNAL_INFILL = "Internal infill"
    SOLID_INFILL = "Solid infill"
    BRIDGE_INFILL = "Bridge infill"
    OVERHANG_PERIMETER = "Overhang perimeter"
    CUSTOM = "Custom"
    UNKNOWN = "Unknown"


@dataclass
class Position:
    """Represents current XYZ position."""
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None

    def distance_to(self, other: 'Position') -> float:
        """Calculate 3D distance to another position."""
        if self.x is None or self.y is None or self.z is None:
            return 0.0
        if other.x is None or other.y is None or other.z is None:
            return 0.0
        dx = (other.x - self.x) ** 2
        dy = (other.y - self.y) ** 2
        dz = (other.z - self.z) ** 2
        return (dx + dy + dz) ** 0.5

    def __repr__(self):
        return f"Position(X={self.x}, Y={self.y}, Z={self.z})"


@dataclass
class MachineState:
    """Tracks complete machine state."""
    # Position
    position: Position = field(default_factory=Position)
    extruder_position: float = 0.0

    # Speed
    feedrate: float = 0.0  # F value in mm/min
    max_acceleration: Dict[str, float] = field(default_factory=dict)  # M201
    acceleration: Dict[str, float] = field(default_factory=dict)  # M204
    jerk: Dict[str, float] = field(default_factory=dict)  # M205

    # Extruder
    active_extruder: int = 0
    extrusion_mode: ExtrusionMode = ExtrusionMode.RELATIVE
    is_retracted: bool = False
    total_filament_extruded: float = 0.0

    # Temperature
    extruder_temps: Dict[int, float] = field(default_factory=dict)  # T0, T1, etc.
    bed_temp: float = 0.0
    chamber_temp: float = 0.0

    # Print state
    current_layer: int = 0
    current_z: float = 0.0
    layer_height: float = 0.2
    print_type: PrintType = PrintType.UNKNOWN
    layer_start_z: Optional[float] = None

    # Machine
    fan_speed: int = 0
    motors_enabled: bool = True
    coordinates_mode: str = "absolute"  # G90 or G91
    
    # Pressure Advance (M572)
    pressure_advance_extruder: int = 0  # D parameter
    pressure_advance_value: float = 0.0  # S parameter
    pressure_advance_time_range: float = 0.04  # W parameter


class GcodeWriter:
    """
    Manages G-code output with state tracking.

    Example:
        writer = GcodeWriter("output.gcode")
        writer.move_to(x=10, y=20, z=0.2, feedrate=1000)
        writer.extrude(e=0.5)
        writer.set_print_type(PrintType.PERIMETER)
        writer.write_line(";Custom comment")
        writer.close()
    """

    def __init__(self, filepath: str, auto_format: bool = True):
        """
        Initialize GcodeWriter.

        Args:
            filepath: Path to output G-code file
            auto_format: If True, automatically format floats to avoid floating-point artifacts
        """
        self.filepath = filepath
        self.file = open(filepath, 'w', encoding='utf-8', newline='\n')
        self.state = MachineState()
        self.auto_format = auto_format
        self.lines_written = 0
        self.comment_buffer = []
        self.firmware = "marlin"

    def _format_float(self, value: float, precision: int = 6) -> float:
        """Format float to avoid floating-point artifacts like 0.6000000000000001."""
        if self.auto_format:
            return round(value, precision)
        return value

    def write_line(self, line: str) -> None:
        """
        Write a raw line to the G-code file.

        Args:
            line: The G-code line to write
        """
        self.file.write(line + '\n')
        self.lines_written += 1
        self._parse_gcode_line(line)

    def _parse_gcode_line(self, line: str) -> None:
        """
        Parse a G-code line and update machine state.

        Args:
            line: The G-code line to parse
        """
        line = line.strip()
        if not line:
            return

        # Parse layer/print type comments BEFORE checking if it's a comment
        if ';LAYER_CHANGE' in line:
            self.state.current_layer += 1
            self.state.layer_start_z = self.state.current_z
        elif ';HEIGHT:' in line:
            match = re.search(r';HEIGHT:([\d.]+)', line)
            if match:
                self.state.layer_height = float(match.group(1))
        elif ';TYPE:' in line:
            self._parse_print_type(line)
        
        # Now skip if it's a pure comment line
        if line.startswith(';'):
            return

        # Parse position updates (G0, G1, G2, G3)
        if re.match(r'^G[0123]\b', line):
            self._parse_movement(line)

        # Parse feedrate
        if 'F' in line:
            match = re.search(r'F([\d.]+)', line)
            if match:
                self.state.feedrate = float(match.group(1))

        # Parse extrusion mode
        if line.startswith('M82'):
            self.state.extrusion_mode = ExtrusionMode.ABSOLUTE
        elif line.startswith('M83'):
            self.state.extrusion_mode = ExtrusionMode.RELATIVE

        # Parse temperature commands
        self._parse_temperatures(line)

        # Parse acceleration
        if line.startswith('M201'):
            self._parse_m201(line)
        elif line.startswith('M204'):
            self._parse_m204(line)
        elif line.startswith('M205'):
            self._parse_m205(line)
        
        # Parse pressure advance
        if line.startswith('M572'):
            self._parse_m572(line)
        elif line.startswith('SET_PRESSURE_ADVANCE'):
            advance = re.search(r'ADVANCE=([-\d.]+)', line)
            if advance:
                self.state.pressure_advance_value = float(advance.group(1))

        # Parse tool selection
        if re.match(r'^T\d', line):
            match = re.search(r'T(\d)', line)
            if match:
                self.state.active_extruder = int(match.group(1))

    def _parse_movement(self, line: str) -> None:
        """Parse G0/G1 movement commands."""
        # X position
        match = re.search(r'X([-\d.]+)', line)
        if match:
            self.state.position.x = self._format_float(float(match.group(1)))

        # Y position
        match = re.search(r'Y([-\d.]+)', line)
        if match:
            self.state.position.y = self._format_float(float(match.group(1)))

        # Z position
        match = re.search(r'Z([-\d.]+)', line)
        if match:
            z = self._format_float(float(match.group(1)))
            self.state.position.z = z
            self.state.current_z = z

        # E position
        match = re.search(r'E([-\d.]+)', line)
        if match:
            e_val = self._format_float(float(match.group(1)))
            if self.state.extrusion_mode == ExtrusionMode.ABSOLUTE:
                self.state.extruder_position = e_val
            else:
                self.state.extruder_position += e_val
                self.state.total_filament_extruded += e_val

    def _parse_temperatures(self, line: str) -> None:
        """Parse temperature commands (M104, M109, M140, M190)."""
        if line.startswith('M104') or line.startswith('M109'):
            # Support both S (set+wait) and R (wait only)
            s_match = re.search(r'S([\d.]+)', line)
            r_match = re.search(r'R([\d.]+)', line)
            temp = float(s_match.group(1)) if s_match else (float(r_match.group(1)) if r_match else None)
            if temp is not None:
                tool_match = re.search(r'T(\d)', line)
                tool = int(tool_match.group(1)) if tool_match else self.state.active_extruder
                self.state.extruder_temps[tool] = temp

        elif line.startswith('M140') or line.startswith('M190'):
            match = re.search(r'S([\d.]+)', line)
            if match:
                self.state.bed_temp = float(match.group(1))

    def _parse_m201(self, line: str) -> None:
        """Parse M201 max acceleration."""
        for axis in ['X', 'Y', 'Z', 'E']:
            match = re.search(f'{axis}([-\d.]+)', line)
            if match:
                self.state.max_acceleration[axis] = float(match.group(1))

    def _parse_m204(self, line: str) -> None:
        """Parse M204 acceleration."""
        for code in ['P', 'R', 'T']:
            match = re.search(f'{code}([-\d.]+)', line)
            if match:
                self.state.acceleration[code] = float(match.group(1))

    def _parse_m205(self, line: str) -> None:
        """Parse M205 jerk."""
        for axis in ['X', 'Y', 'Z', 'E', 'S', 'T']:
            match = re.search(f'{axis}([-\d.]+)', line)
            if match:
                self.state.jerk[axis] = float(match.group(1))

    def _parse_print_type(self, line: str) -> None:
        """Parse print type from comment."""
        for ptype in PrintType:
            if ptype.value in line:
                self.state.print_type = ptype
                return
    
    def _parse_m572(self, line: str) -> None:
        """Parse M572 pressure advance."""
        # D parameter - extruder number
        d_match = re.search(r'D(\d+)', line)
        if d_match:
            self.state.pressure_advance_extruder = int(d_match.group(1))
        
        # S parameter - pressure advance value
        s_match = re.search(r'S([\d.]+)', line)
        if s_match:
            self.state.pressure_advance_value = float(s_match.group(1))
        
        # W parameter - time range
        w_match = re.search(r'W([\d.]+)', line)
        if w_match:
            self.state.pressure_advance_time_range = float(w_match.group(1))

    def move_to(self, x: Optional[float] = None, y: Optional[float] = None,
                z: Optional[float] = None, e: Optional[float] = None,
                feedrate: Optional[float] = None, rapid: bool = False) -> None:
        """
        Move to a position.

        Args:
            x, y, z: Target coordinates
            e: Extrusion amount
            feedrate: Movement speed (mm/min)
            rapid: Use rapid movement (G0) if True, otherwise use G1
        """
        cmd = 'G0' if rapid else 'G1'
        parts = []

        if x is not None:
            x = self._format_float(x)
            parts.append(f'X{x}')
            self.state.position.x = x

        if y is not None:
            y = self._format_float(y)
            parts.append(f'Y{y}')
            self.state.position.y = y

        if z is not None:
            z = self._format_float(z)
            parts.append(f'Z{z}')
            self.state.position.z = z
            self.state.current_z = z

        if e is not None and self._extrusion_blocked(e):
            # The U1 aborts the print on any E move below min_extrude_temp.
            # A cold grab still travels and shears; the filament move has to wait.
            self.write_line(
                f"; skipped E{self._format_float(e)}, nozzle is below {U1_MIN_EXTRUDE_TEMP} C"
            )
            if x is None and y is None and z is None:
                return False
            e = None

        if e is not None:
            e = self._format_float(e)
            parts.append(f'E{e}')
            if self.state.extrusion_mode == ExtrusionMode.ABSOLUTE:
                self.state.extruder_position = e
            else:
                self.state.extruder_position += e
                self.state.total_filament_extruded += e

        if feedrate is not None:
            feedrate = self._format_float(feedrate)
            parts.append(f'F{feedrate}')
            self.state.feedrate = feedrate

        if parts:
            self.write_line(f'{cmd} {" ".join(parts)}')
        return True

    def extrude(self, amount: float, feedrate: Optional[float] = None) -> None:
        """
        Extrude filament without moving.

        Args:
            amount: Amount to extrude (mm)
            feedrate: Extrusion speed (mm/min)
        """
        self.move_to(e=amount, feedrate=feedrate)

    def retract(self, amount: float = 2.5, feedrate: float = 4200) -> None:
        """
        Retract filament.

        Args:
            amount: Retraction distance (mm)
            feedrate: Retraction speed (mm/min)
        """
        if not self.state.is_retracted:
            if self.move_to(e=-amount, feedrate=feedrate):
                self.state.is_retracted = True

    def unretract(self, amount: float = 2.5, feedrate: float = 2400) -> None:
        """
        Unretract filament.

        Args:
            amount: Unretraction distance (mm)
            feedrate: Unretraction speed (mm/min)
        """
        if self.state.is_retracted:
            if self.move_to(e=amount, feedrate=feedrate):
                self.state.is_retracted = False

    def set_feedrate(self, feedrate: float) -> None:
        """Set current feedrate."""
        self.state.feedrate = feedrate
        self.write_line(f'G1 F{self._format_float(feedrate)}')

    def set_acceleration(self, p: Optional[float] = None, r: Optional[float] = None,
                        t: Optional[float] = None) -> None:
        """
        Set acceleration (M204).

        Args:
            p: Print acceleration
            r: Retract acceleration
            t: Travel acceleration
        """
        parts = ['M204']
        if p is not None:
            parts.append(f'P{int(p)}')
            self.state.acceleration['P'] = p
        if r is not None:
            parts.append(f'R{int(r)}')
            self.state.acceleration['R'] = r
        if t is not None:
            parts.append(f'T{int(t)}')
            self.state.acceleration['T'] = t
        if len(parts) > 1:
            self.write_line(' '.join(parts))

    def set_extrusion_mode(self, absolute: bool) -> None:
        """
        Set extrusion mode.

        Args:
            absolute: If True, use M82 (absolute). If False, use M83 (relative)
        """
        if absolute:
            self.write_line('M82')
            self.state.extrusion_mode = ExtrusionMode.ABSOLUTE
        else:
            self.write_line('M83')
            self.state.extrusion_mode = ExtrusionMode.RELATIVE

    def set_extruder_temp(self, temp: float, tool: int = 0, wait: bool = False) -> None:
        """
        Set extruder temperature.

        Args:
            temp: Target temperature
            tool: Extruder index
            wait: If True, block until the nozzle is at that temperature.
                  Prusa honours M109 R while heating and cooling. The U1 ignores R,
                  and its M109 S returns immediately while cooling, so Klipper gets
                  M104 plus TEMPERATURE_WAIT.
        """
        target = int(temp)

        if wait and self.firmware == "klipper":
            current = self.state.extruder_temps.get(tool)
            heater = "extruder" if tool == 0 else f"extruder{tool}"
            self.write_line(f"; wait until nozzle is within 2 degrees of {target} C")
            self.write_line(f"M104 S{target} T{tool}")
            if current is None:
                low = max(0, target - U1_TEMP_WINDOW)
                high = target + U1_TEMP_WINDOW
                self.write_line(f"TEMPERATURE_WAIT SENSOR={heater} MINIMUM={low} MAXIMUM={high}")
            elif target < current:
                self.write_line(
                    f"TEMPERATURE_WAIT SENSOR={heater} MAXIMUM={target + U1_TEMP_WINDOW}"
                )
            else:
                self.write_line(
                    f"TEMPERATURE_WAIT SENSOR={heater} MINIMUM={max(0, target - U1_TEMP_WINDOW)}"
                )
        elif wait:
            self.write_line(f'M109 R{target}')
        else:
            self.write_line(f'M104 S{target}')

        # Track commanded target for this tool
        self.state.extruder_temps[tool] = temp

    def _extrusion_blocked(self, amount: float) -> bool:
        """True when this printer would abort a filament move at the current target."""
        if self.firmware != "klipper" or abs(amount) < 1e-9:
            return False
        temp = self.state.extruder_temps.get(self.state.active_extruder)
        return temp is not None and temp < U1_MIN_EXTRUDE_TEMP

    def set_bed_temp(self, temp: float, wait: bool = False) -> None:
        """
        Set bed temperature.

        Args:
            temp: Target temperature
            wait: If True, use M190 (wait). If False, use M140 (no wait)
        """
        cmd = 'M190' if wait else 'M140'
        self.write_line(f'{cmd} S{int(temp)}')
        self.state.bed_temp = temp

    def set_print_type(self, print_type: PrintType) -> None:
        """Set current print type and write comment."""
        self.state.print_type = print_type
        self.write_line(f';TYPE:{print_type.value}')

    def comment(self, text: str) -> None:
        """Write a comment line."""
        self.write_line(f';{text}')

    def layer_change(self, z: float, height: Optional[float] = None) -> None:
        """
        Mark a layer change.

        Args:
            z: New Z height
            height: Layer height (optional)
        """
        self.state.current_layer += 1
        self.state.current_z = z
        self.state.layer_start_z = z
        if height is not None:
            self.state.layer_height = height

        self.write_line(';LAYER_CHANGE')
        self.write_line(f';Z:{z}')
        if height is not None:
            self.write_line(f';HEIGHT:{height}')

    def pause(self) -> None:
        """Pause for pick-and-place. Prusa uses M601, the U1 uses Klipper PAUSE."""
        if self.firmware == "klipper":
            self.write_line('PAUSE')
        else:
            self.write_line('M601')

    def select_tool(self, tool: int) -> None:
        """Select active tool/extruder."""
        self.write_line(f'T{tool}')
        self.state.active_extruder = tool

    def home(self, axes: str = 'XYZ') -> None:
        """Home specified axes."""
        self.write_line(f'G28 {axes}')

    def reset_extrusion(self) -> None:
        """Reset extrusion position (G92 E0)."""
        self.write_line('G92 E0')
        self.state.extruder_position = 0.0
        self.state.total_filament_extruded = 0.0
    
    def set_pressure_advance(self, extruder: int = 0, value: float = 0.0, 
                           time_range: Optional[float] = None) -> None:
        """Set pressure advance (M572).
        
        Args:
            extruder: Extruder number (D parameter)
            value: Pressure advance value (S parameter). If zero, pressure advance is disabled
            time_range: Time range in seconds for calculating average velocity (W parameter)
        """
        if self.firmware == "klipper":
            self.write_line('SET_PRESSURE_ADVANCE ADVANCE=' + str(self._format_float(value, 5)))
        else:
            parts = ['M572']
            parts.append(f'D{extruder}')
            parts.append(f'S{self._format_float(value, 5)}')
            if time_range is not None:
                parts.append(f'W{self._format_float(time_range, 5)}')
            self.write_line(' '.join(parts))
        self.state.pressure_advance_extruder = extruder
        self.state.pressure_advance_value = value
        if time_range is not None:
            self.state.pressure_advance_time_range = time_range
    
    def get_pressure_advance(self) -> Tuple[int, float, float]:
        """Get current pressure advance configuration.
        
        Returns:
            Tuple of (extruder, value, time_range)
        """
        return (
            self.state.pressure_advance_extruder,
            self.state.pressure_advance_value,
            self.state.pressure_advance_time_range
        )

    def get_state_summary(self) -> Dict:
        """Get a summary of current machine state."""
        return {
            'position': self.state.position,
            'extruder_position': self.state.extruder_position,
            'feedrate': self.state.feedrate,
            'active_extruder': self.state.active_extruder,
            'extrusion_mode': self.state.extrusion_mode.name,
            'is_retracted': self.state.is_retracted,
            'total_filament_extruded': self.state.total_filament_extruded,
            'current_layer': self.state.current_layer,
            'current_z': self.state.current_z,
            'print_type': self.state.print_type.name,
            'extruder_temps': self.state.extruder_temps,
            'bed_temp': self.state.bed_temp,
            'pressure_advance_extruder': self.state.pressure_advance_extruder,
            'pressure_advance_value': self.state.pressure_advance_value,
            'pressure_advance_time_range': self.state.pressure_advance_time_range,
            'lines_written': self.lines_written,
        }

    def close(self) -> None:
        """Close the G-code file."""
        if self.file and not self.file.closed:
            self.file.close()

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()
