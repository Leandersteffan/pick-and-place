"""POST /api/slice (Requirements 11.4, 11.5, 11.6, 11.7)."""

import base64
import json

import pytest
from fastapi.testclient import TestClient

from pnp_server import bridge, slice_api
from pnp_server.app import app
from pnp_server.normalize import normalize_gcode

client = TestClient(app)


def _spec(fixture_dir):
    return json.loads((fixture_dir / "spec.json").read_text(encoding="utf-8"))


def _post(fixture_dir, spec=None, housing="housing.3mf", meshes=("part-2.stl",), options=None):
    spec = _spec(fixture_dir) if spec is None else spec
    files = [("housing", (housing, (fixture_dir / "housing.3mf").read_bytes(), "application/octet-stream"))]
    for name in meshes:
        files.append(("meshes", (name, (fixture_dir / "part-2.stl").read_bytes(), "model/stl")))
    data = {"spec": json.dumps(spec), "options": json.dumps(options or {"recompute_tamps": False})}
    return client.post("/api/slice", data=data, files=files)


def _fake_result(spec):
    return bridge.SliceResult(
        gcode="G28\n",
        tray_stl=b"solid tray",
        spec=spec,
        offsets={"tray": [0.5, 1.0], "model": [0.5, 23.6]},
        duration_s=1.5,
        log_tail=["Shared bed nudge +0.0, +0.0 mm."],
        pipeline_version="abc1234",
    )


def test_success_shape_with_mocked_bridge(fixture_dir, monkeypatch):
    seen = {}

    def fake(spec, files):
        seen["files"] = sorted(files)
        return _fake_result(spec)

    monkeypatch.setattr(bridge, "slice_project", fake)
    response = _post(fixture_dir)
    assert response.status_code == 200, response.text
    body = response.json()
    assert seen["files"] == ["housing.3mf", "part-2.stl"]
    assert body["gcode"] == "G28\n"
    assert base64.b64decode(body["tray_stl_b64"]) == b"solid tray"
    assert body["intersections"] == {"ran": False, "changed_parts": []}
    assert body["offsets"]["tray"] == [0.5, 1.0]
    assert body["pipeline_version"] == "abc1234"
    assert body["duration_s"] == 1.5
    assert body["log_tail"] == ["Shared bed nudge +0.0, +0.0 mm."]
    assert body["spec"]["housing"] == "housing.3mf"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"meshes": ()},  # part-2.stl named by the spec but not uploaded
        {"meshes": ("part-2.stl", "part-9.stl")},  # extra file
        {"meshes": ("..\\part-2.stl",)},  # bad name
        {"housing": "housing.stl"},  # does not equal spec.housing
        {"housing": "evil.3mf"},
    ],
)
def test_bad_file_sets_are_400(fixture_dir, monkeypatch, kwargs):
    monkeypatch.setattr(bridge, "slice_project", lambda spec, files: pytest.fail("bridge must not run"))
    response = _post(fixture_dir, **kwargs)
    assert response.status_code == 400, response.text
    assert response.json()["field"] in ("housing", "meshes")


def test_upload_over_limit_is_400(fixture_dir, monkeypatch):
    monkeypatch.setattr(slice_api, "MAX_UPLOAD_BYTES", 1000)
    response = _post(fixture_dir)
    assert response.status_code == 400
    assert "50 MB" in response.json()["detail"]


def test_missing_spec_field_is_400():
    response = client.post("/api/slice", data={"options": "{}"}, files=[("housing", ("housing.3mf", b"x"))])
    assert response.status_code == 400
    assert response.json()["field"] == "spec"


def test_schema_failure_is_422(fixture_dir, monkeypatch):
    monkeypatch.setattr(bridge, "slice_project", lambda spec, files: pytest.fail("bridge must not run"))
    spec = _spec(fixture_dir)
    spec["version"] = "one"
    response = _post(fixture_dir, spec=spec)
    assert response.status_code == 422
    body = response.json()
    assert body["stage"] == "validate"
    assert any(error["pointer"] == "/version" for error in body["errors"])


def test_busy_is_409(fixture_dir):
    assert bridge.SLICE_LOCK.acquire(blocking=False)
    try:
        response = _post(fixture_dir)
    finally:
        bridge.SLICE_LOCK.release()
    assert response.status_code == 409


def test_pipeline_failure_is_500_without_traceback(fixture_dir, monkeypatch):
    def fail(spec, files):
        raise bridge.SliceFailed("slice_housing", "Orca exited with 1", ["Slicing housing...", "boom"])

    monkeypatch.setattr(bridge, "slice_project", fail)
    response = _post(fixture_dir)
    assert response.status_code == 500
    assert response.json() == {
        "stage": "slice_housing",
        "message": "Orca exited with 1",
        "log_tail": ["Slicing housing...", "boom"],
    }
    assert "Traceback" not in response.text


@pytest.mark.orca
def test_real_slice_matches_fixture(fixture_dir):
    response = _post(fixture_dir)
    assert response.status_code == 200, response.text[:2000]
    body = response.json()
    expected = normalize_gcode((fixture_dir / "combined_output.gcode").read_bytes().decode("utf-8"))
    assert normalize_gcode(body["gcode"]) == expected
    assert body["offsets"]["tray"] == pytest.approx([0.5, 1.0], abs=1e-6)
    assert body["offsets"]["model"] == pytest.approx([0.5, 23.615634], abs=1e-6)
    assert len(base64.b64decode(body["tray_stl_b64"])) > 84
