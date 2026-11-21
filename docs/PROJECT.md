# Pick and place

This is the handbook for the project. Read it before changing code. The short page in the repository root is `README.md`. This file is the full picture.

The printer builds an object that is already assembled. It prints a housing, pauses, picks traces and components off a tray, and places them into the housing. A trace and an LED are different moves. A successful print that lights was made when the tray, the slicing, and the printer file all still lived inside Grasshopper. That state is tag `v1`.

Rhino still designs the part. The printed tray, the slicing, and the one printer file are built by `Scripts/pipeline`, a normal Python program. A page under `web/` loads a finished project, including `combined_output.gcode`, and shows the housing, the tray, and the toolpath. It does not replace Rhino, and it does not send a print. From `web/app`, run `npm install` and `npm run dev`, open http://127.0.0.1:5173, and press Load demo. Regenerating a slice from that page needs `py -3 -m uvicorn pnp_server.app:app --host 127.0.0.1 --port 8765` from `web/server`.

## Where the work is

The working tree is this folder:

`Getting logik out of Grasshoper\Designer\Designer`

Its remote is https://github.com/Leandersteffan/pick-and-place on branch `main`. Check with `git remote -v`.

| Name | What it is |
| --- | --- |
| Tag `v1`, commit `0d1d4bc` | The Grasshopper-only version that printed. Message: "Lead the README with pick-and-place." Do not move this tag. |
| Commit `f911fe9` | "Move the tray and the slicing out of Grasshopper." The outside pipeline, before the script cleanup. |
| Tag `v2`, commit `5d1acf5` | "Clean up old copies of the Grasshopper scripts." Do not move this tag. |
| Commit `32af4c1` | "Add a page that shows the combined gcode." The page, the schema, `output/`, and `report.py`. |
| Commit `7ed44d1` | "Read the program paths from machine.json. Tested and working on Windows." |
| Commit `bea8ea0` | "Safety backup before big changes." Current `main`. The cleanup after this commit is in the working tree and is not committed. |
| `First Task till week 2\Designer\Designer` | A folder that still holds the `v1` files. Leave it. Do not edit it and do not push from it. |

`pick-and-place-old` and `pick-and-place-v2` were deleted. Do not recreate them. Do not push anywhere except this repo.

`output/` is in the repository, including `combined_output.gcode` and `spec/spec.json`. Slice replaces that folder on the machine that runs it.

Only Leander Steffan `<lenniekeris@gmail.com>` may be the author and committer. Never add a `Co-authored-by` line for a tool or an agent. Make no commit unless asked.

## The one file to open in Rhino

Open `Designer export life.gh` in this folder. Press Slice. One press writes `output/combined_output.gcode`. There is no second program to run by hand.

`Designer export life.gh` is the Grasshopper file in this repo. On 18 Nov 2026 the ghx was saved over it, and Slice wrote a printer file. Solving an older save, including a file from `Backups/`, copies its scripts back over `Scripts/`.

ScriptParasite stores each Grasshopper script as `{NickName}-{yyMMdd}_{first 5 of the component guid}`. The newest date wins. A solve on 18 Nov 2026 wrote the `261118` names. They match the `261117` copies except for the date in the name. The live files are:

| File | Role |
| --- | --- |
| `Scripts/Py3-261118_1b2fe.py` | Slice button. Exports the housing and `spec.json`, then starts the pipeline. Component guid starts with `1b2fe464`. The same text is inside `Designer export life.gh` and the ghx. An empty printer name is written as `snapmaker u1`. |
| `Scripts/C_-261118_3a356.cs` | Traces, pause layers, pick points, and the tray preview in the Rhino view. |
| `Scripts/C_-261118_83c2c.cs` | Companion C# on the same canvas. |
| `Scripts/Grid-261118_6b5ad.cs` | Construction grid. |

The `261103` and `261114` copies were removed. The `261117` copies are still in `Scripts/` and match the `261118` files except for the date. A solve writes a new dated file, and the newest date is the one to keep.

The text copy is `Getting logik out of Grasshoper\Designer export ghx.ghx`, one level above this repo, out of git. Its embedded Slice script matches `Scripts/Py3-261118_1b2fe.py`, and so does `Designer export life.gh`. Slice inputs are `model`, `run`, `path`, `operations`, `printer`, and `braid`. `printer` has no wire. The tray pin and the slicer pin are gone. Paths has no inputs. It finds the Designer folder from the document and reads Orca from `machine.json`. A commit of `Scripts/` does not update the file Rhino opens. The housing has to be one closed solid on the layer `Default`.

The C# tray preview is not the tray that is printed. It still has to stay. Every solve builds the traces, the pause layers, and the pick points that Slice writes into the spec. The Python program builds a second tray, and that one is sliced.

## What a slice does

1. Grasshopper designs. The C# above runs as usual.
2. The newest `Py3-261118_1b2fe.py` finds the project root: the folder that contains both `Scripts` and `resources`. It must find that folder from the Grasshopper document. Do not hardcode `c:\A\HPI\...`.
3. It clears `output/` and writes:
   - `output/spec/housing.3mf` (this is what Orca slices)
   - `output/spec/housing.stl`
   - `output/spec/housing.step` (often a tiny empty file; STEP export skips meshes; the warning is harmless)
   - `output/spec/spec.json`
   - `output/spec/part-{index}.stl` for every `pcb` and `print`, with `"mesh"` set on that part
4. It starts the Python named in `machine.json`, not Rhino's Python. It removes `PYTHONHOME`, `PYTHONPATH`, `PYTHONNOUSERSITE`, `PYTHONSTARTUP`, and `PYTHONSAFEPATH` from the child. If Rhino's environment leaks in, the tray step dies and no combined file appears.
5. The command is `python.exe -m pipeline <spec folder> --project <designer folder>`, with cwd `Scripts`. Stdout and stderr go to `output/slice_log.txt`.
6. The pipeline builds `output/spec/tray.stl`, slices the tray and the housing with Orca, shifts the toolpaths back onto the bed when the printer name is a Snapmaker U1, and writes `output/combined_output.gcode`.
7. On success the button prints `Process Complete. Final G-Code saved in output folder.`

Run the same job from a terminal, from the `Scripts` folder:

```text
py -3 -m pipeline <path to output/spec> --project <path to this Designer folder>
```

The pipeline refuses a spec whose `version` is not `1`.

## Pipeline modules

| Module | Job |
| --- | --- |
| `Scripts/pipeline/run.py` | Load the spec, lay out the tray, slice, shift, assemble. |
| `Scripts/pipeline/traygen.py` | The printed tray, and the pick points written back onto the spec. |
| `Scripts/pipeline/slicer.py` | Orca only. The executable and the machine profile come from `machine.json`. |
| `Scripts/pipeline/geometry.py` | Mesh bounds, Orca's centering shift, the 10 mm housing gap. |
| `Scripts/pipeline/assemble.py` | Pause, cool, pick, place, tamp, prinjection. |
| `Scripts/pipeline/settings.py` | Temperatures, offsets, wipe spots. This is the live table. |
| `Scripts/gcode_writer.py` | Low-level gcode lines. The pipeline imports it. |

The U1 machine profile is the file named by `orca_machine` in `machine.json`. Process and filament files: `resources/u1/process.json` and `resources/u1/filament.json`. Orca's executable is the `orca` path in that same file. Bed limits used for the nudge are X 0.5–270.5 and Y 1.0–271. A Snapmaker U1 name sets the writer firmware to Klipper before the startup is copied. `manifold3d` must be installed for the Python named in `machine.json`.

`machine.json` is the only source for a program outside the Designer folder. Keys are `platform` (`windows` or `mac`), `python`, `orca`, and `orca_machine`. `platform` has to match this computer. There is no `prusa` key and no search of Program Files. `machine.json` is gitignored. `machine.example.json` is the template.

Slicing is that Orca call for every printer name. The name still chooses the wipe, the retract, and the bed correction. A Snapmaker U1 name runs the centering shift, the 10 mm housing gap, Klipper, and copies Orca's own start. Any other name, including `prusa xl` and `prusa mini`, skips that shift and wraps the Orca gcode with `resources/gcode_snippets/`. Those snippets are not a slicer. An empty printer name in the spec is written as `snapmaker u1`.

Dependencies to have on the machine:

- Rhino with Grasshopper
- Python 3 with `manifold3d`, the executable named by `python` in `machine.json`
- OrcaSlicer, the executable named by `orca` in `machine.json`, and the machine profile named by `orca_machine`

## The spec

`output/spec/spec.json` is the contract between the Grasshopper exporter and `Scripts/pipeline`. Version 1. The schema that describes that file as Slice writes it today is `web/schema/spec.v1.schema.json`. Do not rename or remove spec fields.

Rhino writes the top level: `version`, `printer`, `use_trace_braid`, `housing`, `tray` (the string `"generated"`), `tray_spacing`, `tray_origin`, and `parts`.

Every part has `type`, `place`, `pick`, and `pause_layer`. Types are `trace_braid`, `trace_cloth`, `plug`, `pcb`, and `print`.

A trace also has `length`, `width`, `height`, `horizontal`, `line_from`, `line_to`, and `tamps`. Each tamp has `x`, `y`, `z`, and `type` 0–3. A plug has `radius` and `height`. A pcb or print has `size`, `bbox_center`, `bbox_min`, `tray_offset`, `mesh`, and a pcb also has `prinjection` points.

Type detection in the exporter: a Grasshopper object whose type name is `print` and which has a radius is a plug; one with geometry is a pcb; otherwise it is `trace_braid` or `trace_cloth` according to the `braid` input. `use_trace_braid` defaults to true when that input is missing.

The pipeline writes back `slot` on laid-out parts, `pocket` and `pocket_depth` on pcb and print parts, and it replaces `pick` with the point that meets the opening it actually cut. A later reader of `spec.json` is looking at the file after that write-back.

`tray_spacing` is written as `3.0` to match the Grasshopper slider. The pipeline does not read the slider. Changing the slider desynchronizes the spec until the exporter is taught to read it. Trace `width` in the spec is the slider value 2.5 plus the C# side offset 0.15, so 2.8.

## How the printed tray is built

`traygen.py` follows the Grasshopper `Tray` class.

- The sheet under traces and plugs is 0.4 mm. Trace slots are through-holes. A horizontal trace uses length × width. A vertical trace uses width × length.
- Order: traces grouped by width and height, horizontal then vertical, then plugs, then PCBs and prints. Origin is `(0,0,0)`. Column height limit is 110 mm. Minimum pick-to-plug clearance is 15 mm.
- A plug opening in the C# is a circle. The Python tray cuts the bounding square. The current design has no plugs.
- A PCB or print slot is the part bounding box plus `tray_offset` on each side. The usual offset is 2.0 mm. Pick XY is the center of the un-offset slot. Pick Z is the part height plus 1.0 mm. The depth block is `size.z - 0.5`.
- The pocket is that block with the part's own mesh subtracted. The mesh is moved so its bounding-box bottom is on z=0 and its center sits on the slot center. An optional `tray_rotation` turns it about that center. Do not paste an old tray mesh and do not cut a plain rectangle. The component is not a printed solid. Grasshopper subtracted the brep anyway. The export often has small open edges. Those boundary loops are capped so `manifold3d` can subtract the same shape. Vertices are welded to 4 decimals. Arrays passed to `manifold3d` must be C-contiguous float32 vertices and uint32 faces. If the mesh is still not manifold after a cap and a winding flip, the slice fails out loud.

## Where parts land on the bed

Orca's `--slice 0` centers each mesh. After slicing, the shift is the extrusion center minus the mesh center. Only layer moves from the first `;LAYER_CHANGE` until the next `;TYPE:Custom` are shifted. The startup prime is not shifted. Arcs shift X and Y only, not I and J. A match for `G92` must not swallow a `G2`. One shared bed nudge is applied to both files, and the bed mesh line is rewritten from the housing bounds after that nudge.

Picks use only that shared nudge. Places, tamps, and prinjection use the nudge plus the housing move.

On a U1 slice, if the housing and the tray overlap in X and the housing's minimum Y is closer than the tray's maximum Y plus 10 mm, the housing gcode and the place moves shift in +Y until the gap is 10 mm. Picks stay on the tray. A printer name that is not a Snapmaker U1 skips this extra Y and also skips the centering shift. The current spec is a U1, so both run. A design can be drawn with the box on top of the tray in Rhino. The printed file still separates them.

## The printer file

Order: Orca's own start, through but not including `PRINT_END`, then the tray, one bare `PAUSE`, then the housing with pick-and-place inserted at each part's `pause_layer`. An empty pause layer means a late placement. The real U1 nozzle-clean macros stay in Orca's start, once, before the tray.

Klipper waits are `M104 S{temp} T{tool}` and then `TEMPERATURE_WAIT`. Cool uses `MAXIMUM=target+2`. Heat uses `MINIMUM=target-2`. `M104` comes before the wait. Filament moves are blocked when the firmware is Klipper, the tracked temperature is known, and it is below 170. Prusa and Marlin still use `M109 R`. Startup `M109` lines belong to Orca, not to the pick waits.

Live numbers are in `Scripts/pipeline/settings.py`:

| Kind | Cool | Heat | Notes |
| --- | --- | --- | --- |
| `trace_braid` | 160 | 210 | Pick Z offset -0.06, place Z offset -0.4 |
| `trace_cloth` | 180 | 210 | Pick and place Z offsets -0.3 |
| `plug` | 140 | 210 | |
| `pcb` | 100 | 210 | Place Z offset -1.0, step aside 1.0, then prinjection |
| `print` | 50 | 230 | Place side offset 3.0 |

Prinjection for a pcb: hover +5 mm, inject -1.4, swipe -0.4. Tamp depths: type 0 end 0.6, type 1 trace-trace 1.8, type 2 trace-plug 2.8, type 3 trace-pcb 2.3. The U1 wipe spot in our own code is `(220, 15, 3)`. Retract around that move is 0.8.

Do not "fix" a trace tamp that goes slightly below the bed. The printed part did the same kind of move. A far tamp can sit a few millimetres past the housing when the trace line is drawn longer than the box. That is the drawing.

## Other files, and what to leave alone

| Path | Keep it because |
| --- | --- |
| `Scripts/draw_trace.py` | A small Rhino command: draw a line on the Traces layer. |
| `Scripts/add_via.py` | A small Rhino command: place a point on the Traces layer. |
| `Scripts/proj.csproj` | The C# project file for the Grasshopper scripts. |
| `resources/Components/` | Parts the canvas can place. |
| `resources/gcode_snippets/` | Start and end blocks used when the printer name is not a Snapmaker U1. A U1 print copies Orca's own start instead. |
| `resources/u1/` | U1 process and filament. |

The exporter writes the spec and starts the pipeline. Temperatures live in `pipeline/settings.py`. An empty printer name becomes `snapmaker u1`.

Also leave alone:

- `First Task till week 2` and `Backups/`
- Moonraker, and sending a print. The glowing print already happened.
- The Rhino model. Do not rebuild it and do not auto-layout the canvas.
- A locked `combined_output.gcode` (open in Orca) can make Slice fail while it clears `output/`.

## The first plugin window

`plugin/print_in_place.py` is the Rhino window. It is a Rhino 8 script, not an installed plugin, and it does not use Human UI. In Rhino, run `ScriptEditor`, open that file, and press Run. Grasshopper stays closed. The window creates the layers and builds in the active document. Make housing adds a 20 by 12 by 3 mm box on `Default`. Draw housing uses Rhino's box command. Trace lines and vias go on `Traces`. Only point snap stays on. Grid snap, center, end, midpoint, near, knot, quadrant, and intersection stay off. Ortho is on only while a trace or a housing box is being clicked. Height mm places the grid dots. It does not move the drawing plane. The bottom of an imported part sits at Z=0, centered on the housing. Points on the component's Part layer are the contact points, drawn in red. Draw trace is the same as `Scripts/draw_trace.py`: it switches to the Traces layer, turns ortho on, and runs Rhino's line command. Show grid draws dots over the model at that height.

Slice in that window writes `output/spec/spec.json` and runs the same pipeline command as the Grasshopper button. The printer is `snapmaker u1`. Traces are `trace_cloth`. Trace width is 2.8 mm, trace height and layer height are 0.2 mm, and the pause layer is round(Z / 0.2) + 1. A trace end within 0.5 mm of a contact point is lifted so the trace top is one layer height above that contact. Before the housing is exported, Slice cuts the trace grooves and the closed solids on `Subtract` out of the housing. A trace groove is the extended trace line, extruded down by the trace height. Each cutter is scaled by 1.001 about its own bounding-box center. Slice stops if the housing volume does not drop. It does not send a print. This path is in good shape for a housing, cloth traces, and a part such as the sequin. The Grasshopper file still slices when it solves.

## What is not done

Oliver opened the project on a Mac on 17 Nov 2026 and the slice ran. He had not installed the Human UI build for Mac, so the movable window did not appear. In the ghx the printer pin is no longer fed by that window. An empty printer name becomes `snapmaker u1`. A `machine.json` whose `platform` is `mac` is rejected on this Windows machine, which is the check that exists here.

`Designer export life.gh` was saved from the ghx on 18 Nov 2026. Slice then wrote a printer file: two cloth traces, one pcb, housing moved 9.3 mm, bed nudge +0.5 and +1.0 mm. A later edit of the newest Py3 file still has to be saved into both Grasshopper files.

When Slice, the tray, the spec, the printer file, or the repositories change, update this file, `README.md`, and `AGENTS.md` in the same piece of work.
