"""FastAPI app. Start with: py -3.10 -m uvicorn pnp_server.app:app --host 127.0.0.1 --port 8765"""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from pnp_server.health import router as health_router
from pnp_server.intersections_api import router as intersections_router
from pnp_server.slice_api import router as slice_router
from pnp_server.validation import router as validation_router
from pnp_server.version import __version__

ALLOWED_HOST = "127.0.0.1"
DIST = Path(__file__).resolve().parents[2] / "app" / "dist"  # pnp_server -> server -> web


def check_host(environ=os.environ):
    """Refuse to start when PNP_HOST asks for any bind other than 127.0.0.1."""
    host = environ.get("PNP_HOST")
    if host is not None and host != ALLOWED_HOST:
        raise RuntimeError(f"PNP_HOST={host!r} is not allowed; the backend only binds to {ALLOWED_HOST}")


check_host()

app = FastAPI(title="pick-and-place backend", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(validation_router)
app.include_router(intersections_router)
app.include_router(slice_router)

# API routers are included above this line. The static mount comes last so /api routes win.
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="app")
