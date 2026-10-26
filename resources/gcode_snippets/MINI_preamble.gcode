; Custom Preamble for Pick-Place Printegrate based of Prusa Slicer 2.8.1


M201 X4000 Y4000 Z400 E5000 ; sets maximum accelerations, mm/sec^2
M203 X400 Y400 Z12 E80 ; sets maximum feedrates, mm / sec
M204 P4000 R1250 T4000 ; sets acceleration (P, T) and retract acceleration (R), mm/sec^2
M205 X8.00 Y8.00 Z2.00 E10.00 ; sets the jerk limits, mm/sec
M205 S0 T0 ; sets the minimum extruding and travel feed rate, mm/sec

;TYPE:Custom

M862.3 P "MINI" ; printer model check
M862.1 P0.4 A0 F0 ; nozzle check
M862.5 P2 ; g-code level check
M862.6 P"Input shaper" ; FW feature check
M115 U6.2.2+8853
G90 ; use absolute coordinates
M83 ; extruder relative mode
M104 S170 ; set extruder temp for bed leveling
;M140 S60 ; set bed temp
M109 R170 ; wait for bed leveling temp
M190 S60 ; wait for bed temp
M569 S1 X Y ; set stealthchop for X Y
M204 T1250 ; set travel acceleration
G28 ; home all without mesh bed level
G29 ; mesh bed leveling 
M104 S230 ; set extruder temp
G92 E0 ; Sets extruder to 0

G1 X0 Y-2 Z3 F2400

M109 S230 ; wait for extruder temp

; intro line
G1 X10 Z0.2 F1000
G1 X70 E8 F900
G1 X140 E10 F700
G92 E0

G1 X10 Z20 F1000

M569 S0 X Y ; set spreadcycle for X Y
M204 T4000 ; restore travel acceleration
M572 W0.06 ; set smooth time
M221 S95 ; set flow
G21 ; set units to millimeters
G90 ; use absolute coordinates
M83 ; use relative distances for extrusion
M572 S0.27
M107
