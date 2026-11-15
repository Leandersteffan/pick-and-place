"""Programs that live outside the Designer folder. machine.json is the only source."""

import json
import os
import sys


def machine_file(project_dir):
    return os.path.join(project_dir, "machine.json")


def this_platform():
    if sys.platform == "win32":
        return "windows"
    if sys.platform == "darwin":
        return "mac"
    return sys.platform


def load_machine(project_dir):
    path = machine_file(project_dir)
    if not os.path.isfile(path):
        raise RuntimeError(
            "machine.json is missing from the Designer folder. "
            "Copy machine.example.json to machine.json and fill in the paths."
        )
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise RuntimeError("machine.json must be an object with the paths for this computer.")
    platform = str(data.get("platform") or "").strip().lower()
    if platform not in ("windows", "mac"):
        raise RuntimeError('machine.json "platform" must be "windows" or "mac".')
    actual = this_platform()
    if platform != actual:
        raise RuntimeError(
            'machine.json says "{0}", and this computer is {1}.'.format(platform, actual)
        )
    return data


def tool_path(machine, key):
    value = machine.get(key)
    text = "" if value is None else str(value).strip()
    if not text:
        raise RuntimeError('machine.json "{0}" is empty.'.format(key))
    if not os.path.isfile(text):
        raise RuntimeError('machine.json "{0}" is not a file: {1}'.format(key, text))
    return text
