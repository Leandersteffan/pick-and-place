import sys
from pathlib import Path

import pytest

SERVER_DIR = Path(__file__).resolve().parents[1]
DESIGNER_DIR = SERVER_DIR.parents[1]  # server -> web -> Designer
SCRIPTS_DIR = DESIGNER_DIR / "Scripts"
FIXTURE_DIR = DESIGNER_DIR / "web" / "fixtures" / "demo-v1"
SCHEMA_PATH = DESIGNER_DIR / "web" / "schema" / "spec.v1.schema.json"

for path in (SERVER_DIR, SCRIPTS_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from pipeline.slicer import resolve_orca  # noqa: E402  (imported in place, never copied)


@pytest.fixture(scope="session")
def designer_dir():
    return DESIGNER_DIR


@pytest.fixture(scope="session")
def fixture_dir():
    return FIXTURE_DIR


@pytest.fixture(scope="session")
def schema_path():
    return SCHEMA_PATH


def pytest_collection_modifyitems(config, items):
    if resolve_orca(str(DESIGNER_DIR)) is not None:
        return
    skip = pytest.mark.skip(reason="OrcaSlicer not found by resolve_orca()")
    for item in items:
        if "orca" in item.keywords:
            item.add_marker(skip)
