from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from korean_ocr import ocr_image_path

_GARBAGE_OCR_RE = re.compile(r"[\u4e00-\u9fff\u053f\u00f4\u00e0\u00e2\u00f1\u00e3\u00e1]")
_AMOUNT_LINE_RE = re.compile(r"[\d,]+원")

def _looks_like_garbage_ocr(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if _GARBAGE_OCR_RE.search(stripped):
        return True
    # Latin-only native text is valid text, not failed Korean OCR. The ratio
    # check is only meaningful when the page actually contains Hangul.
    if not re.search(r"[��-�R]", stripped):
        return False
    hangul = len(re.findall(r"[��-�R]", stripped))
    return hangul < max(3, len(stripped) // 8) and len(stripped) > 20

def _table_like_ocr_excerpt(ocr_text: str) -> str:
    lines = [line.strip() for line in ocr_text.splitlines() if line.strip()]
    if not lines:
        return ""

    start = 0
    for index, line in enumerate(lines):
        if re.search(r"(CloudOps|���꼭)", line):
            start = index
            break

    scoped = lines[start:]
    amount_indices = [index for index, line in enumerate(scoped) if _AMOUNT_LINE_RE.search(line)]
    if not amount_indices:
        return ""

    picked: list[str] = []
    seen: set[str] = set()
    for index in amount_indices:
        amount_line = scoped[index]
        if amount_line not in seen:
            seen.add(amount_line)
            picked.append(amount_line)
        if index == 0:
            continue
        label = scoped[index - 1]
        if label in seen:
            continue
        if len(label) > 48 or re.search(r"(�޸�|Ȯ��|�׽�Ʈ|����)", label):
            continue
        if _AMOUNT_LINE_RE.search(label):
            continue
        seen.add(label)
        picked.insert(len(picked) - 1, label)

    if start > 0 and lines[start] not in seen:
        picked.insert(0, lines[start])
    return "\n".join(picked)

def _backfill_empty_tables(tables: list[dict[str, Any]], images: list[dict[str, Any]]) -> None:
    ocr_by_page: dict[int, list[str]] = {}
    for image in images:
        page_index = int(image.get("pageIndex", -1))
        ocr_text = str(image.get("ocrText") or "").strip()
        if ocr_text:
            ocr_by_page.setdefault(page_index, []).append(ocr_text)

    for table in tables:
        if str(table.get("text") or "").strip():
            continue
        page_index = int(table.get("pageIndex", -1))
        for ocr_text in ocr_by_page.get(page_index, []):
            excerpt = _table_like_ocr_excerpt(ocr_text)
            if len(excerpt) >= 20:
                table["text"] = excerpt
                table["sourceType"] = "ocr"
                break

def _apply_korean_ocr(
    pages: list[dict[str, Any]],
    chunks: list[dict[str, Any]],
    images: list[dict[str, Any]],
    ocr_mode: str,
    chunk_index_start: int,
) -> tuple[list[int], list[int], int]:
    visual_pages: list[int] = []
    ocr_pages: list[int] = []
    chunk_index = chunk_index_start

    for page in pages:
        index = int(page["index"])
        source_type = str(page.get("sourceType") or "native")
        if source_type in {"image", "scan", "mixed"}:
            visual_pages.append(index)

        if ocr_mode == "off":
            continue
        if ocr_mode == "auto" and source_type == "native":
            continue
        if ocr_mode == "auto" and source_type == "image":
            continue

        if source_type == "scan":
            image_path = page.get("imagePath")
            if not image_path:
                continue
            text, confidence = ocr_image_path(Path(str(image_path)))
            if text:
                page["text"] = text
                page["ocrApplied"] = True
                page["ocrConfidence"] = confidence
                chunks.append(
                    {
                        "id": f"c{chunk_index}",
                        "pageIndex": index,
                        "kind": "ocr_page",
                        "text": text,
                        "sourceType": "ocr",
                    }
                )
                chunk_index += 1
                ocr_pages.append(index)
            continue

        if source_type == "mixed":
            page_ocr_applied = False
            for image in images:
                if int(image.get("pageIndex", -1)) != index:
                    continue
                image_path = image.get("path")
                if not image_path:
                    continue
                text, confidence = ocr_image_path(Path(str(image_path)))
                if not text:
                    continue
                image["ocrText"] = text
                image["ocrConfidence"] = confidence
                chunks.append(
                    {
                        "id": f"c{chunk_index}",
                        "pageIndex": index,
                        "kind": "ocr_image",
                        "text": text,
                        "sourceType": "ocr",
                        "imageId": image.get("id"),
                    }
                )
                chunk_index += 1
                page_ocr_applied = True
            if not page_ocr_applied:
                image_path = page.get("imagePath")
                if image_path:
                    text, confidence = ocr_image_path(Path(str(image_path)))
                    if text:
                        page["ocrApplied"] = True
                        page["ocrConfidence"] = confidence
                        chunks.append(
                            {
                                "id": f"c{chunk_index}",
                                "pageIndex": index,
                                "kind": "ocr_image",
                                "text": text,
                                "sourceType": "ocr",
                            }
                        )
                        chunk_index += 1
                        page_ocr_applied = True
            if page_ocr_applied:
                page["ocrApplied"] = True
                ocr_pages.append(index)
            continue

        if ocr_mode == "force" and source_type == "image":
            image_path = page.get("imagePath")
            if not image_path:
                continue
            text, confidence = ocr_image_path(Path(str(image_path)))
            if text:
                chunks.append(
                    {
                        "id": f"c{chunk_index}",
                        "pageIndex": index,
                        "kind": "ocr_image",
                        "text": text,
                        "sourceType": "ocr",
                    }
                )
                chunk_index += 1
                page["ocrApplied"] = True
                page["ocrConfidence"] = confidence
                ocr_pages.append(index)

    return sorted(set(visual_pages)), sorted(set(ocr_pages)), chunk_index
