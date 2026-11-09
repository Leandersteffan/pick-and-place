"""Fixture tamps golden test (Requirement 13.2).

Recomputing the tamps of fixtures/demo-v1/spec.json from its contact points
must reproduce the tamps the Grasshopper exporter wrote: same count, same
types in order, positions within 0.001 mm.
"""

import json

import pytest

from pnp_server.intersections import (
    TRACE_TYPES,
    derive_contact_points,
    prinjection_contact_points,
    recompute_tamps,
)

TOL_MM = 0.001

# Known tamps from the fixture, per trace in Spec order: (type, x, y).
EXPECTED = [
    [(0, 15.508442, 24.952154), (3, 15.508442, 14.179259)],
    [(0, 8.523757, 25.00628), (3, 8.523757, 14.183616)],
]


@pytest.fixture(scope="module")
def spec(fixture_dir):
    return json.loads((fixture_dir / "spec.json").read_text(encoding="utf-8"))


def _traces(spec):
    return [p for p in spec["parts"] if p.get("type") in TRACE_TYPES]


def _assert_same_tamps(expected_spec, actual_spec):
    expected_traces = _traces(expected_spec)
    actual_traces = _traces(actual_spec)
    assert len(actual_traces) == len(expected_traces)
    for i, (exp, act) in enumerate(zip(expected_traces, actual_traces)):
        exp_tamps = exp.get("tamps") or []
        act_tamps = act.get("tamps") or []
        assert len(act_tamps) == len(exp_tamps), f"trace {i + 1}: tamp count"
        assert [t["type"] for t in act_tamps] == [t["type"] for t in exp_tamps], f"trace {i + 1}: types"
        for e, a in zip(exp_tamps, act_tamps):
            for axis in ("x", "y", "z"):
                assert abs(a[axis] - e[axis]) <= TOL_MM, f"trace {i + 1}: {axis} {a[axis]} vs {e[axis]}"


@pytest.mark.parametrize(
    "contact_points",
    [prinjection_contact_points, derive_contact_points],
    ids=["prinjection_only", "derived"],
)
def test_recompute_reproduces_fixture_tamps(spec, contact_points):
    out = recompute_tamps(spec, contact_points(spec))
    _assert_same_tamps(spec, out)

    traces = _traces(out)
    assert len(traces) == len(EXPECTED)
    for i, (trace, expected) in enumerate(zip(traces, EXPECTED)):
        got = [(t["type"], t["x"], t["y"]) for t in trace["tamps"]]
        assert [g[0] for g in got] == [e[0] for e in expected], f"trace {i + 1}: types"
        for (_, gx, gy), (_, ex, ey) in zip(got, expected):
            assert abs(gx - ex) <= TOL_MM and abs(gy - ey) <= TOL_MM, f"trace {i + 1}: ({gx}, {gy})"


def test_recompute_does_not_change_input(spec):
    before = json.dumps(spec, sort_keys=True)
    recompute_tamps(spec, derive_contact_points(spec))
    assert json.dumps(spec, sort_keys=True) == before
