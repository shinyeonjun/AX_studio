from __future__ import annotations

import base64
import io
import re
from html import escape
from pathlib import Path
from typing import Any

from .contracts import _ROUNDTRIP_PRINT_STYLE


def _tag_content(markup: str, tag: str) -> str:
    match = re.search(rf"<{tag}\b[^>]*>(.*?)</{tag}>", markup, flags=re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else markup.strip()


def _html_styles(markup: str) -> str:
    return "\n".join(
        re.findall(r"<style\b[^>]*>.*?</style>", markup, flags=re.IGNORECASE | re.DOTALL),
    )


def _has_html_content(fragment: str) -> bool:
    without_tags = re.sub(r"<[^>]+>", "", fragment)
    return bool(without_tags.strip()) or bool(re.search(r"<(?:img|table|svg)\b", fragment, re.IGNORECASE))


def _pdf_image_html(image_ref: Any) -> str | None:
    image = getattr(image_ref, "image", None)
    payload: bytes | None = None
    if image is not None:
        save = getattr(image, "save", None)
        if callable(save):
            buffer = io.BytesIO()
            try:
                save(buffer, format="PNG")
                payload = buffer.getvalue()
            except Exception:
                payload = None
    if not payload:
        raw = getattr(image_ref, "data", None)
        if isinstance(raw, bytes):
            payload = raw
    if not payload:
        return None

    encoded = base64.b64encode(payload).decode("ascii")
    name = escape(str(getattr(image_ref, "name", "source image") or "source image"), quote=True)
    return f'<figure class="ax-source-image"><img alt="{name}" src="data:image/png;base64,{encoded}"/></figure>'


def _page_source_images(page: Any) -> list[str]:
    output: list[str] = []
    for image_ref in getattr(page, "images", []) or []:
        markup = _pdf_image_html(image_ref)
        if markup:
            output.append(markup)
    return output


def _roundtrip_html(source_path: Path, doc: Any, page_count: int) -> str:
    from docling_core.types.doc import ImageRefMode
    from pypdf import PdfReader

    export_html = getattr(doc, "export_to_html", None)
    if not callable(export_html):
        raise RuntimeError("docling_export_to_html_unavailable")

    page_exports: list[str] = []
    styles = ""
    reader = PdfReader(str(source_path))
    for page_no in range(1, page_count + 1):
        try:
            exported = export_html(
                page_no=page_no,
                image_mode=ImageRefMode.EMBEDDED,
                html_lang="ko",
                split_page_view=False,
            )
        except TypeError as error:
            raise RuntimeError("docling_export_to_html_roundtrip_options_unavailable") from error
        except (IndexError, KeyError, ValueError):
            # Keep the source page in the HTML even when Docling has no
            # structural representation for an image-only or blank page.
            exported = "<body></body>"

        if not styles:
            styles = _html_styles(exported)
        fragment = _tag_content(exported, "body")
        source_images = _page_source_images(reader.pages[page_no - 1])
        embedded_images = len(
            re.findall(
                r'<img\b[^>]+src=["\']data:image/',
                fragment,
                flags=re.IGNORECASE,
            )
        )
        if embedded_images < len(source_images):
            fragment = "\n".join(part for part in [fragment, *source_images] if part.strip())
        if not _has_html_content(fragment):
            fragment = '<p class="ax-empty-page" aria-label="빈 페이지"></p>'
        page_exports.append(
            f'<section class="ax-pdf-page" data-page-index="{page_no - 1}" contenteditable="true">'
            f"{fragment}</section>"
        )

    title = escape(source_path.stem)
    return (
        "<!DOCTYPE html>\n"
        '<html lang="ko">\n<head>\n<meta charset="UTF-8"/>\n'
        f"<title>{title}</title>\n"
        f"{styles}\n{_ROUNDTRIP_PRINT_STYLE}\n"
        "</head>\n<body>\n"
        + "\n".join(page_exports)
        + "\n</body>\n</html>"
    )
