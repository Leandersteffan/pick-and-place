"""The Intersection_Port over HTTP: POST /api/intersections, and the helper /api/slice uses.

Request options (both endpoints):
  contact_points: [{x, y, z, overrides?}]  default derive_contact_points(spec)
  auto_place:     [part index]              default []
"""

import json
import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from pnp_server.validation import validate_spec

log = logging.getLogger(__name__)

router = APIRouter()

TRACE_TYPES = ("trace_braid", "trace_cloth")

try:
    from pnp_server import intersections as _port
    IMPORT_ERROR = None
except Exception as error:  # noqa: BLE001  (reported through /api/health, never raised)
    _port = None
    IMPORT_ERROR = "{0}: {1}".format(type(error).__name__, error)


class OptionsError(Exception):
    """Bad contact_points or auto_place. Turns into HTTP 400."""


class PortUnavailable(Exception):
    """The port failed to import or PNP_DISABLE_INTERSECTIONS=1."""


def available(environ=os.environ):
    return _port is not None and environ.get("PNP_DISABLE_INTERSECTIONS") != "1"


def has_traces(spec):
    return any(isinstance(p, dict) and p.get("type") in TRACE_TYPES for p in spec.get("parts", []))


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def parse_options(spec, options):
    """(contact_points or None, auto_place) from a request; raises OptionsError."""
    points = options.get("contact_points")
    if points is not None:
        if not isinstance(points, list):
            raise OptionsError("contact_points must be a list")
        for i, p in enumerate(points):
            if not isinstance(p, dict) or not all(_number(p.get(k)) for k in ("x", "y", "z")):
                raise OptionsError("contact_points[{0}] must have numeric x, y and z".format(i))
            if "overrides" in p and not isinstance(p["overrides"], dict):
                raise OptionsError("contact_points[{0}].overrides must be an object".format(i))
    auto_place = options.get("auto_place", [])
    if auto_place is None:
        auto_place = []
    if not isinstance(auto_place, list):
        raise OptionsError("auto_place must be a list of part indices")
    count = len(spec.get("parts", []))
    for value in auto_place:
        if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value < count:
            raise OptionsError("auto_place entry {0!r} is not a part index".format(value))
    return points, auto_place


def _tamp_count(spec):
    return sum(len(p.get("tamps") or []) for p in spec.get("parts", []))


def changed_parts(before, after):
    """Indices of parts whose tamps or place differ."""
    out = []
    for index, (a, b) in enumerate(zip(before.get("parts", []), after.get("parts", []))):
        if a.get("tamps") != b.get("tamps") or a.get("place") != b.get("place"):
            out.append(index)
    return out


def run_port(spec, contact_points, auto_place):
    """(new spec, report). The input spec is not changed."""
    if not available():
        raise PortUnavailable(IMPORT_ERROR or "the Intersection_Port is disabled (PNP_DISABLE_INTERSECTIONS=1)")
    if contact_points is None:
        contact_points = _port.derive_contact_points(spec)
    new_spec = _port.recompute_tamps(spec, contact_points, auto_place)
    report = {
        "changed_parts": changed_parts(spec, new_spec),
        "tamps_before": _tamp_count(spec),
        "tamps_after": _tamp_count(new_spec),
    }
    return new_spec, report


@router.post("/api/intersections")
async def intersections_endpoint(request: Request):
    raw = await request.body()
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return JSONResponse(status_code=400, content={"detail": "request body is not JSON"})
    if not isinstance(body, dict) or not isinstance(body.get("spec"), dict):
        return JSONResponse(status_code=400, content={"detail": "request body must be a JSON object with a 'spec' object"})
    spec = body["spec"]
    verdict = validate_spec(spec)
    if not verdict["valid"]:
        return JSONResponse(status_code=422, content={"stage": "validate", "errors": verdict["errors"]})
    try:
        points, auto_place = parse_options(spec, body)
    except OptionsError as error:
        return JSONResponse(status_code=400, content={"detail": str(error), "field": "options"})
    try:
        new_spec, report = run_port(spec, points, auto_place)
    except PortUnavailable as error:
        return JSONResponse(status_code=503, content={"stage": "intersections", "message": str(error)})
    except Exception as error:  # never leak a traceback to the client
        log.exception("Intersection_Port failed")
        return JSONResponse(
            status_code=500,
            content={"stage": "intersections", "message": str(error) or type(error).__name__, "log_tail": []},
        )
    return {"spec": new_spec, "report": report}
