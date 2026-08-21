#!/usr/bin/env python3
"""CLI test for pdf_to_html — avoids PowerShell JSON pipe encoding issues."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert PDF to HTML template via document-engine worker")
    parser.add_argument("path", help="Path to source PDF")
    parser.add_argument("--template-root", default="", help="Template artifact root (default: ~/.ax-studio/templates)")
    parser.add_argument("--engine", default="auto", help="Parser engine (auto, basic, docling)")
    parser.add_argument("--ocr", default="auto", help="OCR mode (auto, off, force)")
    args = parser.parse_args()

    worker = Path(__file__).resolve().parents[1] / "src" / "worker.py"
    payload = {
        "id": "cli-test",
        "command": "pdf_to_html",
        "params": {
            "path": str(Path(args.path).resolve()),
            "options": {"engine": args.engine, "ocr": args.ocr},
        },
    }
    if args.template_root:
        payload["params"]["templateRoot"] = str(Path(args.template_root).resolve())

    python = sys.executable
    venv_python = worker.parents[1] / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if venv_python.is_file():
        python = str(venv_python)

    proc = subprocess.run(
        [python, str(worker)],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(worker.parent),
        check=False,
    )
    stdout = proc.stdout.strip()
    if not stdout:
        print(proc.stderr, file=sys.stderr)
        return proc.returncode or 1
    print(stdout)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
