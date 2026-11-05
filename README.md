# Pick and place, v2

Print an object that is already put together. A trace, an LED, a small circuit: the printer picks the parts up and places them while it prints, so the thing that comes off the bed is assembled, not just a plastic shape.

[v1](https://github.com/Leandersteffan/pick-and-place) does that, and it works. The tray, the slicing, and the printer file are all built inside Grasshopper. This repository is the next version. Rhino still designs the part. The tray, the slicing, and the printer file are built by a normal Python program outside Grasshopper.

That is the point of v2. The part that used to be locked inside Grasshopper can be open source. It is also the first step toward running the whole tool from our own frontend later, instead of keeping it inside Rhino.

## Open it

Press Slice on the Grasshopper canvas for this project. Slice writes one file, `output/combined_output.gcode`. That is the file the printer runs.

`Designer.gh`, `Designer export life.gh`, and `Designer [Jan-28 '26, 2036].gh` are older saves. Leave them closed. Solving an old file writes its scripts back over `Scripts/`.

## What a slice does

1. Rhino holds the geometry. On Slice it exports the housing and a spec of every element: what it is, where it goes, a trace's length and direction, and the solid of a component such as the LED.
2. `Scripts/pipeline` reads that spec and builds the tray. A trace lies on the bed in a slot of its own size. A component is cut out of its pocket, so the supports follow the part. If the housing overlaps the tray, the housing is moved up until the gap is 10 mm. Picks stay on the tray. Places move with the housing.
3. OrcaSlicer slices the tray and the housing. The program puts them back on the bed and writes one file: the printer's own start, the tray, a pause, the housing, and the pick-and-place moves.
4. A trace and an LED are still two different moves. Temperatures and the moves live in `Scripts/pipeline`. On the U1, "wait for this temperature" is `M104` plus Klipper `TEMPERATURE_WAIT`. The pause is `PAUSE`.

## Layout

| Path | What it is |
| --- | --- |
| `Scripts/pipeline/` | Builds the tray, slices, and writes the printer file |
| `Scripts/Py3-*.py` | The Grasshopper side of Slice: export the spec, then start the pipeline. The newest date is the copy Grasshopper wrote last |
| `Scripts/C_-*.cs`, `Scripts/Grid-*.cs` | Trace geometry and the construction grid |
| `Scripts/gcode_writer.py` | Low-level gcode lines used while the file is assembled |
| `resources/u1/` | Process and filament profile for the Snapmaker U1 |
| `resources/Components/` | Components the canvas can place |
| `resources/gcode_snippets/` | Prusa start and end blocks, used when the selected printer is not the U1 |

Generated gcode, slicer leftovers, Python caches, and Rhino backup copies are not in the repository. Slice creates `output/` again.

## To run it

- Rhino with Grasshopper
- Python 3, with `manifold3d` (`py -3 -m pip install manifold3d`)
- [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer) for a Snapmaker U1 print. The program looks in `C:\Program Files\OrcaSlicer\`.
- A Snapmaker U1, printing with the first nozzle only

PrusaSlicer is still used if the selected printer is a Prusa.

## Credit

The designer is Oliver's. v1 is the Grasshopper tool that printed a part which lights. v2 is the same tool with the tray and the printer file moved out of Grasshopper, as part of the HCI seminar at HPI.
