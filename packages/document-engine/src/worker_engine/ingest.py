from __future__ import annotations

from pathlib import Path

from adapters import resolve_adapter
from artifact_store import load_manifest, manifest_exists, sha256_file, write_manifest
from ax_paths import default_document_root
from ingest_options import cache_usable, normalize_ocr
from protocol import EngineRequest, EngineResponse

from .projection import _ingest_response_data


def handle_ingest(request: EngineRequest) -> EngineResponse:
    source = request.params.get("path")
    if not source:
        return EngineResponse(id=request.id, ok=False, error="path_required")
    source_path = Path(str(source))
    if not source_path.is_file():
        return EngineResponse(id=request.id, ok=False, error="file_not_found")

    artifact_root = Path(str(request.params.get("artifactRoot") or default_document_root()))
    document_id = sha256_file(source_path)
    options = dict(request.params.get("options") or {})
    engine = str(options.get("engine") or "auto")
    ocr_mode = normalize_ocr(options.get("ocr"))
    options["ocr"] = ocr_mode
    adapter = resolve_adapter(engine)
    if manifest_exists(artifact_root, document_id):
        manifest = load_manifest(artifact_root, document_id)
        if cache_usable(
            manifest,
            requested_engine=engine,
            requested_ocr=ocr_mode,
            resolved_engine=adapter.name,
        ):
            return EngineResponse(
                id=request.id,
                ok=True,
                data=_ingest_response_data(document_id, artifact_root, manifest, cached=True),
            )
    try:
        result = adapter.ingest(source_path, artifact_root, options)
    except Exception:
        if engine != "auto" or adapter.name == "basic":
            raise
        from adapters.basic import BasicAdapter

        result = BasicAdapter().ingest(source_path, artifact_root, options)
        result.manifest["fallbackFrom"] = adapter.name
        write_manifest(artifact_root, result.document_id, result.manifest)
    return EngineResponse(
        id=request.id,
        ok=True,
        data=_ingest_response_data(result.document_id, artifact_root, result.manifest),
    )
