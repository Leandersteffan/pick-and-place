# Pick and place

Print an object that is already assembled. The printer pauses, picks up a trace or a component, and places it into the housing while the part is still being printed.

## Look at a print

`web/` is a local page for a finished print. It shows the housing, the tray, and the toolpath from `combined_output.gcode`.

```text
cd web/app
npm install
npm run dev
```

Open http://127.0.0.1:5173 and press **Load demo**. The demo is `web/fixtures/demo-v1/`, the same files as in `output/`.

Slicing again from that page needs the local server, in a second terminal:

```text
cd web/server
py -3 -m uvicorn pnp_server.app:app --host 127.0.0.1 --port 8765
```

Without that server the page still shows the print. Regenerate stays off.

## Design and slice

Open `Designer export life.gh` and press Slice. Rhino holds the design. `Scripts/pipeline` builds the tray and writes `output/combined_output.gcode`.

The description of that print is `output/spec/spec.json`. The schema for it is [`web/schema/spec.v1.schema.json`](web/schema/spec.v1.schema.json).

More detail is in [docs/PROJECT.md](docs/PROJECT.md).

## Layout

| Path | What it is |
| --- | --- |
| `web/` | The page that shows a print |
| `output/` | The last slice, including the combined gcode and the spec |
| `Scripts/pipeline/` | Builds the tray, slices, and writes the printer file |
| `Designer export life.gh` | The Grasshopper file to open |
| `resources/` | Printer profiles and components |

## To run a slice

Rhino with Grasshopper, Python 3 with `manifold3d` (`py -3 -m pip install manifold3d`), and [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer) for the Snapmaker U1. PrusaSlicer is used when the selected printer is a Prusa.

## Credit

The designer is Oliver's. The first printed part, tag `v1`, was built entirely in Grasshopper. The tray and the printer file now live in Python, and the page in `web/` is the next step toward running this outside Rhino. HCI seminar at HPI.
