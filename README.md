# Pick and place

Print an object that is already put together. A trace, an LED, a small circuit: the printer picks the parts up and places them while it prints, so the thing that comes off the bed is assembled, not just a plastic shape.

This repository is a Rhino and Grasshopper designer for that. You draw the housing and where the parts go. Slice writes one file. The printer builds a tray, pauses so the parts can be set in, then picks them up and prints them into the housing.

The designer was written for a Prusa. This copy runs it on a Snapmaker U1: one nozzle, OrcaSlicer, the tray and the housing kept where they were drawn, and a nozzle that waits until it has cooled before it picks anything up. The first part from this copy lights.

## Open it

Open `Designer export life.gh` in Rhino. Grasshopper comes with it. Place the housing on the Default layer, place the traces and the component, and press Slice.

Slice writes one file, `output/combined_output.gcode`. That is the file the printer runs.

`Designer.gh` and `Designer [Jan-28 '26, 2036].gh` are older saves of the same canvas. Leave them closed. Solving an old file writes its scripts back over `Scripts/`.

## What a slice does

1. Rhino holds the geometry. The housing is what gets printed. Traces and components are what the nozzle will pick up.
2. The Grasshopper Python component exports a tray and a housing, and OrcaSlicer slices each one.
3. Orca centers each model on its own. The script measures that shift and moves the print paths back to the Rhino positions, then nudges both onto the bed together. The pick points get the same nudge.
4. The script stitches one file: the printer's own start, the tray, a pause, the housing, and the pick-and-place moves.
5. Pick-and-place temperatures are written by `Scripts/gcode_writer.py`. Grasshopper reloads that file on every Slice. On a Prusa, "wait for this temperature" is `M109 R`. On the U1 it is `M104` plus Klipper `TEMPERATURE_WAIT`, because `M109 R` does not wait while this printer cools down.

The pause on the U1 is `PAUSE`. On a Prusa it is `M601`.

## Layout

| Path | What it is |
| --- | --- |
| `Designer export life.gh` | The canvas to open |
| `Scripts/gcode_writer.py` | Turns a pick-and-place step into gcode, including the U1 temperature wait |
| `Scripts/Py3-*.py` | Slice, shift, and assemble. The newest date is the copy Grasshopper wrote last |
| `Scripts/C_-*.cs`, `Scripts/Grid-*.cs` | Trace geometry and the construction grid |
| `resources/u1/` | Process and filament profile for the Snapmaker U1 |
| `resources/Components/` | Components the canvas can place |
| `resources/gcode_snippets/` | Prusa start and end blocks, used when the selected printer is not the U1 |
| `Leander21.10.26.3dm` | The Rhino model of the part that was printed and lit |

Generated gcode, slicer leftovers, Python caches, and Rhino backup copies are not in the repository. Slice creates `output/` again.

## To run it

- Rhino with Grasshopper
- Python 3 on `PATH` as `py -3`
- [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer) for a Snapmaker U1 print. The script looks in `C:\Program Files\OrcaSlicer\`.
- A Snapmaker U1, printing with the first nozzle only. The machine's own start still homes and checks the other heads. The file does not change tool.

PrusaSlicer is still used if the selected printer is a Prusa.

## Status

The U1 has printed a tray, paused, printed the housing, placed two traces and an LED, and produced a part that lights. A few behaviors that belong to the printer itself are still open. The designer is in active use.

## Credit

The designer is Oliver's. This copy is the one I am running on the Snapmaker U1, as part of the HCI seminar at HPI.
