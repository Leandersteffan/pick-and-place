"""Bridge to the pipeline in Designer/Scripts. Pipeline modules are imported in place, never copied."""

import contextlib
import json
import logging
import os
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

DESIGNER = Path(__file__).resolve().parents[3]  # pnp_server -> server -> web -> Designer
SCRIPTS = DESIGNER / "Scripts"
TMP_ROOT = Path(__file__).resolve().parents[1] / ".tmp"  # web/server/.tmp (gitignored)
TMP_PREFIX = "pnp-"
STALE_AFTER_S = 3600

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from pipeline.report import bed_offsets  # noqa: E402  (additive, read-only)
from pipeline.run import run as pipeline_run  # noqa: E402  (unchanged)
from pipeline.slicer import resolve_orca  # noqa: E402

from pnp_server.logs import StageTracker  # noqa: E402
from pnp_server.version import pipeline_version  # noqa: E402

log = logging.getLogger(__name__)

# One slice at a time: stdout capture is process-wide. slice_project acquires this without blocking.
SLICE_LOCK = threading.Lock()


class SliceBusy(Exception):
    """Another slice is running."""


class SliceFailed(Exception):
    """The pipeline failed. `stage` is the stage of the last progress line seen."""

    def __init__(self, stage, message, log_tail):
        super().__init__(message)
        self.stage = stage
        self.message = message
        self.log_tail = list(log_tail)


@dataclass
class SliceResult:
    gcode: str
    tray_stl: bytes
    spec: dict
    offsets: dict | None
    duration_s: float
    log_tail: list = field(default_factory=list)
    pipeline_version: str | None = None


def is_busy():
    return SLICE_LOCK.locked()


def orca_path():
    """The OrcaSlicer executable the pipeline would use, or None."""
    return resolve_orca(str(DESIGNER))


def orca_candidates():
    """The paths pipeline.slicer.resolve_orca checks, in order, so the UI can show where it looked."""
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    paths = [
        os.path.join(program_files, "OrcaSlicer", "orca-slicer.exe"),
        r"C:\Program Files\OrcaSlicer\orca-slicer.exe",
    ]
    return list(dict.fromkeys(paths))


def _rmtree_retry(path, tries=5, delay_s=0.2):
    """shutil.rmtree with retries for Windows file locks. Leaves the folder for the startup sweep on failure."""
    for attempt in range(tries):
        try:
            shutil.rmtree(path)
            return True
        except FileNotFoundError:
            return True
        except OSError as error:
            if attempt == tries - 1:
                log.warning("Could not remove %s: %s", path, error)
                return False
            time.sleep(delay_s)
    return False


def sweep_stale_tmp(root=TMP_ROOT, max_age_s=STALE_AFTER_S, now=None):
    """Remove leftover pnp-* folders in root older than max_age_s. Returns the removed paths."""
    root = Path(root)
    if not root.is_dir():
        return []
    now = time.time() if now is None else now
    removed = []
    for entry in root.glob(TMP_PREFIX + "*"):
        try:
            if entry.is_dir() and now - entry.stat().st_mtime > max_age_s:
                if _rmtree_retry(entry, tries=1):
                    removed.append(entry)
        except OSError as error:
            log.warning("Startup sweep skipped %s: %s", entry, error)
    return removed


def _safe_name(name):
    if not name or name != os.path.basename(name) or name in (".", "..") or name == "spec.json":
        raise ValueError("Bad upload file name: {0!r}".format(name))
    return name


def slice_project(spec, files):
    """Run the unchanged pipeline on spec and its mesh files in a temp folder.

    `files` maps file names (housing.3mf, part-N.stl, already whitelisted by the caller) to bytes.
    Raises SliceBusy when a slice is running, SliceFailed(stage, message, log_tail) on any failure.
    """
    if not SLICE_LOCK.acquire(blocking=False):
        raise SliceBusy("A slice is already running.")
    tracker = StageTracker()
    tmp = None
    started = time.monotonic()
    try:
        TMP_ROOT.mkdir(parents=True, exist_ok=True)
        tmp = Path(tempfile.mkdtemp(prefix=TMP_PREFIX, dir=TMP_ROOT))
        spec_dir = tmp / "spec"
        spec_dir.mkdir()
        (spec_dir / "spec.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
        for name, data in files.items():
            (spec_dir / _safe_name(name)).write_bytes(data)
        with contextlib.redirect_stdout(tracker):
            final = pipeline_run(str(spec_dir), str(DESIGNER))
        written_spec = json.loads((spec_dir / "spec.json").read_text(encoding="utf-8"))
        # Decode bytes instead of read_text so line endings stay as the pipeline wrote them.
        gcode = Path(final).read_bytes().decode("utf-8")
        tray_stl = (spec_dir / "tray.stl").read_bytes()
        offsets = bed_offsets(str(spec_dir), written_spec)
        return SliceResult(
            gcode=gcode,
            tray_stl=tray_stl,
            spec=written_spec,
            offsets=offsets,
            duration_s=round(time.monotonic() - started, 3),
            log_tail=tracker.tail(200),
            pipeline_version=pipeline_version,
        )
    except Exception as error:
        log.exception("Slice failed at stage %s", tracker.stage)
        raise SliceFailed(tracker.stage, str(error) or type(error).__name__, tracker.tail(200)) from error
    finally:
        if tmp is not None:
            _rmtree_retry(tmp)
        SLICE_LOCK.release()


try:
    sweep_stale_tmp()
except Exception as sweep_error:  # never block startup on the sweep
    log.warning("Startup sweep failed: %s", sweep_error)
