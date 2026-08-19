from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class IngestResult:
    document_id: str
    artifact_path: str
    engine: str
    summary: dict[str, Any]
    manifest: dict[str, Any] = field(repr=False)


class DocumentParserAdapter(ABC):
    name: str

    @abstractmethod
    def ingest(self, source_path: Path, artifact_root: Path, options: dict[str, Any]) -> IngestResult:
        raise NotImplementedError
