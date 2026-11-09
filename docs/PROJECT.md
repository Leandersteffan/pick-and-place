# Pick and place

This is the handbook for the project. Read it before changing code. The short page in the repository root is `README.md`. This file is the full picture.

The printer builds an object that is already assembled. It prints a housing, pauses, picks traces and components off a tray, and places them into the housing. A trace and an LED are different moves. A successful print that lights was made when the tray, the slicing, and the printer file all still lived inside Grasshopper. That state is tag `v1`.

Rhino still designs the part. The printed tray, the slicing, and the one printer file are built by `Scripts/pipeline`, a normal Python program. That split is so the part that used to be locked inside Grasshopper can be open source, and so the tool can later run from our own frontend. The frontend is not built. Do not start one until the spec below has been discussed with Oliver.

## Where the work is

The working tree is this folder:

`Getting logik out of Grasshoper\Designer\Designer`

Its remote is https://github.com/Leandersteffan/pick-and-place on branch `main`. Check with `git remote -v`.

| Name | What it is |
| --- | --- |
| Tag `v1`, commit `0d1d4bc` | The Grasshopper-only version that printed. Message: "Lead the README with pick-and-place." Do not move this tag. |
| Commit `f911fe9` | "Move the tray and the slicing out of Grasshopper." The outside pipeline, before the script cleanup. |
| Tag `v2`, commit `5d1acf5` | "Clean up old copies of the Grasshopper scripts." Current `main`. |
| `First Task till week 2\Designer\Designer` | A folder that still holds the `v1` files. Leave it. Do not edit it and do not push from it. |
| `pick-and-place-old` | The renamed first GitHub repo. Do not push there. |
| `pick-and-place-v2` | A spare public copy from before this repo held both tags. This folder does not track it. |

`output/` is in the repository, including `combined_output.gcode` and `spec/spec.json`. Slice replaces that folder on the machine that runs it.

Only Leander Steffan `<lenniekeris@gmail.com>` may be the author and committer. Never add a `Co-authored-by` line for a tool or an agent. Make no commit unless asked.

## The one file to open in Rhino

Open `Designer export life.gh` in this folder. Press Slice. One press writes `output/combined_output.gcode`. There is no second program to run by hand.

`Designer export life.gh` is the Grasshopper file in this repo. Solving an older save copies its scripts back over `Scripts/`.

ScriptParasite stores each Grasshopper script as `{NickName}-{yyMMdd}_{first 5 of the component guid}`. The newest date wins. The live files are:

| File | Role |
| --- | --- |
| `Scripts/Py3-261103_1b2fe.py` | Slice button. Exports the housing and `spec.json`, then starts the pipeline. Component guid starts with `1b2fe464`. |
| `Scripts/C_-261103_3a356.cs` | Traces, pause layers, pick points, and the tray preview in the Rhino view. |
| `Scripts/C_-261103_83c2c.cs` | Companion C# on the same canvas. |
| `Scripts/Grid-261103_6b5ad.cs` | Construction grid. |

The ghx embed is what a cold open loads. After changing `Py3-261103_1b2fe.py`, the ghx has to carry the same script, or the next cold open restores the old button. A commit of `Scripts/` does not update the file Rhino opens.

The C# tray preview is not the tray that is printed. It still has to stay. Every solve builds the traces, the pause layers, and the pick points that Slice writes into the spec. The Python program builds a second tray, and that one is sliced.

## What a slice does

1. Grasshopper designs. The C# above runs as usual.
2. `Py3-261103_1b2fe.py` finds the project root: the folder that contains both `Scripts` and `resources`. It must find that folder from the Grasshopper document. Do not hardcode `c:\A\HPI\...`.
3. It clears `output/` and writes:
   - `output/spec/housing.3mf` (this is what Orca slices)
   - `output/spec/housing.stl`
   - `output/spec/housing.step` (often a tiny empty file; STEP export skips meshes; the warning is harmless)
   - `output/spec/spec.json`
   - `output/spec/part-{index}.stl` for every `pcb` and `print`, with `"mesh"` set on that part
4. It starts system Python, not Rhino's Python. It looks for `%LOCALAPPDATA%\Programs\Python\Python310\python.exe`, then 311, 312, 313, then `py -3`. It removes `PYTHONHOME`, `PYTHONPATH`, `PYTHONNOUSERSITE`, `PYTHONSTARTUP`, and `PYTHONSAFEPATH` from the child. If Rhino's environment leaks in, the tray step dies and no combined file appears.
5. The command is `python.exe -m pipeline <spec folder> --project <designer folder>`, with cwd `Scripts`. Stdout and stderr go to `output/slice_log.txt`.
6. The pipeline builds `output/spec/tray.stl`, slices the tray and the housing, shifts the toolpaths back onto the bed, and writes `output/combined_output.gcode`.
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
| `Scripts/pipeline/slicer.py` | Orca for a Snapmaker U1, Prusa otherwise. |
| `Scripts/pipeline/geometry.py` | Mesh bounds, Orca's centering shift, the 10 mm housing gap. |
| `Scripts/pipeline/assemble.py` | Pause, cool, pick, place, tamp, prinjection. |
| `Scripts/pipeline/settings.py` | Temperatures, offsets, wipe spots. This is the live table. |
| `Scripts/gcode_writer.py` | Low-level gcode lines. The pipeline imports it. |

U1 profile inside Orca: `Snapmaker U1 (0.4 nozzle)`. Process and filament files: `resources/u1/process.json` and `resources/u1/filament.json`. Orca is expected at `C:\Program Files\OrcaSlicer\orca-slicer.exe`. Bed limits used for the nudge are X 0.5–270.5 and Y 1.0–271. The U1 path sets the writer firmware to Klipper before the startup is copied. `manifold3d` must be installed for that same system Python: `py -3 -m pip install manifold3d`.

Dependencies to have on the machine:

- Rhino with Grasshopper
- Python 3 with `manifold3d`
- OrcaSlicer for a Snapmaker U1 print, first nozzle only
- PrusaSlicer if the selected printer is a Prusa

## The spec

`output/spec/spec.json` is the contract between the Grasshopper exporter and `Scripts/pipeline`. Version 1. There is no JSON Schema file yet. Oliver asked for one so design decisions can be discussed. Do not invent that schema, and do not change the fields Slice writes, until that conversation happens. Documenting the fields here is not a change to the file.

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

On a U1 slice, if the housing and the tray overlap in X and the housing's minimum Y is closer than the tray's maximum Y plus 10 mm, the housing gcode and the place moves shift in +Y until the gap is 10 mm. Picks stay on the tray. The Prusa path does not apply this extra Y. A design can be drawn with the box on top of the tray in Rhino. The printed file still separates them.

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
| `Scripts/config.py` | An older settings module. Nothing in the live Slice path imports it. The live table is `pipeline/settings.py`. |
| `Scripts/draw_trace.py` | A small Rhino command: draw a line on the Traces layer. |
| `Scripts/add_via.py` | A small Rhino command: place a point on the Traces layer. |
| `Scripts/proj.csproj` | The C# project file for the Grasshopper scripts. |
| `resources/Components/` | Parts the canvas can place. |
| `resources/gcode_snippets/` | Prusa start and end blocks. |
| `resources/u1/` | U1 process and filament. |

Inside `Py3-261103_1b2fe.py`, the old temperature table, the old bed-shift functions, and the `gcode_writer` import are leftovers. After the script writes the spec and starts the pipeline, it returns. Those leftovers do not run. Cutting them means editing the Grasshopper script and the ghx together. Do not do that as a drive-by cleanup.

Also leave alone:

- `First Task till week 2` and `Backups/`
- Moonraker, and sending a print. The glowing print already happened.
- The Rhino model. Do not rebuild it and do not auto-layout the canvas.
- A locked `combined_output.gcode` (open in Orca) can make Slice fail while it clears `output/`.

## What is not done

Oliver asked for a schema of the spec between a front end and the backend, so later design talks have a fixed object. That schema has not been written, on purpose, until he says whether he means this `spec.json` or a new format. The frontend he was asked about waits on that answer.

When Slice, the tray, the spec, the printer file, or the repositories change, update this file, `README.md`, and `AGENTS.md` in the same piece of work.
