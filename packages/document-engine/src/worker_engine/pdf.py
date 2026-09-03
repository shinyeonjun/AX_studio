from __future__ import annotations

from pathlib import Path

from artifact_store import sha256_file
from ax_paths import default_template_root
from protocol import EngineRequest, EngineResponse


def _handle_pdf_to_html(request: EngineRequest) -> EngineResponse:
    from write.pdf_to_html import convert_pdf_to_html

    source = request.params.get("path")
    if not source:
        return EngineResponse(id=request.id, ok=False, error="path_required")
    source_path = Path(str(source))
    if not source_path.is_file():
        return EngineResponse(id=request.id, ok=False, error="file_not_found")

    template_root = Path(str(request.params.get("templateRoot") or default_template_root()))
    options = dict(request.params.get("options") or {})
    result = convert_pdf_to_html(source_path, template_root, options)
    return EngineResponse(
        id=request.id,
        ok=True,
        data={
            "templateId": result.template_id,
            "sourcePath": result.source_path,
            "artifactPath": result.artifact_path,
            "htmlPath": result.html_path,
            "originalPdfPath": result.original_pdf_path,
            "metaPath": result.meta_path,
            "engine": result.engine,
            "pageCount": result.page_count,
            "html": result.html,
            "cached": result.cached,
        },
    )


def _handle_pdf_form_analyze(request: EngineRequest) -> EngineResponse:
    from write.pdf_form import persist_pdf_form_template

    source = request.params.get("path")
    if not source:
        return EngineResponse(id=request.id, ok=False, error="path_required")
    source_path = Path(str(source))
    if not source_path.is_file():
        return EngineResponse(id=request.id, ok=False, error="file_not_found")
    template_root = Path(str(request.params.get("templateRoot") or default_template_root()))
    options = dict(request.params.get("options") or {})
    template = persist_pdf_form_template(source_path, template_root, options)
    return EngineResponse(id=request.id, ok=True, data=template)


def _handle_pdf_form_fill(request: EngineRequest) -> EngineResponse:
    from write.pdf_form import fill_pdf_form

    source = request.params.get("path")
    if not source:
        return EngineResponse(id=request.id, ok=False, error="path_required")
    source_path = Path(str(source))
    if not source_path.is_file():
        return EngineResponse(id=request.id, ok=False, error="file_not_found")
    values = request.params.get("values")
    if not isinstance(values, dict):
        return EngineResponse(id=request.id, ok=False, error="values_object_required")
    template = request.params.get("template") or request.params.get("templatePath")
    if template is None:
        return EngineResponse(id=request.id, ok=False, error="template_required")
    output = request.params.get("outputPath")
    if output:
        output_path = Path(str(output))
    else:
        template_root = Path(str(request.params.get("templateRoot") or default_template_root()))
        output_path = template_root / sha256_file(source_path)[:2] / sha256_file(source_path) / "filled.pdf"
    result = fill_pdf_form(
        source_path,
        template,
        values,
        output_path,
        font_path=str(request.params.get("fontPath")) if request.params.get("fontPath") else None,
    )
    return EngineResponse(id=request.id, ok=True, data=result)


def handle_pdf_command(request: EngineRequest) -> EngineResponse:
    if request.command == "pdf_to_html":
        return _handle_pdf_to_html(request)
    if request.command == "pdf_form_analyze":
        return _handle_pdf_form_analyze(request)
    return _handle_pdf_form_fill(request)
