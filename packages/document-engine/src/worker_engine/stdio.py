from __future__ import annotations

import json
import sys

from protocol import EngineResponse


def _configure_stdio() -> None:
    # The host sends UTF-8 JSON bytes. Windows pipe stdin may use a legacy
    # codepage, and packaged -E launches ignore PYTHONUTF8 environment settings.
    reconfigure_stdin = getattr(sys.stdin, "reconfigure", None)
    if callable(reconfigure_stdin):
        reconfigure_stdin(encoding="utf-8", errors="strict")
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _write_json_response(response: EngineResponse) -> None:
    payload = json.dumps(response.to_dict(), ensure_ascii=False)
    if hasattr(sys.stdout, "buffer"):
        sys.stdout.buffer.write(payload.encode("utf-8"))
        sys.stdout.buffer.flush()
        return
    sys.stdout.write(payload)
    sys.stdout.flush()
