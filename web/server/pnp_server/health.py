"""GET /api/health."""

import importlib
import os
import sys

from fastapi import APIRouter

from pnp_server import bridge, intersections_api
from pnp_server.version import __version__, pipeline_version

router = APIRouter()


def manifold3d_status():
    try:
        module = importlib.import_module("manifold3d")
    except Exception as exc:  # noqa: BLE001  (any import failure is reported, not raised)
        return {"ok": False, "version": None, "error": f"{type(exc).__name__}: {exc}"}
    version = getattr(module, "__version__", None)
    return {"ok": True, "version": None if version is None else str(version), "error": None}


@router.get("/api/health")
def health():
    orca_path = bridge.orca_path()
    return {
        "version": __version__,
        "python": sys.version.split()[0],
        "pipeline_dir": str(bridge.SCRIPTS),
        "pipeline_version": pipeline_version,
        "orca_path": orca_path,
        "orca_exists": orca_path is not None and os.path.isfile(orca_path),
        "orca_candidates": bridge.orca_candidates(),
        "manifold3d": manifold3d_status(),
        "intersection_port": intersections_api.available(),
        "busy": bridge.is_busy(),
    }
