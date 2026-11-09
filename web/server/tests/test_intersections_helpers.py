"""Unit tests for the Intersection_Port helpers (Rhino Line semantics, rounding, branches)."""

import copy

import pytest

from pnp_server.intersections import (
    Line,
    Vec,
    recompute_tamps,
    round4,
    safe_pick_distance,
    try_get_intersection,
)


def test_closest_parameter_uses_infinite_line():
    line = Line(Vec(0, 0), Vec(10, 0))
    assert line.closest_parameter(Vec(15, 3)) == pytest.approx(1.5)
    assert line.closest_parameter(Vec(-5, 3)) == pytest.approx(-0.5)


def test_distance_to_finite_and_infinite():
    line = Line(Vec(0, 0), Vec(10, 0))
    assert line.distance_to(Vec(15, 0), True) == pytest.approx(5.0)
    assert line.distance_to(Vec(15, 0), False) == pytest.approx(0.0)
    assert line.distance_to(Vec(5, 2), True) == pytest.approx(2.0)


def test_round4_is_half_to_even():
    # Halves that are exact in binary, so Python and .NET agree.
    assert round4(0.03125) == 0.0312  # exact binary, half to even
    assert round4(0.09375) == 0.0938
    assert round4(2.2061870997149393) == 2.2062


def test_crossing():
    top = Line(Vec(0, 5, 2), Vec(10, 5, 2))
    bottom = Line(Vec(4, 0, 1.8), Vec(4, 10, 1.8))
    hit = try_get_intersection(top, bottom, 2.8)
    assert (hit.x, hit.y, hit.z) == pytest.approx((4, 5, 2))


def test_crossing_out_of_range_is_none():
    top = Line(Vec(0, 5), Vec(10, 5))
    bottom = Line(Vec(20, 0), Vec(20, 10))
    assert try_get_intersection(top, bottom, 2.8) is None


def test_colinear_overlap_returns_middle():
    top = Line(Vec(0, 0), Vec(10, 0))
    bottom = Line(Vec(6, 0), Vec(14, 0))
    hit = try_get_intersection(top, bottom, 2.8)
    assert (hit.x, hit.y) == pytest.approx((8, 0))


def test_parallel_overlap_within_width():
    top = Line(Vec(0, 0), Vec(10, 0))
    near = Line(Vec(2, 2), Vec(6, 2))
    far = Line(Vec(2, 6.98), Vec(6, 6.98))
    hit = try_get_intersection(top, near, 2.8)
    assert (hit.x, hit.y) == pytest.approx((4, 0))
    assert try_get_intersection(top, far, 2.8) is None


def _trace(x0, y0, x1, y1, z, ext=1.55):
    return {
        "type": "trace_cloth",
        "place": {"x": (x0 + x1) / 2, "y": (y0 + y1) / 2, "z": z},
        "width": 2.8,
        "height": 0.2,
        "line_from": {"x": x0, "y": y0, "z": z},
        "line_to": {"x": x1, "y": y1, "z": z},
    }


def test_same_layer_crossing_tamps_only_later_trace():
    a = _trace(0, 10, 20, 10, 2.0)
    b = _trace(10, 0, 10, 20, 2.0)
    out = recompute_tamps({"parts": [a, b]}, [])
    assert [t["type"] for t in out["parts"][0]["tamps"]] == [0, 0]
    assert [t["type"] for t in out["parts"][1]["tamps"]] == [0, 0, 1]
    assert "_intersections" not in out["parts"][1]


def test_end_tamp_within_3mm_is_removed_and_input_unchanged():
    trace = _trace(0, 0, 0, 20, 2.2)
    spec = {"parts": [trace]}
    before = copy.deepcopy(spec)
    cp = {"x": 0.0, "y": 1.55, "z": 2.0, "overrides": {"k": "v"}}
    out = recompute_tamps(spec, [cp])
    tamps = out["parts"][0]["tamps"]
    assert [t["type"] for t in tamps] == [0, 3]
    assert tamps[1]["overrides"] == {"k": "v"}
    assert tamps[1]["z"] == 2.2
    assert spec == before


def test_plug_only_one_trace_height_below():
    trace = _trace(0, 0, 0, 20, 2.2)
    plug_below = {"type": "plug", "place": {"x": 0.5, "y": 10, "z": 2.0}, "radius": 1.0}
    plug_same = {"type": "plug", "place": {"x": 0.5, "y": 10, "z": 2.2}, "radius": 1.0}
    assert [t["type"] for t in recompute_tamps({"parts": [trace, plug_below]}, [])["parts"][0]["tamps"]] == [0, 0, 2]
    assert [t["type"] for t in recompute_tamps({"parts": [trace, plug_same]}, [])["parts"][0]["tamps"]] == [0, 0]


def test_safe_pick_distance_avoids_danger_zone():
    trace = _trace(0, 0, 0, 20, 2.0)
    assert safe_pick_distance(trace, []) == pytest.approx(10.0)
    # Danger zone (8.801, 11.599): every 0.5 step up to 1.0 mm is blocked; the zone edge 8.8 wins over 8.5.
    assert safe_pick_distance(trace, [Vec(0, 10.2, 2.0)]) == pytest.approx(8.8)


def test_auto_place_moves_place_to_safe_point():
    lower = _trace(-5, 10.2, 5, 10.2, 1.8)
    upper = _trace(0, 0, 0, 20, 2.0)
    out = recompute_tamps({"parts": [lower, upper]}, [], auto_place=[1])
    place = out["parts"][1]["place"]
    # C# measures the 3D distance to the intersection at the lower Z: sqrt(10.2^2 + 0.2^2) = 10.20196.
    assert (place["x"], place["y"], place["z"]) == pytest.approx((0, 8.802, 2.0))
