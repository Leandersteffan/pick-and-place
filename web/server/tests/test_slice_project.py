"""slice_project and StageTracker (Requirements 11.2, 11.4, 11.5, 11.7)."""

import json
import os
import time

import pytest

from pnp_server import bridge
from pnp_server.logs import StageTracker
from pnp_server.normalize import normalize_gcode

FIXTURE_FILES = ("housing.3mf", "part-2.stl")


def _leftovers():
    if not bridge.TMP_ROOT.is_dir():
        return set()
    return {p.name for p in bridge.TMP_ROOT.glob("pnp-*")}


def _fixture_inputs(fixture_dir):
    spec = json.loads((fixture_dir / "spec.json").read_text(encoding="utf-8"))
    files = {name: (fixture_dir / name).read_bytes() for name in FIXTURE_FILES}
    return spec, files


def test_stage_tracker_maps_progress_lines_and_keeps_tail():
    tracker = StageTracker()
    assert tracker.stage == "load_spec"
    print_lines = [
        ("Spec: x/spec.json", "load_spec"),
        ("OrcaSlicer: C:/orca.exe", "tray_layout"),
        ("Tray written to x/tray.stl", "slice_tray"),
        ("Slicing tray...", "slice_tray"),
        ("some orca output", "slice_tray"),
        ("Slicing housing...", "slice_housing"),
        ("Shared bed nudge +1.0, +2.0 mm.", "assemble"),
    ]
    for line, stage in print_lines:
        tracker.write(line)
        tracker.write("\n")
        assert tracker.stage == stage
    for i in range(2500):
        tracker.write("line {0}\n".format(i))
    tracker.write("unterminated")
    tail = tracker.tail(200)
    assert len(tail) == 200
    assert tail[-1] == "unterminated"
    assert tail[-2] == "line 2499"
    assert len(tracker.tail(5000)) == 2000


def test_busy_lock_raises_slice_busy(fixture_dir):
    spec, files = _fixture_inputs(fixture_dir)
    assert bridge.SLICE_LOCK.acquire(blocking=False)
    try:
        with pytest.raises(bridge.SliceBusy):
            bridge.slice_project(spec, files)
    finally:
        bridge.SLICE_LOCK.release()


def test_failure_reports_stage_and_cleans_up(fixture_dir):
    spec, files = _fixture_inputs(fixture_dir)
    before = _leftovers()
    files.pop("housing.3mf")  # load_spec raises "Housing mesh is missing"
    with pytest.raises(bridge.SliceFailed) as info:
        bridge.slice_project(spec, files)
    assert info.value.stage == "load_spec"
    assert "Housing mesh is missing" in info.value.message
    assert _leftovers() == before
    assert not bridge.is_busy()


def test_startup_sweep_removes_only_old_folders(tmp_path):
    old = tmp_path / "pnp-old"
    new = tmp_path / "pnp-new"
    other = tmp_path / "keep-me"
    for folder in (old, new, other):
        folder.mkdir()
    hours_ago = time.time() - 7200
    os.utime(old, (hours_ago, hours_ago))
    os.utime(other, (hours_ago, hours_ago))
    removed = bridge.sweep_stale_tmp(root=tmp_path)
    assert removed == [old]
    assert not old.exists() and new.exists() and other.exists()


@pytest.mark.orca
def test_slice_project_matches_fixture(fixture_dir):
    spec, files = _fixture_inputs(fixture_dir)
    before = _leftovers()
    result = bridge.slice_project(spec, files)
    assert _leftovers() == before
    expected = normalize_gcode((fixture_dir / "combined_output.gcode").read_bytes().decode("utf-8"))
    assert normalize_gcode(result.gcode) == expected
    assert len(result.tray_stl) > 84
    assert result.spec["parts"] and "slot" in result.spec["parts"][0]
    assert result.offsets is not None
    assert result.offsets["tray"] == pytest.approx([0.5, 1.0], abs=1e-6)
    assert result.offsets["model"] == pytest.approx([0.5, 23.615634], abs=1e-6)
    assert result.duration_s > 0
    assert any(line.startswith("Shared bed nudge") for line in result.log_tail)
