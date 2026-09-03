from __future__ import annotations

from pathlib import Path
from typing import Any

def _page_index_from_item(item: Any) -> int:
    prov = getattr(item, "prov", None) or []
    if prov:
        page_no = getattr(prov[0], "page_no", None)
        if isinstance(page_no, int):
            return max(page_no - 1, 0)
    page_no = getattr(item, "page_no", None)
    if isinstance(page_no, int):
        return max(page_no - 1, 0)
    return 0

def _item_kind(item: Any, default: str = "paragraph") -> str:
    name = type(item).__name__
    if "Table" in name:
        return "table"
    if "Picture" in name or "Image" in name:
        return "image"
    if "SectionHeader" in name or "Title" in name:
        return "section"
    label = str(getattr(item, "label", "") or "").lower()
    if "table" in label:
        return "table"
    if "picture" in label or "figure" in label:
        return "image"
    if "title" in label or "header" in label or "section" in label:
        return "section"
    return default

def _item_text(item: Any, doc: Any) -> str:
    text = getattr(item, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()

    if _item_kind(item) == "table":
        export_df = getattr(item, "export_to_dataframe", None)
        if callable(export_df):
            try:
                frame = export_df(doc=doc)
                return frame.to_markdown(index=False)
            except TypeError:
                try:
                    frame = export_df()
                    return frame.to_markdown(index=False)
                except Exception:
                    pass
            except Exception:
                pass

    return ""

def _save_pil_image(image: Any, dest: Path) -> bool:
    save = getattr(image, "save", None)
    if not callable(save):
        return False
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        mode = getattr(image, "mode", None)
        if mode and mode not in {"RGB", "L"}:
            convert = getattr(image, "convert", None)
            if callable(convert):
                image = convert("RGB")
        save(dest, format="PNG")
        return dest.is_file() and dest.stat().st_size > 0
    except Exception:
        return False

def _item_image(item: Any, doc: Any) -> Any:
    getter = getattr(item, "get_image", None)
    if not callable(getter):
        return getattr(item, "image", None)
    try:
        return getter(doc)
    except TypeError:
        try:
            return getter()
        except Exception:
            return None
    except Exception:
        return None

def _page_image(doc: Any, page_index: int) -> Any:
    pages = getattr(doc, "pages", None) or {}
    if not isinstance(pages, dict):
        return None
    page = pages.get(page_index + 1)
    if page is None:
        page = pages.get(page_index)
    if page is None:
        return None
    getter = getattr(page, "get_image", None)
    if callable(getter):
        try:
            return getter(doc)
        except TypeError:
            try:
                return getter()
            except Exception:
                return getattr(page, "image", None)
        except Exception:
            return getattr(page, "image", None)
    return getattr(page, "image", None)

def _render_pdf_page(source_path: Path, page_index: int, dest: Path, *, scale: float = 2.0) -> bool:
    document = None
    try:
        import pypdfium2 as pdfium

        document = pdfium.PdfDocument(str(source_path))
        page = document[page_index]
        bitmap = page.render(scale=scale)
        image = bitmap.to_pil()
        return _save_pil_image(image, dest)
    except Exception:
        return False
    finally:
        if document is not None:
            close = getattr(document, "close", None)
            if callable(close):
                close()

def _save_page_image(
    doc: Any,
    page_index: int,
    images_dir: Path,
    source_path: Path,
    *,
    scale: float = 2.0,
    prefer_pdf_render: bool = False,
) -> str | None:
    dest = images_dir / f"page{page_index}.png"
    if not prefer_pdf_render:
        image = _page_image(doc, page_index)
        if image is not None and _save_pil_image(image, dest):
            return str(dest)
    if _render_pdf_page(source_path, page_index, dest, scale=scale):
        return str(dest)
    return None

def _page_render_scale(page: dict[str, Any]) -> float:
    if str(page.get("sourceType") or "") == "scan":
        return 3.0
    return 2.0
