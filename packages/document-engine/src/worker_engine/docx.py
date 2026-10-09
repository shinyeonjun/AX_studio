from __future__ import annotations

from engine_limits import assert_source_within_limits
from ax_paths import managed_request_path, request_allowed_paths
from protocol import EngineRequest, EngineResponse


def _source(request: EngineRequest, key: str, label: str):
    value = request.params.get(key)
    if not value:
        raise ValueError(f"report_{label}_path_required")
    path = managed_request_path(value, label, request_allowed_paths(request.params))
    if not path.is_file():
        raise ValueError(f"report_{label}_file_not_found")
    assert_source_within_limits(path)
    return path


def _output(request: EngineRequest, key: str = "outputPath"):
    value = request.params.get(key)
    if not value:
        raise ValueError("report_output_path_required")
    return managed_request_path(value, "output", request_allowed_paths(request.params))


def handle_docx_command(request: EngineRequest) -> EngineResponse:
    from write.docx_report import fill_docx_report, list_docx_spans, prepare_docx_report

    if request.command == "docx_report_spans":
        data = list_docx_spans(_source(request, "examplePath", "example"))
    elif request.command == "docx_report_prepare":
        removals = request.params.get("removals")
        if not isinstance(removals, list):
            raise ValueError("report_values_required")
        data = prepare_docx_report(_source(request, "examplePath", "example"), removals,
                                   _output(request, "templatePath"))
    else:
        groups = request.params.get("groups")
        values = request.params.get("values")
        if not isinstance(groups, list) or not isinstance(values, dict):
            raise ValueError("report_docx_fill_invalid")
        data = fill_docx_report(_source(request, "templatePath", "template"), groups, values, _output(request))
    return EngineResponse(id=request.id, ok=True, data=data)
