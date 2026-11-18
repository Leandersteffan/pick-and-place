# Pick and place

The printer builds an object that is already assembled. It prints a housing, pauses, picks up a trace or a component, and places it into the housing while the part is still being printed.

Rhino is where you design. Pressing Slice writes one printer file. The tray and the slicing happen in Python, outside Grasshopper.

## Set up this computer

You need Rhino 8 with Grasshopper, Python 3, and [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer).

Install the tray library for that Python:

```text
python -m pip install manifold3d
```

Copy `machine.example.json` to `machine.json` in this folder, next to `Scripts`. Fill in the four lines:

| Line | What to put |
| --- | --- |
| `platform` | `windows` on Windows, `mac` on a Mac. It has to match this computer. |
| `python` | The Python program, the one that has `manifold3d`. |
| `orca` | The OrcaSlicer program. |
| `orca_machine` | Orca's Snapmaker U1 machine profile, the file that came with Orca. |

`machine.json` stays on your computer. It is not part of the git history. The three paths have to be files that exist. Nothing searches the install folders for you.

## Slice

Open `Designer export life.gh`.

The housing has to be one closed solid on the layer `Default`. A box left on `Traces` makes Slice clear `output/` and stop. Parts you place, and the traces, stay off `Default`.

Press Slice. The printer file is `output/combined_output.gcode`.

The printer name defaults to `snapmaker u1` when that input is empty. That is the printer this project is set up for.

## Look at a finished print

`web/` is a local page for a printer file that already exists. It shows the housing, the tray, and the toolpath.

```text
cd web/app
npm install
npm run dev
```

Open http://127.0.0.1:5173 and press **Load demo**.

Slicing again from that page needs a second terminal:

```text
cd web/server
py -3 -m uvicorn pnp_server.app:app --host 127.0.0.1 --port 8765
```

Without that server the page still shows the print.

## A first window, not a slice

`plugin/print_in_place.py` is the Rhino builder. In Rhino 8, run `ScriptEditor`, open that file, and press Run. It makes the housing, traces, vias, and parts at the size stored in the component files. Slice writes the spec from that drawing and runs the pipeline. It does not send a print, and it is not installed. Grasshopper stays closed.

## Where the rest of the detail is

[docs/PROJECT.md](docs/PROJECT.md) is the full description: the tray, the temperatures, the spec, and the files. This page is only the setup.

## Credit

The designer is Oliver's. The first printed part, tag `v1`, was built entirely in Grasshopper. The tray and the printer file now live in Python. HCI seminar at HPI.
