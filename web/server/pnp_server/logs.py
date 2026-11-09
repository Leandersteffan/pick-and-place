"""Capture the pipeline's printed output and track which stage it reached."""

import collections

MAX_LINES = 2000

# Prefix of a progress line printed by Scripts/pipeline/run.py -> the stage that runs after it.
# A failure is reported with the stage of the last progress line seen.
_STAGE_PREFIXES = (
    ("OrcaSlicer: ", "tray_layout"),
    ("PrusaSlicer: ", "tray_layout"),
    ("Tray written to ", "slice_tray"),
    ("Slicing tray...", "slice_tray"),
    ("Slicing housing...", "slice_housing"),
    ("Moved the housing", "assemble"),
    ("Shared bed nudge", "assemble"),
)


def stage_for_line(line, current):
    """The stage after seeing `line`, given the stage before it."""
    text = line.strip()
    for prefix, stage in _STAGE_PREFIXES:
        if text.startswith(prefix):
            return stage
    return current


class StageTracker:
    """File-like target for contextlib.redirect_stdout. Keeps the last 2000 lines."""

    def __init__(self, stage="load_spec", maxlen=MAX_LINES):
        self.stage = stage
        self._lines = collections.deque(maxlen=maxlen)
        self._partial = ""

    def write(self, text):
        if not text:
            return 0
        data = self._partial + str(text)
        pieces = data.split("\n")
        self._partial = pieces.pop()
        for piece in pieces:
            self._add(piece.rstrip("\r"))
        return len(text)

    def flush(self):
        pass

    def finish(self):
        """Store any unterminated last line."""
        if self._partial:
            self._add(self._partial.rstrip("\r"))
            self._partial = ""

    def _add(self, line):
        self._lines.append(line)
        self.stage = stage_for_line(line, self.stage)

    def isatty(self):
        return False

    def writable(self):
        return True

    def tail(self, count=200):
        self.finish()
        if count <= 0:
            return []
        return list(self._lines)[-count:]
