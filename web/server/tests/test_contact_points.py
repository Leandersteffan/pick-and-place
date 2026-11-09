"""Contact-point derivation agrees with the shared vector also checked by Vitest.

web/schema/testset/contact-points.json is read here by ``derive_contact_points``
and by web/app/src/model/contactPoints.test.ts by ``deriveContactPoints``.
"""

import json

import pytest

from pnp_server.intersections import derive_contact_points


def _cases(schema_path):
    path = schema_path.parent / "testset" / "contact-points.json"
    return json.loads(path.read_text(encoding="utf-8"))["cases"]


def test_vector_has_cases(schema_path):
    assert len(_cases(schema_path)) >= 4


def test_derive_matches_shared_vector(schema_path):
    for case in _cases(schema_path):
        assert derive_contact_points(case["spec"]) == case["expected"], case["name"]


def test_fixture_contact_points(fixture_dir):
    spec = json.loads((fixture_dir / "spec.json").read_text(encoding="utf-8"))
    points = derive_contact_points(spec)
    assert [(round(p["x"], 6), round(p["y"], 6), round(p["z"], 6)) for p in points] == [
        (8.523757, 14.183616, 2.006187),
        (15.508442, 14.179259, 2.006187),
    ]
    assert {p["origin"] for p in points} == {"prinjection"}
