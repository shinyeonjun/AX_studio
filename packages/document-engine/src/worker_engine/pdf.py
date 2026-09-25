from __future__ import annotations

from pathlib import Path

from artifact_store import sha256_file
from ax_paths import (
    default_document_root,
    default_template_root,
    managed_request_path,
    managed_request_root,
    request_allowed_paths,
)
from protocol import EngineRequest, EngineResponse

def _managed_path(path_value: object, label: str, allowed_paths: set[Path]) -> Path | None:
    return managed_request_path(path_value, label, allowed_paths)


def _handle_pdf_to_html(request: EngineRequest) -> EngineResponse:
    from write.pdf_to_html import convert_pdf_to_html

    source = request.params.get("path")
    if not source:
        return EngineResponse(id=request.id, ok=False, error="path_required")
    allowed_paths = request_allowed_paths(request.params)
    source_path = _managed_path(source, "pdf", allowed_paths)
    if not source_path.is_file():
        return EngineResponse(id=request.id, ok=False, error="file_not_found")

    template_root = managed_request_root(
        request.params.get("templateRoot"),
        default_template_root(),
        "template",
        request.params,
    )
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
    allowed_paths = request_allowed_paths(request.params)
    source_path = _managed_path(source, "pdf", allowed_paths)
    if not source_path.is_file():
        return EngineResponse(id=request.id, ok=False, error="file_not_found")
    template_root = managed_request_root(
        request.params.get("templateRoot"),
        default_template_root(),
        "template",
        request.params,
    )
    options = dict(request.params.get("options") or {})
    template = persist_pdf_form_template(source_path, template_root, options)
    return EngineResponse(id=request.id, ok=True, data=template)


def _handle_pdf_form_fill(request: EngineRequest) -> EngineResponse:
    from write.pdf_form import fill_pdf_form

    source = request.params.get("path")
    if not source:
        return EngineResponse(id=request.id, ok=False, error="path_required")
    allowed_paths = request_allowed_paths(request.params)
    source_path = _managed_path(source, "pdf", allowed_paths)
    if not source_path.is_file():
        return EngineResponse(id=request.id, ok=False, error="file_not_found")
    values = request.params.get("values")
    if not isinstance(values, dict):
        return EngineResponse(id=request.id, ok=False, error="values_object_required")
    template = request.params.get("template") or request.params.get("templatePath")
    if template is None:
        return EngineResponse(id=request.id, ok=False, error="template_required")
    if isinstance(template, str):
        template = _managed_path(template, "template", allowed_paths)
    output = request.params.get("outputPath")
    if output:
        output_path = _managed_path(output, "output", allowed_paths)
    else:
        template_root = managed_request_root(
            request.params.get("templateRoot"),
            default_template_root(),
            "template",
            request.params,
        )
        output_path = template_root / sha256_file(source_path)[:2] / sha256_file(source_path) / "filled.pdf"
    font_path = None
    if request.params.get("fontPath"):
        font_path = str(_managed_path(request.params.get("fontPath"), "font", allowed_paths))
    result = fill_pdf_form(
        source_path,
        template,
        values,
        output_path,
        font_path=font_path,
    )
    return EngineResponse(id=request.id, ok=True, data=result)


def _handle_pdf_report_analyze(request: EngineRequest) -> EngineResponse:
    from write.pdf_report import analyze_pdf_report_pair

    template = request.params.get("templatePath")
    example = request.params.get("examplePath")
    if not template or not example:
        return EngineResponse(id=request.id, ok=False, error="report_pair_paths_required")
    allowed_paths = request_allowed_paths(request.params)
    template_path = _managed_path(template, "template", allowed_paths)
    example_path = _managed_path(example, "example", allowed_paths)
    if not template_path.is_file() or not example_path.is_file():
        return EngineResponse(id=request.id, ok=False, error="report_pair_file_not_found")
    artifact_root = managed_request_root(
        request.params.get("artifactRoot"),
        default_document_root(),
        "artifact",
        request.params,
    )
    result = analyze_pdf_report_pair(template_path, example_path, artifact_root)
    return EngineResponse(id=request.id, ok=True, data=result)


def handle_pdf_command(request: EngineRequest) -> EngineResponse:
    if request.command == "pdf_to_html":
        return _handle_pdf_to_html(request)
    if request.command == "pdf_form_analyze":
        return _handle_pdf_form_analyze(request)
    if request.command == "pdf_report_analyze":
        return _handle_pdf_report_analyze(request)
    return _handle_pdf_form_fill(request)
