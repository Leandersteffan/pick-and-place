import os

from fastapi.testclient import TestClient

from pnp_server import bridge
from pnp_server.app import app

FIELDS = {
    "version", "python", "pipeline_dir", "pipeline_version", "orca_path", "orca_exists",
    "orca_candidates", "manifold3d", "intersection_port", "busy",
}


def test_health_returns_all_fields():
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert FIELDS <= body.keys()
    assert set(body["manifold3d"]) == {"ok", "version", "error"}
    assert body["intersection_port"] is True
    assert body["busy"] is False
    assert body["pipeline_dir"] == str(bridge.SCRIPTS)
    assert body["orca_exists"] == (body["orca_path"] is not None and os.path.isfile(body["orca_path"]))


def test_health_reports_busy_while_slice_lock_is_held():
    with bridge.SLICE_LOCK:
        assert TestClient(app).get("/api/health").json()["busy"] is True
