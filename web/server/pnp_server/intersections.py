"""Intersection_Port: a minimal Python port of the C# trace tamp logic.

Ported from ``Scripts/C_-261103_3a356.cs``:

- ``TraceElement`` constructor (end tamps on the nominal line),
- ``TraceElement.CalcIntersections`` (TraceTrace type 1, TracePlug type 2,
  TracePCB type 3, then removal of end tamps within 3.0 mm),
- ``TraceElement.TryGetIntersection`` (crossing, colinear, parallel overlap),
- the no-geometry branch of ``CalculateSafePickDistance``.

It works on Spec v1 dicts (design section 9). Rhino semantics are kept:
``Line.ClosestParameter`` projects onto the infinite line and
``Line.DistanceTo(p, true)`` measures to the finite segment. C# ``Math.Round(x, 4)``
and Python ``round(x, 4)`` both round half to even.

Also holds the Python twin of ``web/app/src/model/contactPoints.ts``.
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Any, Iterable

TRACE_SIDE_OFFSET = 0.15  # C# RunScript traceSideOffset
END_TAMP_CLEARANCE = 3.0  # end tamps within this 3D distance of another tamp are removed
CONTACT_MERGE_TOL_MM = 0.001

TAMP_END = 0
TAMP_TRACE_TRACE = 1
TAMP_TRACE_PLUG = 2
TAMP_TRACE_PCB = 3

TRACE_TYPES = ("trace_cloth", "trace_braid")


def round4(x: float) -> float:
    """C# ``Math.Round(x, 4)``: banker's rounding to 4 decimals."""
    return round(x, 4)


@dataclass(frozen=True)
class Vec:
    x: float
    y: float
    z: float = 0.0

    def __add__(self, o: "Vec") -> "Vec":
        return Vec(self.x + o.x, self.y + o.y, self.z + o.z)

    def __sub__(self, o: "Vec") -> "Vec":
        return Vec(self.x - o.x, self.y - o.y, self.z - o.z)

    def __mul__(self, s: float) -> "Vec":
        return Vec(self.x * s, self.y * s, self.z * s)

    def dot(self, o: "Vec") -> float:
        return self.x * o.x + self.y * o.y + self.z * o.z

    def length(self) -> float:
        return math.sqrt(self.dot(self))

    def unit(self) -> "Vec":
        n = self.length()
        return Vec(0.0, 0.0, 0.0) if n == 0.0 else self * (1.0 / n)

    def distance_to(self, o: "Vec") -> float:
        return (self - o).length()

    def flat(self) -> "Vec":
        return Vec(self.x, self.y, 0.0)

    @staticmethod
    def of(d: dict) -> "Vec":
        return Vec(float(d["x"]), float(d["y"]), float(d.get("z", 0.0)))


@dataclass(frozen=True)
class Line:
    a: Vec
    b: Vec

    def direction(self) -> Vec:
        return self.b - self.a

    def unit(self) -> Vec:
        return self.direction().unit()

    def length(self) -> float:
        return self.direction().length()

    def point_at(self, t: float) -> Vec:
        return self.a + self.direction() * t

    def flat(self) -> "Line":
        return Line(self.a.flat(), self.b.flat())

    def closest_parameter(self, p: Vec) -> float:
        """Rhino ``Line.ClosestParameter``: parameter on the infinite line."""
        d = self.direction()
        dd = d.dot(d)
        if dd == 0.0:
            return 0.0
        return (p - self.a).dot(d) / dd

    def distance_to(self, p: Vec, limit_to_finite_segment: bool = True) -> float:
        """Rhino ``Line.DistanceTo(p, limitToFiniteSegment)``."""
        t = self.closest_parameter(p)
        if limit_to_finite_segment:
            t = min(1.0, max(0.0, t))
        return self.point_at(t).distance_to(p)


def _line_line(t2: Line, b2: Line) -> tuple[float, float] | None:
    """Rhino ``Intersection.LineLine`` for lines in the XY plane: closest parameters, None if parallel."""
    d1, d2 = t2.direction(), b2.direction()
    det = d1.x * d2.y - d1.y * d2.x
    if abs(det) < 1e-12:
        return None
    w = b2.a - t2.a
    a = (w.x * d2.y - w.y * d2.x) / det
    b = (w.x * d1.y - w.y * d1.x) / det
    return a, b


def try_get_intersection(top: Line, bottom: Line, width: float) -> Vec | None:
    """Port of C# ``TraceElement.TryGetIntersection``. Returns a point on ``top`` or None."""
    t2 = top.flat()
    b2 = bottom.flat()

    hit = _line_line(t2, b2)
    if hit is not None:
        a, b = hit
        if (
            t2.point_at(a).distance_to(b2.point_at(b)) < 0.01
            and -0.01 <= a <= 1.01
            and -0.01 <= b <= 1.01
        ):
            return top.point_at(a)

    # Colinear (parallel traces on the same line)
    if t2.distance_to(b2.a, True) < 0.01 and t2.distance_to(b2.b, True) < 0.01:
        ts = t2.closest_parameter(b2.a)
        te = t2.closest_parameter(b2.b)
        o_min = max(0.0, min(ts, te))
        o_max = min(1.0, max(ts, te))
        if o_max - o_min > 0.01:
            return top.point_at((o_min + o_max) / 2.0)

    # Parallel traces that overlap along their length
    dot = abs(t2.unit().dot(b2.unit()))
    if dot > 0.99:
        p_from = t2.closest_parameter(b2.a)
        p_to = t2.closest_parameter(b2.b)
        o_min = max(0.0, min(p_from, p_to))
        o_max = min(1.0, max(p_from, p_to))
        if o_max > o_min:
            centre = t2.point_at((o_min + o_max) / 2.0)
            if b2.distance_to(centre, True) < width + 0.01:
                return top.point_at((o_min + o_max) / 2.0)

    return None


def _tamp(p: Vec, kind: int, overrides: dict | None = None) -> dict:
    record: dict[str, Any] = {"x": p.x, "y": p.y, "z": p.z, "type": kind}
    if overrides:
        record["overrides"] = dict(overrides)
    return record


def _near_trace_2d(line: Line, p: Vec, width: float) -> Vec | None:
    """The C# TracePlug / TracePCB 2D test: closest point on the line, or None."""
    trace2d = line.flat()
    p2d = p.flat()
    t = trace2d.closest_parameter(p2d)
    if -0.01 <= t <= 1.01:
        closest = trace2d.point_at(t)
        if closest.distance_to(p2d) < width / 2.0 + 0.001:
            return closest
    return None


def _trace_tamps(
    index: int,
    trace: dict,
    traces: list[dict],
    plugs: list[dict],
    contact_points: Iterable[dict],
    end_offset: float,
) -> tuple[list[dict], list[Vec]]:
    model = Line(Vec.of(trace["line_from"]), Vec.of(trace["line_to"]))
    width = float(trace["width"])
    height = float(trace["height"])
    d = model.unit()
    ext = width / 2.0 + end_offset

    # Constructor: end tamps on the nominal (unextended) line.
    nominal = Line(model.a + d * ext, model.b - d * ext)
    inset = max(1.0 - ext, 0.0)
    tamps: list[dict] = []
    if nominal.length() >= max(width, inset * 2.0):
        tamps.append(_tamp(nominal.a + d * inset, TAMP_END))
        tamps.append(_tamp(nominal.b - d * inset, TAMP_END))

    line_z = model.a.z
    target_z = round4(line_z - height)
    this_z = round4(line_z)
    intersections: list[Vec] = []

    # allEmbeddables order: traces, then plugs (then PCBs, which add nothing here).
    for other_index, other in enumerate(traces):
        if other_index == index:
            continue
        other_line = Line(Vec.of(other["line_from"]), Vec.of(other["line_to"]))
        other_z = round4(other_line.a.z)
        below = abs(other_z - target_z) < 0.001
        same = abs(other_z - this_z) < 0.001
        if below or (same and other_index < index):
            hit = try_get_intersection(model, other_line, width)
            if hit is not None:
                intersections.append(Vec(hit.x, hit.y, this_z if same else target_z))
                tamps.append(_tamp(Vec(hit.x, hit.y, line_z), TAMP_TRACE_TRACE))

    for plug in plugs:
        place = Vec.of(plug["place"])
        if abs(round4(place.z) - target_z) >= 0.001:
            continue
        closest = _near_trace_2d(model, place, width)
        if closest is not None:
            intersections.append(Vec(closest.x, closest.y, place.z))
            tamps.append(_tamp(Vec(closest.x, closest.y, line_z), TAMP_TRACE_PLUG))

    top_z = line_z
    bottom_z = line_z - height - 0.01
    for cp in contact_points:
        pos = Vec.of(cp)
        if bottom_z <= pos.z <= top_z and _near_trace_2d(model, pos, width) is not None:
            intersections.append(pos)
            tamps.append(_tamp(Vec(pos.x, pos.y, line_z), TAMP_TRACE_PCB, cp.get("overrides")))

    others = [Vec.of(t) for t in tamps if t["type"] != TAMP_END]
    tamps = [
        t
        for t in tamps
        if t["type"] != TAMP_END or all(Vec.of(t).distance_to(o) > END_TAMP_CLEARANCE for o in others)
    ]
    return tamps, intersections


def safe_pick_distance(trace: dict, intersections: Iterable[Vec]) -> float:
    """Port of ``CalculateSafePickDistance(null)`` with the midpoint fallback.

    Returns the distance along ``line_from -> line_to`` of the first candidate,
    nearest the midpoint, outside every intersection danger zone.
    """
    model = Line(Vec.of(trace["line_from"]), Vec.of(trace["line_to"]))
    width = float(trace["width"])
    length = model.length()
    mid = length / 2.0
    dists = [model.a.distance_to(p) for p in intersections]

    candidates: dict[float, None] = {mid: None}  # insertion-ordered like the C# HashSet
    step = 0.5
    steps = int((length / step) / 2.0) + 1
    for i in range(1, steps + 1):
        candidates.setdefault(round4(mid + i * step), None)
        candidates.setdefault(round4(mid - i * step), None)
    for dist in dists:
        candidates.setdefault(round4(dist - width / 2), None)
        candidates.setdefault(round4(dist + width / 2), None)

    valid = sorted((c for c in candidates if 0 <= c <= length), key=lambda c: abs(c - mid))
    for current in valid:
        if any(dist - width / 2 + 0.001 < current < dist + width / 2 - 0.001 for dist in dists):
            continue
        return current
    return mid  # C# SetSafePickDistanceToMidpoint


def _set_tamps(trace: dict, tamps: list[dict]) -> None:
    """Write ``tamps`` where the exporter would put it; drop the key when empty."""
    if not tamps:
        trace.pop("tamps", None)
        return
    if "tamps" in trace:
        trace["tamps"] = tamps
        return
    # The exporter writes tamps after line_to (and after overrides and name).
    anchor = next((k for k in ("name", "overrides", "line_to") if k in trace), None)
    items = list(trace.items())
    trace.clear()
    for key, value in items:
        trace[key] = value
        if key == anchor:
            trace["tamps"] = tamps
    if "tamps" not in trace:
        trace["tamps"] = tamps


def recompute_tamps(
    spec: dict,
    contact_points: Iterable[dict],
    auto_place: Iterable[int] = (),
    end_offset: float = TRACE_SIDE_OFFSET,
) -> dict:
    """Recompute every trace's tamps. Returns a new Spec; the input is not changed.

    ``auto_place`` lists part indices whose ``place`` is set to the safe pick
    point along the trace (``line_from + d * safe_pick_distance``).
    """
    out = copy.deepcopy(spec)
    parts = out.get("parts", [])
    traces = [p for p in parts if p.get("type") in TRACE_TYPES]
    plugs = [p for p in parts if p.get("type") == "plug"]
    points = list(contact_points)

    results = [_trace_tamps(i, t, traces, plugs, points, end_offset) for i, t in enumerate(traces)]
    for trace, (tamps, intersections) in zip(traces, results):
        _set_tamps(trace, tamps)
        trace["_intersections"] = intersections

    for index in auto_place:
        part = parts[index]
        if part.get("type") not in TRACE_TYPES:
            continue
        model = Line(Vec.of(part["line_from"]), Vec.of(part["line_to"]))
        p = model.a + model.unit() * safe_pick_distance(part, part["_intersections"])
        part["place"] = {"x": p.x, "y": p.y, "z": p.z}

    for trace in traces:
        trace.pop("_intersections", None)
    return out


# --- Python twin of web/app/src/model/contactPoints.ts -----------------------------


def _same_xy(a: dict, b: dict) -> bool:
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"]) <= CONTACT_MERGE_TOL_MM


def _merge(into: dict, nxt: dict) -> None:
    prinjection = into if into["origin"] == "prinjection" else nxt if nxt["origin"] == "prinjection" else None
    tamp = into if into["origin"] == "tamp3" else nxt if nxt["origin"] == "tamp3" else None
    if prinjection is not None and tamp is not None:
        overrides = {**prinjection.get("overrides", {}), **tamp.get("overrides", {})}
    else:
        overrides = {**into.get("overrides", {}), **nxt.get("overrides", {})}
    if nxt["z"] < into["z"]:
        into["x"], into["y"], into["z"] = nxt["x"], nxt["y"], nxt["z"]
        into["origin"] = nxt["origin"]
    if overrides:
        into["overrides"] = overrides
    else:
        into.pop("overrides", None)


def _candidate(p: dict, origin: str) -> dict:
    c = {"x": p["x"], "y": p["y"], "z": p["z"], "origin": origin}
    if p.get("overrides"):
        c["overrides"] = dict(p["overrides"])
    return c


def derive_contact_points(spec: dict) -> list[dict]:
    """Prinjection points first (Spec order), then type-3 tamps, merged by XY."""
    candidates: list[dict] = []
    for part in spec.get("parts", []):
        if part.get("type") in ("pcb", "print") and part.get("prinjection"):
            candidates.extend(_candidate(p, "prinjection") for p in part["prinjection"])
    for part in spec.get("parts", []):
        for t in part.get("tamps") or []:
            if t.get("type") == TAMP_TRACE_PCB:
                candidates.append(_candidate(t, "tamp3"))
    out: list[dict] = []
    for c in candidates:
        hit = next((p for p in out if _same_xy(p, c)), None)
        if hit is not None:
            _merge(hit, c)
        else:
            out.append(c)
    return out


def prinjection_contact_points(spec: dict) -> list[dict]:
    """Contact points from prinjection points only (the non-circular golden input)."""
    return [
        _candidate(p, "prinjection")
        for part in spec.get("parts", [])
        if part.get("type") in ("pcb", "print")
        for p in part.get("prinjection") or []
    ]
