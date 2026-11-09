"""POST /api/slice: multipart upload of a Spec and its meshes, run through the unchanged pipeline.

Fields: `spec` (JSON text), `options` (JSON text, optional), `housing` (one file), `meshes` (repeated files).
Errors: 400 bad fields, names, sizes or a file set that does not match the Spec; 409 busy;
422 { stage: "validate", errors }; 500 { stage, message, log_tail } (no tracebacks).
"""

import base64
import json
import logging
import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from pnp_server import bridge, intersections_api
from pnp_server.validation import validate_spec

log = logging.getLogger(__name__)

router = APIRouter()

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
HOUSING_NAME = re.compile(r"^housing\.(3mf|stl)$")
MESH_NAME = re.compile(r"^part-\d+\.stl$")
MESH_TYPES = ("pcb", "print")
CHUNK = 1024 * 1024


class BadRequest(Exception):
    """Turns into HTTP 400 with `detail` naming the field."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field = field
        self.message = message


def _bad(error):
    return JSONResponse(status_code=400, content={"detail": error.message, "field": error.field})


def _json_field(form, field, required):
    value = form.get(field)
    if value is None:
        if required:
            raise BadRequest(field, "missing field '{0}'".format(field))
        return {}
    if not isinstance(value, str):
        raise BadRequest(field, "field '{0}' must be JSON text, not a file".format(field))
    try:
        parsed = json.loads(value)
    except ValueError:
        raise BadRequest(field, "field '{0}' is not valid JSON".format(field)) from None
    if not isinstance(parsed, dict):
        raise BadRequest(field, "field '{0}' must be a JSON object".format(field))
    return parsed


async def _read_upload(upload, field):
    """Bytes of one upload, refusing anything above MAX_UPLOAD_BYTES."""
    chunks = []
    total = 0
    while True:
        chunk = await upload.read(CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise BadRequest(field, "file '{0}' is larger than 50 MB".format(upload.filename))
        chunks.append(chunk)
    return b"".join(chunks)


async def _collect_files(form):
    """{name: bytes} for the housing and the meshes, with names checked against the whitelist."""
    housings = form.getlist("housing")
    if len(housings) != 1 or not isinstance(housings[0], UploadFile):
        raise BadRequest("housing", "field 'housing' must be exactly one file")
    housing = housings[0]
    if not HOUSING_NAME.match(housing.filename or ""):
        raise BadRequest("housing", "housing file name {0!r} must match housing.3mf or housing.stl".format(housing.filename))
    files = {housing.filename: await _read_upload(housing, "housing")}
    meshes = []
    for upload in form.getlist("meshes"):
        if not isinstance(upload, UploadFile):
            raise BadRequest("meshes", "field 'meshes' must contain files only")
        name = upload.filename or ""
        if not MESH_NAME.match(name):
            raise BadRequest("meshes", "mesh file name {0!r} must match part-N.stl".format(name))
        if name in files:
            raise BadRequest("meshes", "mesh file {0!r} was uploaded twice".format(name))
        files[name] = await _read_upload(upload, "meshes")
        meshes.append(name)
    unknown = set(form.keys()) - {"spec", "options", "housing", "meshes"}
    if unknown:
        raise BadRequest(sorted(unknown)[0], "unknown field(s): {0}".format(", ".join(sorted(unknown))))
    return housing.filename, meshes, files


def _match_spec(spec, housing_name, mesh_names):
    """The uploaded file set must equal what the Spec names."""
    if spec.get("housing") != housing_name:
        raise BadRequest("housing", "housing file {0!r} does not match spec.housing {1!r}".format(housing_name, spec.get("housing")))
    expected = set()
    for index, part in enumerate(spec.get("parts", [])):
        if part.get("type") not in MESH_TYPES:
            continue
        mesh = part.get("mesh")
        if not isinstance(mesh, str) or not MESH_NAME.match(mesh):
            raise BadRequest("spec", "parts[{0}].mesh {1!r} must be a part-N.stl name".format(index, mesh))
        expected.add(mesh)
    uploaded = set(mesh_names)
    missing = sorted(expected - uploaded)
    extra = sorted(uploaded - expected)
    if missing:
        raise BadRequest("meshes", "missing mesh file(s): {0}".format(", ".join(missing)))
    if extra:
        raise BadRequest("meshes", "mesh file(s) not named by the spec: {0}".format(", ".join(extra)))


def _response(result, intersections):
    return {
        "gcode": result.gcode,
        "tray_stl_b64": base64.b64encode(result.tray_stl).decode("ascii"),
        "spec": result.spec,
        "offsets": result.offsets,
        "intersections": intersections,
        "pipeline_version": result.pipeline_version,
        "duration_s": result.duration_s,
        "log_tail": list(result.log_tail),
    }


@router.post("/api/slice")
async def slice_endpoint(request: Request):
    try:
        form = await request.form()
    except Exception as error:  # not multipart, or a malformed body
        return JSONResponse(status_code=400, content={"detail": "request must be multipart/form-data: {0}".format(error)})
    try:
        try:
            spec = _json_field(form, "spec", required=True)
            options = _json_field(form, "options", required=False)
            housing_name, mesh_names, files = await _collect_files(form)
        except BadRequest as error:
            return _bad(error)
        if "recompute_tamps" in options and not isinstance(options["recompute_tamps"], bool):
            return _bad(BadRequest("options", "options.recompute_tamps must be true or false"))

        verdict = validate_spec(spec)
        if not verdict["valid"]:
            return JSONResponse(status_code=422, content={"stage": "validate", "errors": verdict["errors"]})
        try:
            _match_spec(spec, housing_name, mesh_names)
        except BadRequest as error:
            return _bad(error)

        # Intersection_Port: after the schema check, before slice_project (Requirement 13.1).
        intersections = {"ran": False, "changed_parts": []}
        if options.get("recompute_tamps") and intersections_api.has_traces(spec):
            try:
                points, auto_place = intersections_api.parse_options(spec, options)
            except intersections_api.OptionsError as error:
                return _bad(BadRequest("options", "options.{0}".format(error)))
            try:
                spec, report = intersections_api.run_port(spec, points, auto_place)
            except Exception as error:  # PortUnavailable or a port bug; no traceback to the client
                log.exception("Intersection_Port failed")
                return JSONResponse(
                    status_code=500,
                    content={"stage": "intersections", "message": str(error) or type(error).__name__, "log_tail": []},
                )
            intersections = {"ran": True, "changed_parts": report["changed_parts"]}

        if bridge.is_busy():
            return JSONResponse(status_code=409, content={"detail": "A slice is already running."})
        try:
            result = await run_in_threadpool(bridge.slice_project, spec, files)
        except bridge.SliceBusy:
            return JSONResponse(status_code=409, content={"detail": "A slice is already running."})
        except bridge.SliceFailed as error:
            return JSONResponse(
                status_code=500,
                content={"stage": error.stage, "message": error.message, "log_tail": error.log_tail},
            )
        except Exception as error:  # never leak a traceback to the client
            log.exception("Unexpected slice error")
            return JSONResponse(
                status_code=500,
                content={"stage": "server", "message": str(error) or type(error).__name__, "log_tail": []},
            )
        return _response(result, intersections)
    finally:
        await form.close()
