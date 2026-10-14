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

# The worker's real stdout, kept for the one JSON answer. fd 1 itself points at stderr, so a
# library that prints (Python print or a native write to fd 1) cannot corrupt the answer.
_answer_fd: int | None = None


def _reserve_stdout_for_answer() -> None:
    global _answer_fd
    if _answer_fd is not None:
        return
    try:
        sys.stdout.flush()
        _answer_fd = os.dup(1)
        os.dup2(2, 1)
    except OSError:
        _answer_fd = None


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
    _reserve_stdout_for_answer()


@contextmanager
def capture_stderr_tail(max_bytes: int = STDERR_TAIL_BYTES) -> Iterator[None]:
    """Redirect fd 2 (and fd 1, once reserved) to a temp file and replay only its last ``max_bytes`` on exit."""
    # Output to fd 1 while handling is stderr too (see _reserve_stdout_for_answer), so it counts
    # toward the same tail instead of bypassing the limit.
    streams = (2, 1) if _answer_fd is not None else (2,)
    try:
        originals = {fd: os.dup(fd) for fd in streams}
    except OSError:
        yield
        return
    spool = tempfile.TemporaryFile()
    try:
        sys.stdout.flush()
        sys.stderr.flush()
        for fd in streams:
            os.dup2(spool.fileno(), fd)
        yield
    finally:
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except Exception:
                pass
        for fd, original in originals.items():
            os.dup2(original, fd)
            os.close(original)
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
    if _answer_fd is not None:
        view = memoryview(encoded)
        while view:
            written = os.write(_answer_fd, view)
            view = view[written:]
        return
    payload = encoded.decode("utf-8")
    if hasattr(sys.stdout, "buffer"):
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
        return
    sys.stdout.write(payload)
    sys.stdout.flush()
