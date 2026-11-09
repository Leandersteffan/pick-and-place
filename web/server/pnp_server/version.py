"""Backend version and the git version of the pipeline it drives."""

import subprocess
from pathlib import Path

__version__ = "0.1.0"

DESIGNER = Path(__file__).resolve().parents[3]  # pnp_server -> server -> web -> Designer


def _git(*args):
    result = subprocess.run(
        ["git", "-C", str(DESIGNER), *args],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    return result.stdout.strip()


def compute_pipeline_version():
    """`git rev-parse --short HEAD`, plus `+dirty` if Scripts/ has changes. None without git."""
    try:
        head = _git("rev-parse", "--short", "HEAD")
        if not head:
            return None
        if _git("status", "--porcelain", "Scripts/"):
            head += "+dirty"
        return head
    except (OSError, subprocess.SubprocessError):
        return None


pipeline_version = compute_pipeline_version()
