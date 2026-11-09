"""Spec_Schema validation (jsonschema, draft 2020-12) and POST /api/validate.

Errors are leaf errors with RFC 6901 pointers, sorted by pointer then keyword.
For a failed `oneOf` on a part, only the branch whose `type` enum contains the
part's `type` is reported, which is what ajv's discriminator reports in the browser.
"""

import json
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from jsonschema import Draft202012Validator

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schema" / "spec.v1.schema.json"  # pnp_server -> server -> web
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
Draft202012Validator.check_schema(SCHEMA)
VALIDATOR = Draft202012Validator(SCHEMA)

router = APIRouter()


def _pointer(path):
    """RFC 6901 pointer from a jsonschema path (deque of keys and indices). Root is ''."""
    return "".join("/" + str(token).replace("~", "~0").replace("/", "~1") for token in path)


def _resolve(schema):
    """Follow a local '#/...' $ref inside SCHEMA. Other schemas come back unchanged."""
    ref = schema.get("$ref") if isinstance(schema, dict) else None
    if not isinstance(ref, str) or not ref.startswith("#/"):
        return schema
    node = SCHEMA
    for token in ref[2:].split("/"):
        node = node[token.replace("~1", "/").replace("~0", "~")]
    return node


def _branch_types(branch):
    """The `type` enum (or const) a oneOf branch accepts, or None if it has none."""
    prop = _resolve(branch).get("properties", {}).get("type", {})
    if "enum" in prop:
        return list(prop["enum"])
    if "const" in prop:
        return [prop["const"]]
    return None


def _leaf_errors(error):
    if not error.context:
        return [error]
    if error.validator == "oneOf":
        return _one_of_leaves(error)
    leaves = []
    for sub in error.context:
        leaves.extend(_leaf_errors(sub))
    return leaves


def _one_of_leaves(error):
    instance = error.instance
    branches = error.validator_value
    if not isinstance(instance, dict) or "type" not in instance:
        # The item's own "type": "object" or "required": ["type"] already reports this.
        return []
    part_type = instance["type"]
    allowed = []
    for index, branch in enumerate(branches):
        types = _branch_types(branch)
        if types is None:
            continue
        allowed.extend(types)
        if part_type in types:
            leaves = []
            for sub in error.context:
                if sub.relative_schema_path and sub.relative_schema_path[0] == index:
                    leaves.extend(_leaf_errors(sub))
            return leaves or [error]
    return [_TypeEnumError(error, allowed)]


class _TypeEnumError:
    """Stand-in leaf for a part whose `type` matches no oneOf branch."""

    validator = "enum"

    def __init__(self, parent, allowed):
        self.absolute_path = list(parent.absolute_path) + ["type"]
        self.message = f"{parent.instance['type']!r} is not one of {allowed!r}"


def validate_spec(spec):
    """{'valid': bool, 'errors': [{'pointer': str, 'message': str, 'keyword': str}]}"""
    errors = []
    for error in VALIDATOR.iter_errors(spec):
        for leaf in _leaf_errors(error):
            errors.append({"pointer": _pointer(leaf.absolute_path), "message": leaf.message, "keyword": leaf.validator})
    errors.sort(key=lambda e: (e["pointer"], e["keyword"]))
    return {"valid": not errors, "errors": errors}


@router.post("/api/validate")
async def validate(request: Request):
    raw = await request.body()
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return JSONResponse(status_code=400, content={"detail": "request body is not JSON"})
    if not isinstance(body, dict) or "spec" not in body:
        return JSONResponse(status_code=400, content={"detail": "request body must be a JSON object with a 'spec' field"})
    return validate_spec(body["spec"])
