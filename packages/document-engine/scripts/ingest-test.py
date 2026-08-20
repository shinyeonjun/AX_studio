#!/usr/bin/env python3
"""Run document-engine ingest without PowerShell stdout encoding issues."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest a document via worker.py")
    parser.add_argument("path", type=Path, help="Source document path")
    parser.add_argument(
        "--artifact-root",
        type=Path,
        default=Path(".ax-studio/documents"),
        help="Artifact output root",
    )
    parser.add_argument("--engine", default="docling", help="Parser engine (docling, basic, auto)")
    parser.add_argument("--ocr", default="auto", help="OCR mode (auto, off, force)")
    parser.add_argument(
        "--response-out",
        type=Path,
        help="Optional path to write the full JSON response",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print worker stderr (OCR engine logs)",
    )
    args = parser.parse_args()

    src_dir = Path(__file__).resolve().parents[1] / "src"
    worker = src_dir / "worker.py"
    if not worker.is_file():
        print(f"worker not found: {worker}", file=sys.stderr)
        return 1
    if not args.path.is_file():
        print(f"source not found: {args.path}", file=sys.stderr)
        return 1

    request = {
        "id": "cli",
        "command": "ingest",
        "params": {
            "path": str(args.path.resolve()),
            "artifactRoot": str(args.artifact_root.resolve()),
            "options": {"engine": args.engine, "ocr": args.ocr},
        },
    }

    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONPATH": str(src_dir)}
    proc = subprocess.run(
        [sys.executable, str(worker)],
        input=json.dumps(request).encode("utf-8"),
        capture_output=True,
        cwd=str(src_dir),
        env=env,
    )
    if proc.stderr and args.verbose:
        sys.stderr.buffer.write(proc.stderr)
    if proc.returncode != 0:
        print(f"worker exited with code {proc.returncode}", file=sys.stderr)
        return proc.returncode

    try:
        response = json.loads(proc.stdout.decode("utf-8"))
    except json.JSONDecodeError as error:
        print(f"invalid worker JSON: {error}", file=sys.stderr)
        return 1

    if args.response_out:
        args.response_out.parent.mkdir(parents=True, exist_ok=True)
        args.response_out.write_text(
            json.dumps(response, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    data = response.get("data") or {}
    summary = data.get("summary") or {}
    cached = data.get("cached")
    print(
        json.dumps(
            {"ok": response.get("ok"), "cached": bool(cached), "summary": summary},
            ensure_ascii=False,
            indent=2,
        )
    )
    if data.get("artifactPath"):
        print(f"artifactPath: {data['artifactPath']}")
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
