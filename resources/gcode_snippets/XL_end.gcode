M107
;TYPE:Custom
; Filament-specific end gcode
; Filament-specific end gcode
; Filament-specific end gcode
; Filament-specific end gcode
; Filament-specific end gcode
G4 ; wait

G91 ; Set relative positioning
G1 Z2 F300 ; Move bed down 2mm
G90 ; Set absolute positioning

P0 S1 ; park tool

G91 ; Set relative positioning
G1 Z50 F300 ; Move bed down 50mm more
G90 ; Set absolute positioning
M73 P90 R0

; turn off extruder heaters
M104 T1 S0





M140 S0 ; turn off heatbed
M107 ; turn off fan
M221 S100 ; reset flow percentage
M84 ; disable motors
M77 ; stop print timer
M73 P100 R0
M73 Q100 S0