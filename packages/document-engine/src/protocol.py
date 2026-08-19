from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class EngineRequest:
    id: str
    command: str
    params: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "EngineRequest":
        return cls(
            id=str(raw.get("id", "")),
            command=str(raw.get("command", "")),
            params=dict(raw.get("params") or {}),
        )


@dataclass
class EngineResponse:
    id: str
    ok: bool
    data: dict[str, Any] | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "ok": self.ok}
        if self.data is not None:
            out["data"] = self.data
        if self.error is not None:
            out["error"] = self.error
        return out
