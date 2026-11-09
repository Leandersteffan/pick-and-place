import copy
import json

import pytest
from fastapi.testclient import TestClient

from pnp_server.app import app
from pnp_server.validation import _pointer, validate_spec


@pytest.fixture(scope="module")
def spec(fixture_dir):
    return json.loads((fixture_dir / "spec.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def _index_of(spec, types):
    return next(i for i, part in enumerate(spec["parts"]) if part["type"] in types)


def test_fixture_spec_is_valid(spec, client):
    assert validate_spec(spec) == {"valid": True, "errors": []}
    response = client.post("/api/validate", json={"spec": spec})
    assert response.status_code == 200
    assert response.json() == {"valid": True, "errors": []}


def test_broken_spec_gives_pointered_errors_from_the_matching_branch(spec, client):
    broken = copy.deepcopy(spec)
    broken["version"] = "one"
    trace = _index_of(broken, {"trace_cloth", "trace_braid"})
    del broken["parts"][trace]["length"]
    component = _index_of(broken, {"pcb", "print"})
    broken["parts"][component]["tray_offset"] = "wide"

    response = client.post("/api/validate", json={"spec": broken})
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    pointers = [(e["pointer"], e["keyword"]) for e in body["errors"]]
    assert ("/version", "type") in pointers
    assert (f"/parts/{trace}", "required") in pointers
    assert (f"/parts/{component}/tray_offset", "type") in pointers
    # Only leaves from the branch matching each part's type: no oneOf wrapper, no other branch.
    assert all(e["keyword"] != "oneOf" for e in body["errors"])
    assert all("'plug'" not in e["message"] for e in body["errors"])
    assert pointers == sorted(pointers)


def test_unknown_part_type_reports_enum_at_type(spec):
    broken = copy.deepcopy(spec)
    broken["parts"][0]["type"] = "resistor"
    result = validate_spec(broken)
    assert result["valid"] is False
    assert [(e["pointer"], e["keyword"]) for e in result["errors"]] == [("/parts/0/type", "enum")]


def test_pointer_escapes_rfc6901():
    assert _pointer([]) == ""
    assert _pointer(["a/b", "c~d", 3]) == "/a~1b/c~0d/3"


def test_non_json_body_is_400(client):
    response = client.post("/api/validate", content=b"not json{", headers={"content-type": "application/json"})
    assert response.status_code == 400
