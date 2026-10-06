from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import time
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


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write via a unique sibling temp file and atomically replace the target.

    Concurrent writers never share a temp name, and readers only ever observe
    the old or the new complete file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        for attempt in range(5):
            try:
                os.replace(tmp_name, path)
                return
            except PermissionError:
                # Windows refuses to replace a file another process has open.
                if attempt == 4:
                    raise
                time.sleep(0.05 * (attempt + 1))
    finally:
        if os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except OSError:
                pass


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def atomic_copy_file(source: Path, target: Path) -> None:
    """Copy ``source`` over ``target`` without exposing a partially written file."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=str(target.parent))
    os.close(fd)
    try:
        shutil.copyfile(source, tmp_name)
        os.replace(tmp_name, target)
    finally:
        if os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except OSError:
                pass


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
    atomic_write_text(
        root / "chunks.jsonl",
        "".join(json.dumps(chunk, ensure_ascii=False) + "\n" for chunk in chunks),
    )

    for page in manifest.get("pages") or []:
        index = page.get("index")
        text = page.get("text")
        if index is None or not isinstance(text, str) or not text.strip():
            continue
        atomic_write_text(pages_dir / f"{int(index)}.txt", text)

    # The manifest is the commit marker for an artifact. Write payload files
    # first and replace the marker atomically so an interrupted ingest cannot
    # make a partial directory look cacheable.
    atomic_write_text(root / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

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
