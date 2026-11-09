"""POST /api/intersections and the Intersection_Port inside /api/slice (Requirements 13.1, 13.3)."""

import json

import pytest
from fastapi.testclient import TestClient

from pnp_server import bridge, intersections_api
from pnp_server.app import app
from pnp_server.intersections import TRACE_TYPES

client = TestClient(app)


def _spec(fixture_dir):
    return json.loads((fixture_dir / "spec.json").read_text(encoding="utf-8"))


def _trace_indices(spec):
    return [i for i, p in enumerate(spec["parts"]) if p.get("type") in TRACE_TYPES]


def _slice(fixture_dir, spec, options):
    files = [
        ("housing", ("housing.3mf", (fixture_dir / "housing.3mf").read_bytes(), "application/octet-stream")),
        ("meshes", ("part-2.stl", (fixture_dir / "part-2.stl").read_bytes(), "model/stl")),
    ]
    data = {"spec": json.dumps(spec), "options": json.dumps(options)}
    return client.post("/api/slice", data=data, files=files)


def _fake_result(spec):
    return bridge.SliceResult(
        gcode="G28\n", tray_stl=b"t", spec=spec, offsets={"tray": [0, 0], "model": [0, 0]},
        duration_s=0.1, log_tail=[], pipeline_version="x",
    )


def test_intersections_default_contact_points_keep_fixture_tamps(fixture_dir):
    spec = _spec(fixture_dir)
    response = client.post("/api/intersections", json={"spec": spec})
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"spec", "report"}
    assert body["report"]["tamps_before"] == body["report"]["tamps_after"] == 4
    for i in _trace_indices(spec):
        types = [t["type"] for t in body["spec"]["parts"][i]["tamps"]]
        assert types == [t["type"] for t in spec["parts"][i]["tamps"]]


def test_intersections_without_contact_points_drops_type3_and_reports_changes(fixture_dir):
    spec = _spec(fixture_dir)
    response = client.post("/api/intersections", json={"spec": spec, "contact_points": []})
    assert response.status_code == 200, response.text
    body = response.json()
    traces = _trace_indices(spec)
    assert body["report"]["changed_parts"] == traces
    for i in traces:
        assert all(t["type"] != 3 for t in body["spec"]["parts"][i]["tamps"])


def test_intersections_auto_place_moves_place(fixture_dir):
    spec = _spec(fixture_dir)
    index = _trace_indices(spec)[0]
    spec["parts"][index]["place"] = {"x": 0.0, "y": 0.0, "z": 0.0}
    response = client.post("/api/intersections", json={"spec": spec, "auto_place": [index]})
    assert response.status_code == 200, response.text
    body = response.json()
    assert index in body["report"]["changed_parts"]
    assert body["spec"]["parts"][index]["place"] != {"x": 0.0, "y": 0.0, "z": 0.0}


def test_intersections_schema_failure_is_422(fixture_dir):
    spec = _spec(fixture_dir)
    spec["version"] = "one"
    response = client.post("/api/intersections", json={"spec": spec})
    assert response.status_code == 422
    assert response.json()["stage"] == "validate"


@pytest.mark.parametrize("extra", [{"auto_place": [99]}, {"contact_points": [{"x": 1}]}])
def test_intersections_bad_options_are_400(fixture_dir, extra):
    response = client.post("/api/intersections", json={"spec": _spec(fixture_dir), **extra})
    assert response.status_code == 400


def test_slice_runs_port_before_bridge(fixture_dir, monkeypatch):
    seen = {}

    def fake(spec, files):
        seen["spec"] = spec
        return _fake_result(spec)

    monkeypatch.setattr(bridge, "slice_project", fake)
    spec = _spec(fixture_dir)
    response = _slice(fixture_dir, spec, {"recompute_tamps": True, "contact_points": []})
    assert response.status_code == 200, response.text
    traces = _trace_indices(spec)
    assert response.json()["intersections"] == {"ran": True, "changed_parts": traces}
    for i in traces:
        assert all(t["type"] != 3 for t in seen["spec"]["parts"][i]["tamps"])


def test_slice_port_failure_is_500_intersections(fixture_dir, monkeypatch):
    def boom(*args, **kwargs):
        raise ValueError("bad trace")

    monkeypatch.setattr(intersections_api._port, "recompute_tamps", boom)
    monkeypatch.setattr(bridge, "slice_project", lambda spec, files: pytest.fail("bridge must not run"))
    response = _slice(fixture_dir, _spec(fixture_dir), {"recompute_tamps": True})
    assert response.status_code == 500
    assert response.json() == {"stage": "intersections", "message": "bad trace", "log_tail": []}


def test_health_reports_port_disabled(monkeypatch):
    monkeypatch.setenv("PNP_DISABLE_INTERSECTIONS", "1")
    assert client.get("/api/health").json()["intersection_port"] is False
