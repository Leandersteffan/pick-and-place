"""python -m pipeline <spec folder> --project <designer folder>"""

import argparse
import os
import sys

_SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from pipeline.run import run


def main():
    parser = argparse.ArgumentParser(description="Build a tray and a combined gcode file from a spec folder.")
    parser.add_argument("spec", help="Folder that contains spec.json and the housing mesh.")
    parser.add_argument("--project", required=True, help="Designer folder that contains Scripts and resources.")
    args = parser.parse_args()
    try:
        run(args.spec, args.project)
    except Exception as error:
        print(str(error))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
