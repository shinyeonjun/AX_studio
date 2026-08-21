from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_ARTIFACT_ID_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def validate_artifact_id(artifact_id: str) -> str:
    normalized = str(artifact_id or "").lower()
    if not _ARTIFACT_ID_PATTERN.fullmatch(normalized):
        raise ValueError("document_id_invalid")
    return normalized


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_dir(artifact_root: Path, document_id: str) -> Path:
    normalized_id = validate_artifact_id(document_id)
    return artifact_root / normalized_id[:2] / normalized_id


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

    chunks = manifest.get("chunks") or []
    chunks_path = root / "chunks.jsonl"
    with chunks_path.open("w", encoding="utf-8") as handle:
        for chunk in chunks:
            handle.write(json.dumps(chunk, ensure_ascii=False))
            handle.write("\n")

    for page in manifest.get("pages") or []:
        index = page.get("index")
        text = page.get("text")
        if index is None or not isinstance(text, str) or not text.strip():
            continue
        (pages_dir / f"{int(index)}.txt").write_text(text, encoding="utf-8")

    # The manifest is the commit marker for an artifact. Write payload files
    # first and replace the marker atomically so an interrupted ingest cannot
    # make a partial directory look cacheable.
    manifest_path = root / "manifest.json"
    manifest_tmp = root / "manifest.json.tmp"
    manifest_tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(manifest_tmp, manifest_path)

    return root


def manifest_exists(artifact_root: Path, document_id: str) -> bool:
    return (artifact_dir(artifact_root, document_id) / "manifest.json").is_file()


def load_manifest(artifact_root: Path, document_id: str) -> dict[str, Any]:
    manifest_path = artifact_dir(artifact_root, document_id) / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"manifest_not_found:{document_id}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
