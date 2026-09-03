from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Mapping

from artifact_store import sha256_file

from .native import _fill_native_widgets
from .overlay import _fill_overlay_fields
from .primitives import (
    PDF_FORM_SCHEMA_VERSION,
    _FILLABLE_FIELD_TYPES,
    _as_float,
    _as_string,
)
from .runtime import _pymupdf
from .template import _load_template, _value_for_field
from .verification import (
    _page_geometry_signature,
    _template_geometry_matches,
    _validate_template_fields,
    _normalized_match,
    _verify_pymupdf_output,
)

def fill_pdf_form(
    source_path: Path,
    template: Mapping[str, Any] | str | Path,
    values: Mapping[str, Any],
    output_path: Path,
    *,
    font_path: str | None = None,
) -> dict[str, Any]:
    if not source_path.is_file():
        raise FileNotFoundError("file_not_found")
    if not isinstance(values, Mapping):
        raise TypeError("values_object_required")
    source_hash = sha256_file(source_path)
    loaded = _load_template(template)
    if _as_float(loaded.get("schemaVersion"), -1) != PDF_FORM_SCHEMA_VERSION:
        raise ValueError("template_schema_invalid")
    if _as_string(loaded.get("coordinateSpace")) != "pdf-user-top-left-unrotated":
        raise ValueError("template_coordinate_space_invalid")
    template_source_hash = _as_string(loaded.get("sourceHash"))
    if not template_source_hash:
        raise ValueError("template_source_hash_required")
    if template_source_hash != source_hash:
        raise ValueError("template_source_mismatch")
    field_list = [field for field in loaded.get("fields") or [] if isinstance(field, Mapping)]
    by_key: dict[str, Mapping[str, Any]] = {}
    for field in field_list:
        for key in (_as_string(field.get("id")), _as_string(field.get("name"))):
            if key:
                by_key[key] = field
    unknown = [str(key) for key in values.keys() if str(key) not in by_key]
    if unknown:
        raise KeyError(f"field_not_found:{','.join(unknown)}")
    for field in field_list:
        value = _value_for_field(field, values)
        field_type = _as_string(field.get("type"))
        if value is not None and field_type not in _FILLABLE_FIELD_TYPES:
            raise ValueError(f"field_type_unsupported:{_as_string(field.get('name') or field.get('id'))}")
        if value is not None and field_type == "select":
            options = field.get("options")
            if isinstance(options, (list, tuple)) and options:
                requested_values = value if isinstance(value, (list, tuple)) else [value]
                allowed = {_normalized_match(option) for option in options}
                if any(_normalized_match(item) not in allowed for item in requested_values):
                    raise ValueError(f"field_option_invalid:{_as_string(field.get('name') or field.get('id'))}")
    output_path = output_path.resolve()
    if output_path == source_path.resolve():
        raise ValueError("source_overwrite_forbidden")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf = _pymupdf()
    document = pdf.open(str(source_path))
    page_count = len(document)
    template_page_count = loaded.get("pageCount")
    if template_page_count is None:
        document.close()
        raise ValueError("template_page_count_required")
    if _as_float(template_page_count, -1) != page_count:
        document.close()
        raise ValueError("template_page_count_mismatch")
    page_geometry = _page_geometry_signature(document)
    if not _template_geometry_matches(loaded, page_geometry):
        document.close()
        raise ValueError("template_page_geometry_mismatch")
    try:
        _validate_template_fields(field_list, page_geometry)
    except Exception:
        document.close()
        raise
    is_acroform = _as_string(loaded.get("mode")) == "acroform" or any(
        _as_string(field.get("source")) == "acroform" for field in field_list
    )
    temporary_path: Path | None = None
    try:
        if is_acroform:
            _fill_native_widgets(document, loaded, values)
        else:
            _fill_overlay_fields(document, loaded, values, font_path=font_path)

        with tempfile.NamedTemporaryFile(
            dir=output_path.parent,
            prefix=f".{output_path.stem}-",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
        document.save(str(temporary_path), garbage=4, deflate=True)
    except Exception:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise
    finally:
        document.close()

    if temporary_path is None:
        raise RuntimeError("pdf_output_temp_missing")
    try:
        _verify_pymupdf_output(
            temporary_path,
            loaded,
            values,
            page_count=page_count,
            page_geometry=page_geometry,
            interactive=is_acroform,
            source_path=source_path,
        )
        if sha256_file(source_path) != source_hash:
            raise ValueError("source_changed_during_fill")
        temporary_path.replace(output_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    output_hash = sha256_file(output_path)
    return {
        "sourcePath": str(source_path),
        "outputPath": str(output_path),
        "sourceHash": source_hash,
        "outputHash": output_hash,
        "pageCount": page_count,
        "fieldCount": len(values),
        "writerEngine": "pymupdf",
        "verified": True,
        "interactive": is_acroform,
        "sourceUnchanged": sha256_file(source_path) == source_hash,
    }
