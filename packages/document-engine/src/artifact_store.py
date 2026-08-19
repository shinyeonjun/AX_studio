from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_dir(artifact_root: Path, document_id: str) -> Path:
    return artifact_root / document_id[:2] / document_id


def write_manifest(
    artifact_root: Path,
    document_id: str,
    manifest: dict[str, Any],
) -> Path:
    root = artifact_dir(artifact_root, document_id)
    pages_dir = root / "pages"
    images_dir = root / "images"
    tables_dir = root / "tables"
    for directory in (root, pages_dir, images_dir, tables_dir):
        directory.mkdir(parents=True, exist_ok=True)

    manifest_path = root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    chunks = manifest.get("chunks") or []
    chunks_path = root / "chunks.jsonl"
    with chunks_path.open("w", encoding="utf-8") as handle:
        for chunk in chunks:
            handle.write(json.dumps(chunk, ensure_ascii=False))
            handle.write("\n")

    return root


def load_manifest(artifact_root: Path, document_id: str) -> dict[str, Any]:
    manifest_path = artifact_dir(artifact_root, document_id) / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"manifest_not_found:{document_id}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
