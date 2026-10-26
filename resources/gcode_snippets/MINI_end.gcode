;TYPE:Custom
; Filament-specific end gcode
G91 ; Set relative positioning
G1 Z2 F720 ; Move print head up 2mm
G90 ; Set absolute positioning
G1 X170 Y170 F4200 ; park print head
G91 ; Set relative positioning
G1 Z50 F720 ; Move print head up 50mm more
G90 ; Set absolute positioning
G4 ; wait
M104 S0 ; turn off temperature
M140 S0 ; turn off heatbed
M107 ; turn off fan
M221 S100 ; reset flow
M572 S0 ; reset PA
M569 S1 X Y ; reset to stealthchop for X Y
M84 ; disable motors
; max_layer_z = 18
M73 P100 R0
M73 Q100 S0