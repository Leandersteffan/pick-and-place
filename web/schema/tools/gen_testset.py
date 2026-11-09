"""Generate the shared schema test set (Property 23).

Writes 150 valid and 150 invalid Specs into ``web/schema/testset/valid/`` and
``web/schema/testset/invalid/`` with ``json.dump(indent=2)``, and the verdict per
file into ``web/schema/testset/expected.json``. Vitest (ajv) and pytest
(jsonschema) both read these files and compare against ``expected.json``.

The valid Specs start from the demo Fixture (``web/fixtures/demo-v1/spec.json`` and
``spec.export.json``) and then vary numbers, part counts, part types, and which
optional and write-back fields are present. Each invalid Spec is a valid Spec with
one mutation that makes it invalid by construction: a removed required field, a
wrong JSON type, an unknown key, a broken enum (or const or pattern), or a
non-integer ``pause_layer``.

Values that the two validators could read differently are avoided: no NaN or
Infinity, no integers above a few hundred, and no float-valued integers such as
``3.0`` in integer fields.

After writing, every file is read back and checked with
``jsonschema.Draft202012Validator`` against ``web/schema/spec.v1.schema.json``.
The script exits with status 1 if any verdict disagrees.

The output is deterministic: running the script twice gives identical bytes.

Run from anywhere::

    py -3 web/schema/tools/gen_testset.py
"""

from __future__ import annotations

import copy
import json
import random
import sys
from pathlib import Path

SEED = 20261110
N_VALID = 150
N_INVALID = 150

TOOLS_DIR = Path(__file__).resolve().parent
SCHEMA_DIR = TOOLS_DIR.parent
SCHEMA_PATH = SCHEMA_DIR / "spec.v1.schema.json"
TESTSET_DIR = SCHEMA_DIR / "testset"
FIXTURE_DIR = SCHEMA_DIR.parent / "fixtures" / "demo-v1"

PRINTERS = ("snapmaker u1", "prusa xl", "mini", "prusa mini", "xl", "snapmaker u1 (0.4 nozzle)")
OVERRIDE_KEYS = (
    "nozzle_temperature",
    "first_layer_speed",
    "fan_speed",
    "note",
    "retract_length",
    "wall_loops",
)
NAMES = ("LED", "trace A", "trace B", "battery clip", "switch", "Ü-plug", "insert 1", "")

# Required keys as the schema lists them. The mutations remove one of these.
TOP_REQUIRED = ("version", "printer", "use_trace_braid", "housing", "tray", "tray_spacing", "tray_origin", "parts")
TRACE_REQUIRED = ("type", "place", "pause_layer", "length", "width", "height", "horizontal", "line_from", "line_to")
PLUG_REQUIRED = ("type", "place", "pause_layer", "radius", "height")
COMPONENT_REQUIRED = ("type", "place", "pause_layer", "size", "bbox_center", "bbox_min", "tray_offset", "mesh")

TRACE_KEYS = set(TRACE_REQUIRED) | {"pick", "tamps", "overrides", "name", "slot"}
PLUG_KEYS = set(PLUG_REQUIRED) | {"pick", "tamps", "overrides", "name", "slot", "slot_shape"}
COMPONENT_KEYS = set(COMPONENT_REQUIRED) | {
    "pick", "tamps", "prinjection", "overrides", "name", "slot", "pocket", "pocket_depth",
}


def part_kind(part: dict) -> str:
    t = part.get("type")
    if t in ("trace_cloth", "trace_braid"):
        return "trace"
    if t == "plug":
        return "plug"
    return "component"


def required_for(part: dict) -> tuple:
    return {"trace": TRACE_REQUIRED, "plug": PLUG_REQUIRED, "component": COMPONENT_REQUIRED}[part_kind(part)]


def allowed_for(part: dict) -> set:
    return {"trace": TRACE_KEYS, "plug": PLUG_KEYS, "component": COMPONENT_KEYS}[part_kind(part)]


# --------------------------------------------------------------------------- numbers


class Gen:
    """Random value helpers on one seeded stream."""

    def __init__(self, rng: random.Random) -> None:
        self.rng = rng

    def num(self, lo: float, hi: float) -> float:
        """A finite float in [lo, hi], rounded to a random number of decimals."""
        value = self.rng.uniform(lo, hi)
        digits = self.rng.choice((1, 2, 3, 4, 6, 10, 15))
        value = round(value, digits)
        if value == 0:
            value = 0.0  # never write -0.0
        return float(value)

    def pos(self, lo: float, hi: float) -> float:
        """A float > 0 (lo must be at least 0.1 so rounding keeps it positive)."""
        return max(self.num(lo, hi), lo)

    def vec3(self, xy=(-20.0, 280.0), z=(0.0, 40.0)) -> dict:
        return {"x": self.num(*xy), "y": self.num(*xy), "z": self.num(*z)}

    def rect(self) -> dict:
        x0 = self.num(0.0, 200.0)
        y0 = self.num(0.0, 100.0)
        return {"x0": x0, "y0": y0, "x1": round(x0 + self.pos(0.5, 60.0), 6), "y1": round(y0 + self.pos(0.5, 60.0), 6)}

    def chance(self, p: float) -> bool:
        return self.rng.random() < p

    def overrides(self) -> dict:
        out = {}
        if self.chance(0.4):
            if self.chance(0.5):
                out["tray_rotation"] = self.num(-180.0, 180.0)
            else:
                out["tray_rotation"] = str(self.rng.choice((0, 45, 90, -90, 180, 12.5)))
        for key in self.rng.sample(OVERRIDE_KEYS, self.rng.randint(0, 3)):
            kind = self.rng.choice(("string", "number", "int", "bool", "null"))
            if kind == "string":
                out[key] = str(self.rng.choice(("210", "0.8", "on", "fast", "")))
            elif kind == "number":
                out[key] = self.num(0.0, 300.0)
            elif kind == "int":
                out[key] = self.rng.randint(0, 300)
            elif kind == "bool":
                out[key] = self.rng.random() < 0.5
            else:
                out[key] = None
        if not out:
            out["note"] = "default"
        return out


# --------------------------------------------------------------------------- valid parts


def make_tamps(g: Gen) -> list:
    tamps = []
    for _ in range(g.rng.randint(0, 4)):
        tamp = g.vec3(z=(-3.0, 30.0))  # negative Z must pass
        tamp["type"] = g.rng.randint(0, 3)
        if g.chance(0.15):
            tamp["overrides"] = g.overrides()
        tamps.append(tamp)
    return tamps


def write_back(g: Gen, mode: str) -> bool:
    if mode == "export":
        return False
    if mode == "pipeline":
        return True
    return g.chance(0.5)


def add_common_optional(g: Gen, part: dict) -> None:
    if g.chance(0.25):
        part["overrides"] = g.overrides()
    if g.chance(0.3):
        part["name"] = g.rng.choice(NAMES)


def make_trace(g: Gen, ttype: str, mode: str) -> dict:
    horizontal = g.chance(0.5)
    length = g.pos(1.0, 90.0)
    width = 2.8 if g.chance(0.6) else g.pos(0.5, 6.0)
    height = 0.2 if g.chance(0.6) else g.pos(0.1, 2.0)
    place = g.vec3()
    half = round(length / 2.0, 6)
    line_from = dict(place)
    line_to = dict(place)
    axis = "x" if horizontal else "y"
    line_from[axis] = round(place[axis] - half, 6)
    line_to[axis] = round(place[axis] + half, 6)
    part = {"type": ttype, "place": place}
    if write_back(g, mode) or g.chance(0.5):
        part["pick"] = g.vec3(xy=(0.0, 200.0), z=(-1.0, 5.0))
    part["pause_layer"] = g.rng.randint(1, 400)
    part["length"] = length
    part["width"] = width
    part["height"] = height
    part["horizontal"] = horizontal
    part["line_from"] = line_from
    part["line_to"] = line_to
    if g.chance(0.7):
        part["tamps"] = make_tamps(g)
    add_common_optional(g, part)
    if write_back(g, mode):
        part["slot"] = g.rect()
    return part


def make_plug(g: Gen, mode: str) -> dict:
    part = {"type": "plug", "place": g.vec3()}
    if write_back(g, mode) or g.chance(0.5):
        part["pick"] = g.vec3(xy=(0.0, 200.0), z=(0.0, 10.0))
    part["pause_layer"] = g.rng.randint(1, 400)
    part["radius"] = g.pos(0.5, 8.0)
    part["height"] = g.pos(0.2, 12.0)
    if g.chance(0.2):
        part["tamps"] = make_tamps(g)
    add_common_optional(g, part)
    if write_back(g, mode):
        part["slot"] = g.rect()
        if g.chance(0.8):
            part["slot_shape"] = "circle"
    return part


def make_component(g: Gen, ctype: str, index: int, mode: str) -> dict:
    size = {"x": g.pos(0.5, 60.0), "y": g.pos(0.5, 60.0), "z": g.pos(0.2, 20.0)}
    center = g.vec3(z=(0.0, 20.0))
    bbox_min = {
        "x": round(center["x"] - size["x"] / 2.0, 6),
        "y": round(center["y"] - size["y"] / 2.0, 6),
        "z": round(center["z"] - size["z"] / 2.0, 6),
    }
    part = {"type": ctype, "place": g.vec3()}
    if write_back(g, mode) or g.chance(0.5):
        part["pick"] = g.vec3(xy=(0.0, 200.0), z=(0.0, 25.0))
    part["pause_layer"] = g.rng.randint(1, 400)
    part["size"] = size
    part["bbox_center"] = center
    part["bbox_min"] = bbox_min
    part["tray_offset"] = 2.0 if g.chance(0.6) else g.num(0.0, 5.0)
    if (ctype == "pcb" and g.chance(0.7)) or (ctype == "print" and g.chance(0.1)):
        holes = []
        for _ in range(g.rng.randint(0, 4)):
            hole = g.vec3()
            if g.chance(0.15):
                hole["overrides"] = g.overrides()
            holes.append(hole)
        part["prinjection"] = holes
    part["mesh"] = f"part-{index}.stl"
    if g.chance(0.15):
        part["tamps"] = make_tamps(g)
    add_common_optional(g, part)
    if write_back(g, mode):
        part["slot"] = g.rect()
    if write_back(g, mode):
        part["pocket"] = g.rect()
    if write_back(g, mode):
        part["pocket_depth"] = g.pos(0.4, 20.0)
    return part


def make_valid(g: Gen, base: dict) -> dict:
    """A valid Spec: the Fixture's top level with randomized values and parts."""
    spec = copy.deepcopy(base)
    spec["version"] = 1
    spec["printer"] = g.rng.choice(PRINTERS)
    spec["use_trace_braid"] = g.chance(0.5)
    spec["housing"] = "housing.3mf" if g.chance(0.75) else "housing.stl"
    spec["tray"] = "generated"
    spec["tray_spacing"] = 3.0 if g.chance(0.6) else g.pos(0.5, 10.0)
    spec["tray_origin"] = {"x": 0.0, "y": 0.0, "z": 0.0} if g.chance(0.7) else g.vec3(z=(0.0, 0.0))
    mode = g.rng.choice(("export", "pipeline", "mixed"))
    trace_type = "trace_braid" if spec["use_trace_braid"] else "trace_cloth"
    if g.chance(0.1):  # a trace type that disagrees with the braid flag is still schema-valid
        trace_type = "trace_cloth" if trace_type == "trace_braid" else "trace_braid"
    parts = []
    for index in range(g.rng.randint(1, 9)):
        kind = g.rng.choice(("trace", "trace", "trace", "plug", "pcb", "print"))
        if kind == "trace":
            parts.append(make_trace(g, trace_type, mode))
        elif kind == "plug":
            parts.append(make_plug(g, mode))
        else:
            parts.append(make_component(g, kind, index, mode))
    spec["parts"] = parts
    return spec


# --------------------------------------------------------------------------- mutations


def _vec_targets(spec: dict) -> list:
    """Every closed vec3 or rect object in the Spec, as (object, required keys)."""
    out = [(spec["tray_origin"], ("x", "y", "z"))]
    for part in spec["parts"]:
        for key in ("place", "pick", "line_from", "line_to", "size", "bbox_center", "bbox_min"):
            if isinstance(part.get(key), dict):
                out.append((part[key], ("x", "y", "z")))
        for key in ("slot", "pocket"):
            if isinstance(part.get(key), dict):
                out.append((part[key], ("x0", "y0", "x1", "y1")))
        for tamp in part.get("tamps", []):
            out.append((tamp, ("x", "y", "z", "type")))
        for hole in part.get("prinjection", []):
            out.append((hole, ("x", "y", "z")))
    return out


def _carries_overrides(spec: dict, obj: dict) -> bool:
    """True for tamp and prinjection objects, whose schema allows an overrides key."""
    for part in spec["parts"]:
        for item in part.get("tamps", []) + part.get("prinjection", []):
            if item is obj:
                return True
    return False


def mutate_remove_required(g: Gen, spec: dict) -> None:
    where = g.rng.choice(("top", "part", "part", "nested"))
    if where == "top":
        del spec[g.rng.choice(TOP_REQUIRED)]
    elif where == "part":
        part = g.rng.choice(spec["parts"])
        del part[g.rng.choice(required_for(part))]
    else:
        obj, keys = g.rng.choice(_vec_targets(spec))
        del obj[g.rng.choice(keys)]


NOT_NUMBER = ("1.5", None, [1.5], {"value": 1.5}, True)
NOT_INTEGER = ("1", None, [1], {"value": 1}, False)
NOT_STRING = (3, None, [], {"name": "x"}, True)
NOT_BOOLEAN = (0, 1, "true", None, [])
NOT_OBJECT = ([0.0, 0.0, 0.0], "0,0,0", 0, None)
NOT_ARRAY = ({}, "[]", 0, None)


def mutate_wrong_type(g: Gen, spec: dict) -> None:
    targets = [
        (spec, "version", NOT_INTEGER),
        (spec, "printer", NOT_STRING),
        (spec, "use_trace_braid", NOT_BOOLEAN),
        (spec, "housing", NOT_STRING),
        (spec, "tray", NOT_STRING),
        (spec, "tray_spacing", NOT_NUMBER),
        (spec, "tray_origin", NOT_OBJECT),
        (spec, "parts", NOT_ARRAY),
    ]
    for part in spec["parts"]:
        for key, value in part.items():
            if key in ("type", "name", "mesh", "slot_shape"):
                bad = NOT_STRING
            elif key == "pause_layer":
                bad = NOT_INTEGER
            elif key == "horizontal":
                bad = NOT_BOOLEAN
            elif key in ("tamps", "prinjection"):
                bad = NOT_ARRAY
            elif key == "overrides":
                continue  # the overrides definition has no "type": "object"
            elif isinstance(value, dict):
                bad = NOT_OBJECT
            else:
                bad = NOT_NUMBER
            targets.append((part, key, bad))
        for tamp in part.get("tamps", []):
            targets.append((tamp, g.rng.choice(("x", "y", "z")), NOT_NUMBER))
            targets.append((tamp, "type", NOT_INTEGER))
        for item_list in ("tamps", "prinjection"):
            items = part.get(item_list, [])
            if items:
                targets.append((items, g.rng.randrange(len(items)), NOT_OBJECT))
        if isinstance(part.get("overrides"), dict):
            # Values must be string, number, boolean or null; tray_rotation number or string.
            targets.append((part["overrides"], "tray_rotation", ([90], {"deg": 90}, True, None)))
            targets.append((part["overrides"], "note", ([1], {"a": 1})))
    for obj, keys in _vec_targets(spec):
        targets.append((obj, g.rng.choice(keys[:3]), NOT_NUMBER))
    container, key, bad = g.rng.choice(targets)
    container[key] = copy.deepcopy(g.rng.choice(bad))


UNKNOWN_KEYS = ("colour", "Type", "pauseLayer", "extra", "z2", "PickPt", "comment", "id")


def mutate_unknown_key(g: Gen, spec: dict) -> None:
    where = g.rng.choice(("top", "part", "part", "nested"))
    value = copy.deepcopy(g.rng.choice((1, "x", True, None, {}, [], 2.5)))
    if where == "top":
        key = g.rng.choice(UNKNOWN_KEYS + ("tray_rotation", "mesh", "schema_version", "parts_count"))
        spec[key] = value
    elif where == "part":
        part = g.rng.choice(spec["parts"])
        # Keys of other part kinds are unknown here as well.
        candidates = [
            k
            for k in UNKNOWN_KEYS + ("radius", "length", "pocket", "prinjection", "slot_shape", "mesh", "size", "tray_offset")
            if k not in allowed_for(part)
        ]
        part[g.rng.choice(candidates)] = value
    else:
        # Only plain vec3 and rect objects: tamps and holes may carry overrides,
        # and a tamp has a type, so neither key would be unknown there.
        targets = [(obj, keys) for obj, keys in _vec_targets(spec) if not _carries_overrides(spec, obj)]
        obj, keys = g.rng.choice(targets)
        candidates = [k for k in ("w", "X", "z2", "type", "overrides", "extra") if k not in obj and k not in keys]
        obj[g.rng.choice(candidates)] = value


def mutate_broken_enum(g: Gen, spec: dict) -> None:
    choices = ["tray", "version", "housing", "part_type", "part_type", "part_type"]
    parts = spec["parts"]
    if any(part.get("tamps") for part in parts):
        choices += ["tamp_type", "tamp_type"]
    if any(part_kind(p) == "plug" for p in parts):
        choices.append("slot_shape")
    if any(part_kind(p) == "component" for p in parts):
        choices.append("mesh")
    what = g.rng.choice(choices)
    if what == "tray":
        spec["tray"] = g.rng.choice(("custom", "Generated", "", "generated ", "file"))
    elif what == "version":
        spec["version"] = g.rng.choice((0, 2, 3, -1))
    elif what == "housing":
        spec["housing"] = g.rng.choice(("housing.obj", "Housing.3mf", "box.stl", "housing.3mf.bak", "housing.STL"))
    elif what == "part_type":
        part = g.rng.choice(parts)
        kind = part_kind(part)
        bad = ["led", "Trace_cloth", "pcb ", "trace", "PCB", "component", ""]
        # A type from another branch also fails: required keys go missing or keys become unknown.
        bad += {"trace": ["plug", "pcb"], "plug": ["trace_cloth", "print"], "component": ["plug", "trace_braid"]}[kind]
        part["type"] = g.rng.choice(bad)
    elif what == "tamp_type":
        part = g.rng.choice([p for p in parts if p.get("tamps")])
        g.rng.choice(part["tamps"])["type"] = g.rng.choice((4, 5, -1, 7, 10))
    elif what == "slot_shape":
        part = g.rng.choice([p for p in parts if part_kind(p) == "plug"])
        part["slot_shape"] = g.rng.choice(("square", "Circle", "round", ""))
    else:
        part = g.rng.choice([p for p in parts if part_kind(p) == "component"])
        part["mesh"] = g.rng.choice(("part-a.stl", "part-2.STL", "part2.stl", "mesh.stl", "part-.stl", "part-1.3mf"))


def mutate_pause_layer(g: Gen, spec: dict) -> None:
    part = g.rng.choice(spec["parts"])
    layer = part.get("pause_layer", 12)
    if not isinstance(layer, int) or isinstance(layer, bool):
        layer = 12
    part["pause_layer"] = copy.deepcopy(
        g.rng.choice((layer + 0.5, layer + 0.25, layer - 0.75 if layer > 1 else 1.5, str(layer), None, [layer]))
    )


MUTATIONS = (
    mutate_remove_required,
    mutate_wrong_type,
    mutate_unknown_key,
    mutate_broken_enum,
    mutate_pause_layer,
)


# --------------------------------------------------------------------------- output


def dump(path: Path, doc) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, indent=2, allow_nan=False)


def clear(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.json"):
        old.unlink()


def load_fixture(name: str) -> dict:
    with open(FIXTURE_DIR / name, "r", encoding="utf-8") as fh:
        return json.load(fh)


def generate() -> dict:
    rng = random.Random(SEED)
    g = Gen(rng)
    fixtures = [load_fixture("spec.json"), load_fixture("spec.export.json")]

    valid_dir = TESTSET_DIR / "valid"
    invalid_dir = TESTSET_DIR / "invalid"
    clear(valid_dir)
    clear(invalid_dir)
    expected = {}

    for i in range(1, N_VALID + 1):
        if i <= len(fixtures):
            spec = copy.deepcopy(fixtures[i - 1])  # the Fixture itself, unchanged
        else:
            spec = make_valid(g, rng.choice(fixtures))
        name = f"valid/{i:04d}.json"
        dump(TESTSET_DIR / name, spec)
        expected[name] = True

    for i in range(1, N_INVALID + 1):
        base = copy.deepcopy(rng.choice(fixtures)) if g.chance(0.2) else make_valid(g, rng.choice(fixtures))
        MUTATIONS[(i - 1) % len(MUTATIONS)](g, base)
        name = f"invalid/{i:04d}.json"
        dump(TESTSET_DIR / name, base)
        expected[name] = False

    dump(TESTSET_DIR / "expected.json", expected)
    return expected


def verify(expected: dict) -> int:
    from jsonschema import Draft202012Validator

    with open(SCHEMA_PATH, "r", encoding="utf-8") as fh:
        schema = json.load(fh)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    bad = 0
    for name, verdict in expected.items():
        with open(TESTSET_DIR / name, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        if validator.is_valid(doc) != verdict:
            bad += 1
            errors = [f"{'/'.join(map(str, e.absolute_path))}: {e.message}" for e in validator.iter_errors(doc)]
            print(f"MISMATCH {name}: expected {verdict}; errors: {errors[:3]}", file=sys.stderr)
    return bad


def main() -> int:
    expected = generate()
    bad = verify(expected)
    n_valid = sum(1 for v in expected.values() if v)
    print(f"wrote {n_valid} valid and {len(expected) - n_valid} invalid Specs to {TESTSET_DIR}")
    if bad:
        print(f"{bad} verdict(s) disagree with jsonschema", file=sys.stderr)
        return 1
    print("all verdicts agree with jsonschema Draft202012Validator")
    return 0


if __name__ == "__main__":
    sys.exit(main())
