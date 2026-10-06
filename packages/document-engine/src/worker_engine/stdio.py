from __future__ import annotations

import json
import os
import sys
import tempfile
from contextlib import contextmanager
from typing import Iterator

from protocol import EngineResponse

# The host stops reading stdout at 8 MiB and kills the worker. Answer with a
# clean error instead of a truncated payload the host cannot parse.
MAX_RESPONSE_BYTES = 7 * 1024 * 1024
# Native libraries (onnxruntime, Docling) can log megabytes to fd 2. Only the
# tail is forwarded, so a chatty run never trips the host's stderr limit.
STDERR_TAIL_BYTES = 64 * 1024


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


@contextmanager
def capture_stderr_tail(max_bytes: int = STDERR_TAIL_BYTES) -> Iterator[None]:
    """Redirect fd 2 to a temp file and replay only its last ``max_bytes`` on exit."""
    try:
        original_fd = os.dup(2)
    except OSError:
        yield
        return
    spool = tempfile.TemporaryFile()
    try:
        sys.stderr.flush()
        os.dup2(spool.fileno(), 2)
        yield
    finally:
        try:
            sys.stderr.flush()
        except Exception:
            pass
        os.dup2(original_fd, 2)
        os.close(original_fd)
        try:
            size = spool.seek(0, os.SEEK_END)
            spool.seek(max(0, size - max_bytes))
            tail = spool.read()
            if tail:
                if size > max_bytes:
                    os.write(2, f"[document-engine: {size - max_bytes} earlier stderr bytes dropped]\n".encode("utf-8"))
                os.write(2, tail)
        except OSError:
            pass
        finally:
            spool.close()


def _encode_response(response: EngineResponse) -> bytes:
    payload = json.dumps(response.to_dict(), ensure_ascii=False).encode("utf-8")
    if len(payload) <= MAX_RESPONSE_BYTES:
        return payload
    oversized = EngineResponse(id=response.id, ok=False, error="document_engine_response_too_large")
    return json.dumps(oversized.to_dict(), ensure_ascii=False).encode("utf-8")


def _write_json_response(response: EngineResponse) -> None:
    encoded = _encode_response(response)
    payload = encoded.decode("utf-8")
    if hasattr(sys.stdout, "buffer"):
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
        return
    sys.stdout.write(payload)
    sys.stdout.flush()
