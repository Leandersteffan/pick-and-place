"""Required golden test: the schema accepts the Fixture (task 3.4).

Checks that spec.v1.schema.json declares draft 2020-12, that both Fixture specs
(the Pipeline write-back spec.json and the export stand-in spec.export.json) are
valid, and that every key the Grasshopper exporter writes appears in the schema.
"""

import json
import re

import pytest
from jsonschema import Draft202012Validator

from pnp_server.validation import validate_spec

EXPORTER = "Scripts/Py3-261103_1b2fe.py"
PART_BRANCHES = ("tracePart", "plugPart", "componentPart")


@pytest.fixture(scope="module")
def schema(schema_path):
    return json.loads(schema_path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def exporter_text(designer_dir):
    return (designer_dir / EXPORTER).read_text(encoding="utf-8")


def _function_body(text, name):
    start = text.index("\ndef {0}(".format(name))
    end = text.find("\ndef ", start + 1)
    return text[start:] if end == -1 else text[start:end]


def part_record_keys(text):
    """Keys of the record dict in _part_record, plus record["mesh"] from process_print."""
    body = _function_body(text, "_part_record")
    literal = re.search(r"record\s*=\s*\{(.*?)\}", body, re.S)
    keys = set(re.findall(r'"(\w+)"\s*:', literal.group(1)))
    keys |= set(re.findall(r'record\["(\w+)"\]\s*=', body))
    keys |= set(re.findall(r'record\["(\w+)"\]\s*=', _function_body(text, "process_print")))
    return keys


def top_level_keys(text):
    """Keys of the spec dict literal in process_print (line-start keys only, so nested dicts are skipped)."""
    body = _function_body(text, "process_print")
    literal = re.search(r"\n\s*spec\s*=\s*\{\n(.*?)\n\s*\}\n", body, re.S)
    return set(re.findall(r'^\s*"(\w+)"\s*:', literal.group(1), re.M))


def test_schema_declares_draft_2020_12(schema):
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize("name", ["spec.json", "spec.export.json"])
def test_fixture_specs_are_valid(fixture_dir, schema, name):
    spec = json.loads((fixture_dir / name).read_text(encoding="utf-8"))
    assert validate_spec(spec) == {"valid": True, "errors": []}
    assert list(Draft202012Validator(schema).iter_errors(spec)) == []


def test_extraction_finds_the_exporter_keys(exporter_text):
    # Guards the regexes: if the exporter changes shape, the coverage test must not pass on an empty set.
    keys = part_record_keys(exporter_text)
    assert {"type", "place", "pick", "pause_layer", "length", "radius", "size", "tray_offset", "mesh"} <= keys
    assert top_level_keys(exporter_text) >= {"version", "parts"}


def test_every_part_record_key_is_in_a_part_branch(schema, exporter_text):
    known = set()
    for branch in PART_BRANCHES:
        known |= set(schema["$defs"][branch]["properties"])
    missing = sorted(part_record_keys(exporter_text) - known)
    assert missing == []


def test_mesh_belongs_to_the_component_branch(schema):
    assert "mesh" in schema["$defs"]["componentPart"]["properties"]


def test_every_top_level_key_is_in_the_schema(schema, exporter_text):
    keys = top_level_keys(exporter_text)
    assert sorted(keys - set(schema["properties"])) == []
    # Grasshopper always writes these, so the schema requires exactly them.
    assert set(schema["required"]) == keys
