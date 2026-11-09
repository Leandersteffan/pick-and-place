"""pipeline.report.bed_offsets on the Fixture files (Requirements 11.9, 17.6)."""

import json
import shutil

import pytest

from pipeline.report import bed_offsets


def _copy_fixture(fixture_dir, tmp_path):
    spec_dir = tmp_path / "spec"
    spec_dir.mkdir()
    for name in ("tray.stl", "housing.3mf", "spec.json"):
        shutil.copyfile(fixture_dir / name, spec_dir / name)
    spec = json.loads((spec_dir / "spec.json").read_text(encoding="utf-8"))
    return spec_dir, spec


def test_fixture_offsets(fixture_dir, tmp_path):
    spec_dir, spec = _copy_fixture(fixture_dir, tmp_path)
    offsets = bed_offsets(str(spec_dir), spec)
    assert offsets is not None
    assert offsets["source"] == "pipeline"
    assert offsets["tray"] == pytest.approx([0.5, 1.0], abs=1e-5)
    assert offsets["model"] == pytest.approx([0.5, 23.615634], abs=1e-5)
    assert offsets["model"][1] - offsets["tray"][1] == pytest.approx(offsets["extra_y"], abs=1e-9)


def test_prusa_offsets_are_zero(fixture_dir, tmp_path):
    spec_dir, spec = _copy_fixture(fixture_dir, tmp_path)
    spec["printer"] = "prusa xl"
    offsets = bed_offsets(str(spec_dir), spec)
    assert offsets["tray"] == [0.0, 0.0]
    assert offsets["model"] == [0.0, 0.0]
    assert offsets["extra_y"] == 0.0
