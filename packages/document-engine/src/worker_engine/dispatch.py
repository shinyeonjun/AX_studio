from __future__ import annotations

import sys
import traceback

from protocol import EngineRequest, EngineResponse

from .ingest import handle_ingest
from .pdf import handle_pdf_command
from .queries import handle_document_query


def handle_request(request: EngineRequest) -> EngineResponse:
    try:
        if request.command == "ping":
            return EngineResponse(id=request.id, ok=True, data={"engine": "document-engine", "version": 1})
        if request.command == "ingest":
            return handle_ingest(request)
        if request.command in {"pdf_to_html", "pdf_form_analyze", "pdf_form_fill", "pdf_report_analyze"}:
            return handle_pdf_command(request)
        return handle_document_query(request)
    except FileNotFoundError as error:
        return EngineResponse(id=request.id, ok=False, error=str(error))
    except ValueError as error:
        return EngineResponse(id=request.id, ok=False, error=str(error))
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        return EngineResponse(id=request.id, ok=False, error=str(error))
