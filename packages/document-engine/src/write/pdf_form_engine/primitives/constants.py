from __future__ import annotations

import re

PDF_FORM_SCHEMA_VERSION = 1
_PLACEHOLDER_RE = re.compile(r"(?:\[\[([^\]]+)\]\]|\{\{([^}]+)\}\})")
_TRUTHY = {"1", "true", "yes", "y", "on", "checked", "예", "네"}
_FILLABLE_FIELD_TYPES = {"text", "textarea", "date", "number", "checkbox", "radio", "select"}
