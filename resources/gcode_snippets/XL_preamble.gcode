; Custom Preamble for Pick-Place Printegrate based of Prusa Slicer 2.8.1


M201 X7000 Y7000 Z200 E2500 ; sets maximum accelerations, mm/sec^2
M203 X400 Y400 Z12 E100 ; sets maximum feedrates, mm / sec
M204 P4000 R1200 T5000 ; sets acceleration (P, T) and retract acceleration (R), mm/sec^2
M205 X8.00 Y8.00 Z2.00 E10.00 ; sets the jerk limits, mm/sec
M205 S0 T0 ; sets the minimum extruding and travel feed rate, mm/sec

;TYPE:Custom
M17 ; enable steppers
M862.3 P "XL" ; printer model check
M862.5 P2 ; g-code level check
M862.6 P"Input shaper" ; FW feature check
M115 U6.2.5+8912
G90 ; use absolute coordinates
M83 ; extruder relative mode
; set print area
M555 X0 Y0 W270 H180
; inform about nozzle diameter
M862.1 T1 P0.4 A0 F0





; turn off unused heaters

M104 T0 S0
M104 T2 S0
M104 T3 S0
M104 T4 S0

M217 Z2 ; set toolchange z hop to 2mm, or zhop variable from slicer if higher
; set bed and extruder temp for MBL
M140 S60 ; set bed temp
G0 Z5 ; add Z clearance
M109 T1 S170 ; wait for temp

; Home XY
G28 XY
; try picking tools used in print
G1 F24000





; select tool that will be used to home & MBL
T1 S1 L0 D0
; home Z with MBL tool
M84 E ; turn off E motor
G28 Z
G0 Z5 ; add Z clearance

M190 S60 ; wait for bed temp

G29 G ; absorb heat

M109 T1 S170 ; wait for temp

; move to the nozzle cleanup area
G1 X197 Y168 Z5 F24000
M302 S160 ; lower cold extrusion limit to 160C
G1 E-2 F2400 ; retraction for nozzle cleanup
M73 Q1 S3
; nozzle cleanup
M84 E ; turn off E motor
G29 P9 X165 Y168 W32 H7
G0 Z5 F480 ; move away in Z
M107 ; turn off the fan
; MBL
M84 E ; turn off E motor
G29 P1 ; invalidate mbl & probe print area
G29 P1 X30 Y0 W50 H20 C ; probe near purge place
G29 P3.2 ; interpolate mbl probes
G29 P3.13 ; extrapolate mbl outside probe area
G29 A ; activate mbl
G1 Z10 F720 ; move away in Z
G1 F24000
;M73 P1 R3
; set extruder temp
M104 T1 S230


M190 S60 ; set bed temperature and wait for it to be reached
M104 S230 ; set temperature
;TYPE:Custom
M109 S230 ; set temperature and wait for it to be reached
G21 ; set units to millimeters
G90 ; use absolute coordinates
M83 ; use relative distances for extrusion
M107


;
; purge initial tool
;

G92 E0 ; reset extruder position

G0 X30 Y-7 Z10 F24000 ; move close to the sheet's edge
G0 E30 X40 Z0.2 F170 ; purge while moving towards the sheet
G0 X70 E9 F800 ; continue purging and wipe the nozzle
G0 X73 Z0.05 F8000 ; wipe, move close to the bed
G0 X76 Z0.2 F8000 ; wipe, move quickly away from the bed
G1 E-0.8 F2400 ; retract

G92 E0 ; reset extruder position
G21 ; set units to millimeters
G90 ; use absolute coordinates
M83 ; use relative distances for extrusion
M900 K0.05 ; Filament gcode

