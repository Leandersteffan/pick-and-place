# Fixture demo-v1

Byte-exact copy of the gitignored `output/` folder of a Rhino Slice run, in the flat Project_Bundle layout.

- Source: `output/spec/spec.json`, `output/spec/housing.3mf`, `output/spec/housing.stl`, `output/spec/part-2.stl`, `output/spec/tray.stl` and `output/combined_output.gcode`, copied without changes.
- Not copied: `housing.step`, `setup.gcode`, `part.gcode`, `slice_log.txt` and the `*_orca/` folders.
- Repository commit at copy time: `5d1acf5` (tag `v2`). `output/` is not tracked by git. The Orca timestamp in the gcode (3 November 2026) is older than the last pipeline commit `f911fe9`, so the exact pipeline version that produced these files is unknown and `pipeline_version` in `manifest.json` is `null`.
- Copied on: 2026-11-08.

`spec.json` is the spec written back by the pipeline (CRLF line endings, as the pipeline writes it on Windows). `combined_output.gcode` has LF line endings.

`spec.export.json` is derived, not copied: it is `spec.json` with the traygen-only write-back fields `slot`, `pocket`, `pocket_depth` and `slot_shape` removed, written with Python `json.dump(indent=2)` (same line endings as `spec.json`, no trailing newline). It stands in for a raw Grasshopper export until a real one is available.

`manifest.json` lists the SHA-256 hash and byte size of every other file in this folder. Regenerate it if any file here changes.
