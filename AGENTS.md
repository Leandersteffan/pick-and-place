# Pick and place, as of 18 Nov 2026

The full handbook is `docs/PROJECT.md`. Read it before changing code. This file is the short list of rules, and the same text is the always-on Cursor rule `HCI 26 27\.cursor\rules\pick-and-place.mdc`, next to this workspace, outside the git repo. When Slice, the tray, the spec, the printer file, or the repositories change, update `docs/PROJECT.md`, `README.md`, and this file in the same piece of work.

Editing this file does not put anyone on GitHub. A contributor appears only when a commit records them as author, committer, or `Co-authored-by`. The author and committer of every commit are Leander Steffan `<lenniekeris@gmail.com>`. Never add `Co-authored-by: Cursor`, `cursoragent`, or `cursoragent@cursor.com`. A shell command whose text contains `git commit` can have that line appended before git runs. Create a commit with `git commit-tree` through Python, the message on stdin, and those author and committer variables set in the process. Read the new commit object before pushing. Make no commit unless asked.

## What this is

The printer builds an object that is already assembled. It prints a housing, pauses, picks traces and components off a tray, and places them into the housing. A trace and an LED are different moves. The successful glowing print was made when tray, slicing, and the printer file all still lived inside Grasshopper. That state is tag `v1`.

Rhino still designs the part. The tray, the slicing, and the one printer file are built by `Scripts/pipeline`. A local page under `web/` loads a finished project, including `combined_output.gcode`, and shows the housing, the tray, and the toolpath. The page was added in `32af4c1`. Current `main` is `bea8ea0`. It does not replace Rhino, and it does not send a print. From `web/app`, run `npm install` and `npm run dev`, open http://127.0.0.1:5173, and press Load demo. The demo is `web/fixtures/demo-v1/`. Regenerating a slice from that page needs a second process, from `web/server`: `py -3 -m uvicorn pnp_server.app:app --host 127.0.0.1 --port 8765`. The page still shows the print when that server is down. The spec contract is still `spec.json`. The schema that describes that file as Slice writes it today is `web/schema/spec.v1.schema.json`. Do not rename or remove spec fields.

## Folders and repositories

| Place | What it is |
| --- | --- |
| `Getting logik out of Grasshoper\Designer\Designer` | The working tree. `origin` is https://github.com/Leandersteffan/pick-and-place branch `main`. |
| `Designer export life.gh` | The Grasshopper file in the repo. On 18 Nov 2026 the ghx was saved over it. It contains the cleaned Slice script. An older copy from `Backups/` can still put an old script back. |
| `Getting logik out of Grasshoper\Designer export ghx.ghx` | The Grasshopper file kept as text, one level above the git repo. Leave it out of git. Its embedded Slice script is the same text as `Scripts/Py3-261118_1b2fe.py`. |
| `First Task till week 2\Designer\Designer` | The `v1` snapshot, the version that printed. Leave it. |
| https://github.com/Leandersteffan/pick-and-place | The one repo. History is the three `v1` commits, the outside-pipeline save, the cleanup tagged `v2`, then the viewer. |
| Tag `v1` | Commit `0d1d4bc`, message "Lead the README with pick-and-place." Do not move this tag. |
| The commit after `v1` | `f911fe9`, "Move the tray and the slicing out of Grasshopper." |
| Tag `v2` | Commit `5d1acf5`. Older dated Grasshopper script copies are gone. The newest file of each component, the Rhino tray preview, and `Scripts/pipeline` stay. Do not move this tag. |
| The commit after `v2` | `32af4c1`, "Add a page that shows the combined gcode." The page, the schema, `output/`, and `report.py`. |
| The machine.json commit | `7ed44d1`, "Read the program paths from machine.json. Tested and working on Windows." |
| Current `main` | `bea8ea0`, "Safety backup before big changes." The cleanup after that backup is in the working tree and is not committed. |
| `web/` | The page and the FastAPI service, on GitHub. `web/fixtures/demo-v1/` is a copy of one Slice. `node_modules`, `dist`, and `web/server/.tmp/` are gitignored. |

`pick-and-place-old` and `pick-and-place-v2` were deleted. Do not recreate them. Do not push anywhere except https://github.com/Leandersteffan/pick-and-place.git.

`output/` is in the repository, including `combined_output.gcode` and `spec/spec.json`. Slice replaces that folder on the machine that runs it. Python caches, Rhino backup copies, `node_modules`, `dist`, `web/server/.tmp/`, and `machine.json` stay out of git. The template `machine.example.json` is the file that can be committed.

Check the active remote with `git remote -v` inside the working tree. It must be `https://github.com/Leandersteffan/pick-and-place.git`.

## How a slice works

Press Slice on `Designer export life.gh`. One press writes `output/combined_output.gcode`. There is no second program to run by hand. The housing has to be one closed solid on the layer `Default`. A box left on `Traces` makes Slice clear `output/` and stop before it writes the spec.

1. Grasshopper still designs. The newest C# builds trace geometry, pause layers, pick locations, and a tray preview in the Rhino view. That preview is not the tray that is printed. Leave the preview.
2. The newest `Scripts/Py3-*_1b2fe.py` exports the housing and the spec, then starts the pipeline. It no longer contains the old shift helpers, the old temperature table, or a Prusa config path. ScriptParasite names files `{NickName}-{yyMMdd}_{first5 of the component guid}`. The newest date wins. A solve on 18 Nov 2026 wrote `Scripts/Py3-261118_1b2fe.py` (component `1b2fe464`), `C_-261118_3a356.cs`, `C_-261118_83c2c.cs`, and `Grid-261118_6b5ad.cs`. Those match the `261117` copies except for the date in the name. The `261117` copies are still in `Scripts/`. The same Py3 text is inside `Designer export life.gh` and the ghx. Slice inputs are `model`, `run`, `path`, `operations`, `printer`, and `braid`. `printer` has no wire. An empty printer name is written as `snapmaker u1`. The tray pin and the slicer pin are gone. Do not delete the newest file.
3. The export writes `output/spec/housing.3mf`, `housing.stl`, and `housing.step`, plus `spec.json`. For every `pcb` and `print` it also writes `part-{index}.stl` and sets `"mesh"` on that part. The project root is the folder that contains `Scripts` and `resources`. Find it from the Grasshopper document. Do not hardcode `c:\A\HPI\...`.
4. The button starts the Python named in `machine.json`, not Rhino's Python. It removes `PYTHONHOME`, `PYTHONPATH`, `PYTHONNOUSERSITE`, `PYTHONSTARTUP`, and `PYTHONSAFEPATH` from the child. The command is `python.exe -m pipeline <spec folder> --project <designer folder>`, cwd `Scripts`. Stdout and stderr go to `output/slice_log.txt`. If Rhino's environment leaks in, the tray step dies and no combined file appears.
5. `Scripts/pipeline` reads the spec, builds `output/spec/tray.stl`, slices the tray and the housing with Orca, shifts the toolpaths back onto the bed when the printer name is a Snapmaker U1, and writes one gcode file.

`machine.json` sits in the Designer folder, next to `Scripts` and `resources`. It is the only source for a program that lives outside that folder. Keys are `platform` (`windows` or `mac`), `python`, `orca`, and `orca_machine`. `platform` has to match this computer (`win32` is `windows`, `darwin` is `mac`). Each of those three paths has to be a file that exists. A missing file, an empty path, or the wrong platform stops the slice. Nothing searches Program Files, `LOCALAPPDATA`, or `py -3`. There is no `prusa` key. Paths inside the Designer folder stay relative to the project root.

`Designer.gh` and `Designer [Jan-28 '26, 2036].gh` were removed in `32af4c1`. Solving an older save copies its scripts back over `Scripts/`. After changing the newest Py3 file, save that same script into the ghx and over `Designer export life.gh`, or the next open restores the old button. A commit of `Scripts/` does not update the file Rhino opens.

Orca slices the 3MF. That is the only slicer. `housing.step` can be a few kilobytes and empty, because STEP export skips meshes. The warning is harmless.

## The pipeline

`py -3 -m pipeline <spec folder> --project <designer folder>`. Modules:

| Module | Job |
| --- | --- |
| `run.py` | Load the spec, lay out the tray, slice, shift, assemble. |
| `traygen.py` | The tray solid and the pick points written back onto the spec. |
| `slicer.py` | Orca only. The executable and the machine profile come from `machine.json`. |
| `geometry.py` | Mesh bounds, the slicer's centering shift, the 10 mm housing gap. |
| `assemble.py` | Pause, cool, pick, place, tamp, prinjection. |
| `settings.py` | Temperatures, offsets, wipe spots. |
| `report.py` | Recomputes the bed offsets after a slice. `run()` does not call it. The web service may. Do not change the other pipeline modules to serve the web app. |
| `gcode_writer.py` | Low-level gcode lines, one folder above the package. |

U1 machine profile is the file named by `orca_machine` in `machine.json`. Process and filament are `resources/u1/process.json` and `filament.json`. Bed limits used for the nudge are X 0.5–270.5 and Y 1.0–271. Firmware for the U1 path is Klipper. Orca's executable is the `orca` path in that same file. `manifold3d` must be installed for the Python named there. The web service reads the same `orca` path when it slices.

Slicing is that Orca call for every printer name. The name still chooses the wipe, the retract, and the bed correction. A Snapmaker U1 name runs the centering shift, the 10 mm housing gap, Klipper, and copies Orca's own start. Any other name, including `prusa xl` and `prusa mini`, skips that shift and wraps the Orca gcode with `resources/gcode_snippets/` (`XL_` or `MINI_` preamble and end). Those snippets are not a slicer.

Orca's `--slice 0` centers each mesh on the bed. After slicing, the shift is the extrusion center minus the mesh center. Only layer moves from the first `;LAYER_CHANGE` until the next `;TYPE:Custom` are shifted. Startup prime is not shifted. Arcs shift X and Y only, not I and J. A `G92` match must not swallow a `G2`. One shared bed nudge is applied to both files. The bed mesh line is rewritten from the housing bounds after that nudge.

## Tray

`traygen.py` follows the Grasshopper `Tray` class.

- The sheet under traces and plugs is 0.4 mm (`tracePlugDepth`). Trace slots are through-holes. A horizontal trace uses length × width. A vertical trace uses width × length. Width in the spec is the trace-width slider 2.5 plus the C# side offset 0.15, so 2.8.
- Layout order: traces grouped by width and height, horizontal then vertical, then plugs, then PCBs and prints. Origin is `(0,0,0)`. Column height limit is 110 mm. Minimum pick-to-plug clearance is 15 mm.
- `tray_spacing` is written as 3.0 to match the Grasshopper slider. The pipeline does not read that slider back. Changing the slider desynchronizes the spec until the exporter is taught to read it.
- A plug opening in the C# is a circle. The Python tray currently cuts the bounding square. There are no plugs in the current design.
- A PCB or print slot is the part bounding box plus `tray_offset` on each side. The usual offset is 2.0 mm. Pick XY is the center of the slot before that offset is applied to the cut. Pick Z is the part height plus 1.0 mm. The depth block is `size.z - 0.5`.
- The pocket is that block with the part's own mesh subtracted. The mesh is moved so its bounding-box bottom is on z=0 and its bounding-box center sits on the slot center. An optional `tray_rotation` turns it about that center. Do not paste an old tray mesh, and do not cut a silent rectangle. The component is not supposed to be a printed solid. Grasshopper subtracted the brep anyway. Closing small gaps in the exported STL is how the same subtraction runs outside.
- STL vertices are welded to 4 decimals. Open boundary loops are capped with a reversed triangle fan. The mesh has to be C-contiguous float32 vertices and uint32 faces for `manifold3d`. If it is still not manifold after a cap and a winding flip, the slice fails out loud.
- The pipeline writes `slot`, `pocket`, `pocket_depth`, and the final `pick` back onto the spec. A plug also gets `slot_shape` (`"circle"`). The Python tray still cuts the bounding square.

## Where parts land on the bed

Picks use only the shared bed nudge. Places, tamps, and prinjection use the bed nudge plus the housing move.

On a U1 slice, `housing_clearance` in `geometry.py` looks at footprints. If they overlap in X and the housing's minimum Y is closer than the tray's maximum Y plus 10 mm, the housing gcode, the places, the tamps, and the prinjection move in +Y until the gap is 10 mm. Picks stay on the tray. A printer name that is not a Snapmaker U1 skips this extra Y and also skips the centering shift. The current spec is a U1, so both run. `report.py` returns zero offsets for a non-U1 name.

The slice checked on 18 Nov 2026, after the cleanup, had two `trace_cloth` parts, height 0.2, pause layer 12, and one pcb on pause layer 11. The housing moved 9.3 mm so the gap was 10 mm. The bed nudge was +0.5, +1.0 mm. The housing had 25 layers. The places landed on the housing. The 14 Nov slice had moved the housing 8.6 mm on a 16-layer file. The 3 Nov slice is kept outside the repo at `Getting logik out of Grasshoper\output-backup-2026-11-14`.

## The printer file

Order: Orca's own start (through, but not including, `PRINT_END`), the tray, one bare `PAUSE`, then the housing with pick-and-place inserted at each part's pause layer. `PauseLayer` empty means a late placement. The real U1 nozzle-clean macros stay in Orca's start, once, before the tray. The later "Nozzle Wipe Sequence" in our own code is `G1 X220 Y15 Z3` and was left as it was.

Klipper waits are `M104 S{temp} T{tool}` and then `TEMPERATURE_WAIT`. Cool uses `MAXIMUM=target+2`. Heat uses `MINIMUM=target-2`. The `M104` comes before the wait. Filament moves are blocked when the firmware is Klipper, the tracked temperature is known, and it is below 170. Prusa and Marlin still use `M109 R`. Do not call `_EXTRUDER_OFFSET_ACTION_WAIT_COOL_T0`. Startup `M109` lines belong to Orca's start, not to the pick waits.

Temperatures and offsets live in `settings.py`. Trace cloth cools to 180 and heats to 210, with place and pick Z offsets of -0.3. Trace braid cools to 160. A plug cools to 140. A pcb cools to 100, heats to 210, places 1 mm below the recorded Z, steps aside by 1 mm, then does prinjection (hover +5, inject -1.4, swipe -0.4). A generic print cools to 50 and heats to 230. Tamp depths: type 0 end 0.6, type 1 trace-trace 1.8, type 2 trace-plug 2.8, type 3 trace-pcb 2.3.

Our wipe location for the U1 is `(220, 15, 3)`. Retract used around that move is 0.8. `writer.firmware` is `"klipper"` when the printer name is a Snapmaker U1, and that is set before the startup is copied. Orca is the slicer either way.

## spec.json

Version 1 of the file Rhino writes and the pipeline reads. The pipeline then adds tray fields. `web/schema/spec.v1.schema.json` describes that file, including the optional write-back fields. It is not a new spec.

Rhino writes: `version`, `printer`, `use_trace_braid`, `housing`, `tray` (`"generated"`), `tray_spacing`, `tray_origin`, and `parts[]`.

Every part has `type`, `place`, `pick`, and `pause_layer`. Types are `trace_braid`, `trace_cloth`, `plug`, `pcb`, and `print`. A trace also has `length`, `width`, `height`, `horizontal`, `line_from`, `line_to`, and `tamps` (`type` 0–3). A plug has `radius` and `height`. A pcb or print has `size`, `bbox_center`, `bbox_min`, `tray_offset`, `mesh`, and, for a pcb, `prinjection`. Type detection in the exporter: a Grasshopper `print` with a radius is a plug, one with geometry is a pcb, otherwise it is `trace_braid` or `trace_cloth` from the braid input.

The pipeline writes back: `slot` on laid-out parts, `pocket` plus `pocket_depth` on pcb and print parts, `slot_shape` on plugs, and it replaces `pick` with the point that meets the opening it actually cut.

`use_trace_braid` comes from the Grasshopper `braid` input and defaults to true when the input is missing. The latest slice had it false, so the traces were `trace_cloth`.

## The first plugin window

`plugin/print_in_place.py` is a Rhino 8 script, not an installed plugin. Run `ScriptEditor`, open that file, and press Run. Make housing adds a 20 by 12 by 3 mm box on `Default`. Draw housing uses Rhino's box command. Traces and vias go on `Traces`. Only point snap stays on. Grid snap, center, end, midpoint, near, knot, quadrant, and intersection stay off. Ortho is on only while a trace or a housing box is being clicked. Height mm places the grid dots. It does not move the drawing plane. The bottom of an imported part sits at Z=0, centered on the housing. Points on the component's Part layer are the contact points, drawn in red. Draw trace is the same as `Scripts/draw_trace.py`: it switches to the Traces layer, turns ortho on, and runs Rhino's line command. Slice writes `output/spec/spec.json` from that drawing and runs the same pipeline command as the Grasshopper button. It does not send a print. Trace width is 2.8 mm, trace height and layer height are 0.2 mm, and the pause layer is round(Z / 0.2) + 1. Show grid draws dots over the model at that height. Grasshopper stays closed. Do not publish a package for this step. The Grasshopper file still slices when it solves.

## Still inside Grasshopper, on purpose

The newest C# is the designer: traces, the grid, pause layers, and the preview tray. Deleting it breaks drawing. The newest Py3 is the exporter and the launcher. `Scripts/pipeline` and `Scripts/gcode_writer.py` are the printer path. The older dated copies were removed. The commit before tag `v2`, and tag `v1`, still have the pre-cleanup copies. Do not delete a newest file.

## Leave alone unless asked

- `First Task till week 2` and `Backups/`.
- Moonraker, and sending a print. The glowing print already happened. Do not resend it.
- Do not rebuild the Rhino model or auto-layout the canvas.
- Do not "fix" the trace tamp that goes slightly below the bed. The printed file did the same kind of move. A far tamp can sit a few millimetres past the housing when the trace line is drawn longer than the box. That is the drawing, not a shift bug.
- Do not rename spec fields. The schema under `web/schema/` must keep matching the file Slice writes.
- Do not add a Moonraker client or any function that sends gcode to a printer. The web app is a viewer.

## Known sharp edges

- The live Grasshopper scripts are the `261118` names above. The `261117` copies are still in `Scripts/`. Newest date wins. Do not delete the newest file.
- `tray_spacing` is hardcoded to 3.0 in the exporter.
- Plug holes in the Python tray are squares.
- A locked `combined_output.gcode` (open in Orca) can make Slice fail while it clears `output/`.
- On 18 Nov 2026 the ghx was saved over `Designer export life.gh`, and Slice wrote a printer file. After changing the newest Py3 file, both files have to carry the same script. Opening a file from `Backups/` can restore an older script. The housing must be a closed solid on layer `Default`.
- `machine.json` is local. Oliver opened the project on a Mac on 17 Nov 2026 and the slice ran. He had not installed the Human UI build for Mac, so the movable window did not appear. The printer pin is not fed by that window. An empty printer name becomes `snapmaker u1`. A file whose `platform` is `mac` is rejected on this Windows machine, which is the check that exists here. The same reader accepts a mac file when the computer is a Mac.
- The movable window is Human UI 0.8.10, which is the Windows build. The Paths component in the ghx has no inputs. It finds the Designer folder from the document and reads Orca from `machine.json`. Its outputs still build the component buttons and the bed files. The package-manager build does not open that window on a Mac. The test build `human-ui-0.9.43-rh8_27-any.yak` was not installed for the 17 Nov open. The path code does not search Program Files.
