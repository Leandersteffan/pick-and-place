"""Required schema agreement test (task 3.6).

Feature: pick-and-place-web-frontend, Property 23: Browser and backend validators agree

Every Spec in the shared test set (web/schema/testset, written by
web/schema/tools/gen_testset.py) gets the verdict recorded in expected.json from
validate_spec, and every reported error pointer (RFC 6901) resolves in the Spec
or, for a missing key, in its parent. The Vitest twin is
web/app/src/schema/schemaAgreement.test.ts.

Validates: Requirements 3.2, 3.5, 2.4, 2.5
"""

import json
from pathlib import Path

import pytest

from pnp_server.validation import validate_spec

_MISSING = object()


@pytest.fixture(scope="module")
def testset_dir(schema_path):
    return schema_path.parent / "testset"


def _expected(schema_dir):
    return json.loads((schema_dir / "testset" / "expected.json").read_text(encoding="utf-8"))


def _tokens(pointer):
    assert pointer == "" or pointer.startswith("/"), pointer
    if pointer == "":
        return []
    return [t.replace("~1", "/").replace("~0", "~") for t in pointer[1:].split("/")]


def _lookup(doc, tokens):
    node = doc
    for token in tokens:
        if isinstance(node, dict):
            if token not in node:
                return _MISSING
            node = node[token]
        elif isinstance(node, list):
            if not token.isdigit() or (len(token) > 1 and token[0] == "0") or int(token) >= len(node):
                return _MISSING
            node = node[int(token)]
        else:
            return _MISSING
    return node


def resolves_in_spec_or_parent(doc, pointer):
    tokens = _tokens(pointer)
    if _lookup(doc, tokens) is not _MISSING:
        return True
    return bool(tokens) and _lookup(doc, tokens[:-1]) is not _MISSING


def test_testset_is_complete(testset_dir):
    expected = _expected(testset_dir.parent)
    on_disk = {f"{p.parent.name}/{p.name}" for sub in ("valid", "invalid") for p in (testset_dir / sub).glob("*.json")}
    assert set(expected) == on_disk
    assert sum(expected.values()) >= 100 and sum(not v for v in expected.values()) >= 100
    for name, verdict in expected.items():
        assert verdict is name.startswith("valid/")


def _cases():
    schema_dir = Path(__file__).resolve().parents[2] / "schema"  # tests -> server -> web
    return sorted(_expected(schema_dir).items())


@pytest.mark.parametrize("name,verdict", _cases())
def test_verdict_matches_expected(testset_dir, name, verdict):
    spec = json.loads((testset_dir / name).read_text(encoding="utf-8"))
    result = validate_spec(spec)
    assert result["valid"] is verdict, result["errors"][:3]
    if verdict:
        assert result["errors"] == []
    else:
        assert result["errors"], "an invalid Spec must report at least one error"
    for error in result["errors"]:
        assert resolves_in_spec_or_parent(spec, error["pointer"]), error
