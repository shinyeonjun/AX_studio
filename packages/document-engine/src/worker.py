"""Stable executable seam for the document-engine worker."""

import json
import sys

from engine_limits import configure_image_limits
from protocol import EngineRequest, EngineResponse
from worker_engine.dispatch import handle_request
from worker_engine.stdio import _configure_stdio, _write_json_response, capture_stderr_tail


def main() -> None:
    _configure_stdio()
    configure_image_limits()
    raw = sys.stdin.read()
    if not raw.strip():
        response = EngineResponse(id="", ok=False, error="empty_request")
        _write_json_response(response)
        sys.exit(1)

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        response = EngineResponse(id="", ok=False, error=f"invalid_request_json:{error.msg}")
        _write_json_response(response)
        sys.exit(1)
    if not isinstance(payload, dict):
        response = EngineResponse(id="", ok=False, error="request_object_required")
        _write_json_response(response)
        sys.exit(1)
    request = EngineRequest.from_dict(payload)
    with capture_stderr_tail():
        response = handle_request(request)
    _write_json_response(response)
    sys.exit(0 if response.ok else 1)


if __name__ == "__main__":
    main()
