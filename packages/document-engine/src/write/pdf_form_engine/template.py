from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Mapping

from artifact_store import artifact_dir, sha256_file
from ax_paths import default_template_root

from .analysis import analyze_pdf_form
from .primitives import _as_string

def persist_pdf_form_template(
    source_path: Path,
    template_root: Path | None = None,
    options: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    template = analyze_pdf_form(source_path, options)
    root = artifact_dir(template_root or default_template_root(), str(template["templateId"]))
    root.mkdir(parents=True, exist_ok=True)
    original_pdf = root / "original.pdf"
    template_path = root / "template.json"
    if not original_pdf.exists() or sha256_file(original_pdf) != template["sourceHash"]:
        shutil.copy2(source_path, original_pdf)
    template["artifactPath"] = str(root)
    template["originalPdfPath"] = str(original_pdf)
    template["templatePath"] = str(template_path)
    template_path.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
    return template

def _load_template(template: Mapping[str, Any] | str | Path) -> dict[str, Any]:
    if isinstance(template, Mapping):
        return dict(template)
    path = Path(str(template))
    if not path.is_file():
        raise FileNotFoundError("template_not_found")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("template_invalid")
    return value

def _value_for_field(field: Mapping[str, Any], values: Mapping[str, Any]) -> Any:
    field_id = _as_string(field.get("id"))
    name = _as_string(field.get("name"))
    if field_id in values:
        return values[field_id]
    if name in values:
        return values[name]
    return None
