"""Last period's Word report as the form for this period's: list its text, mark its values, fill.

A .docx is XML, so a value is replaced where it sits in the text and keeps its run's formatting.
The report pipeline sees the same shape as for a PDF (scalar slots and repeating table rows), but
nothing here has page coordinates: table rows are cloned or removed in the document's own flow.

Only the standard library is used. ElementTree drops namespace declarations it does not need, and
Word refuses a part whose ``mc:Ignorable`` names an undeclared prefix, so every part keeps its
original prolog and root start tag.
"""
from __future__ import annotations

import copy
import hashlib
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Mapping

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
_P, _T, _TAB, _BR, _TBL, _TR, _TC = (f"{{{W}}}{name}" for name in ("p", "t", "tab", "br", "tbl", "tr", "tc"))
_TEXT_PART = re.compile(r"^word/(document|header\d*|footer\d*)\.xml$")
_TOKEN = re.compile(r"\{\{ax:([A-Za-z0-9_-]+)\}\}")
_MAX_SPANS = 2_000
# Every part is read into memory: a small file that unpacks huge is refused, not expanded.
_MAX_UNPACKED_BYTES = 256 * 1024 * 1024
_PAGE = {"index": 0, "width": 595.0, "height": 842.0, "rotation": 0}


@dataclass
class _Segment:
    element: ET.Element
    editable: bool


@dataclass
class _Paragraph:
    element: ET.Element
    part: str
    index: int
    segments: list[_Segment] = field(default_factory=list)
    table: int | None = None
    row: int | None = None
    column: int | None = None

    @property
    def text(self) -> str:
        return "".join((segment.element.text or "") if segment.editable else " " for segment in self.segments)


@dataclass
class _Part:
    name: str
    prolog: bytes
    root_tag: bytes
    root: ET.Element


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _register_namespaces(raw: bytes) -> None:
    for prefix, uri in re.findall(rb'xmlns:([A-Za-z_][\w.-]*)="([^"]*)"', raw):
        name = prefix.decode("utf-8")
        if not re.fullmatch(r"ns\d+", name):
            ET.register_namespace(name, uri.decode("utf-8"))


def _read_part(name: str, raw: bytes) -> _Part:
    _register_namespaces(raw)
    start = re.search(rb"<(?![?!])[^>]*>", raw)
    if not start:
        raise ValueError("report_docx_invalid")
    return _Part(name, raw[:start.start()], start.group(0), ET.fromstring(raw))


def _write_part(part: _Part) -> bytes:
    _register_namespaces(part.prolog + part.root_tag)
    body = ET.tostring(part.root, encoding="utf-8", xml_declaration=False)
    serialized_start = re.match(rb"<[^>]*>", body)
    if not serialized_start:
        raise ValueError("report_docx_invalid")
    root_tag = part.root_tag
    # Declarations that sat on inner elements are moved to the root by ElementTree; keep them too.
    declared = set(re.findall(rb'(xmlns(?::[\w.-]+)?)=', root_tag))
    extra = b"".join(
        b" " + match.group(0) for match in re.finditer(rb'(xmlns(?::[\w.-]+)?)="[^"]*"', serialized_start.group(0))
        if match.group(1) not in declared
    )
    closing = 2 if root_tag.endswith(b"/>") else 1
    root_tag = root_tag[:-closing] + extra + root_tag[-closing:]
    if body[serialized_start.end() - 2:serialized_start.end()] == b"/>" and not root_tag.endswith(b"/>"):
        root_tag = root_tag[:-1] + b"/>"
    return part.prolog + root_tag + body[serialized_start.end():]


def _open(path: Path) -> tuple[list[zipfile.ZipInfo], dict[str, bytes], list[_Part]]:
    if not path.is_file():
        raise ValueError("report_example_file_not_found")
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if sum(info.file_size for info in infos) > _MAX_UNPACKED_BYTES:
                raise ValueError("document_source_too_large")
            data = {info.filename: archive.read(info.filename) for info in infos}
    except zipfile.BadZipFile as error:
        raise ValueError("report_docx_invalid") from error
    if "word/document.xml" not in data:
        raise ValueError("report_docx_invalid")
    names = sorted((name for name in data if _TEXT_PART.match(name)), key=lambda name: (name != "word/document.xml", name))
    try:
        parts = [_read_part(name, data[name]) for name in names]
    except ET.ParseError as error:
        raise ValueError("report_docx_invalid") from error
    return infos, data, parts


def _save(infos: list[zipfile.ZipInfo], data: dict[str, bytes], parts: list[_Part], output_path: Path) -> None:
    replaced = {part.name: _write_part(part) for part in parts}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for info in infos:
            archive.writestr(info, replaced.get(info.filename, data[info.filename]))


def _own_segments(paragraph: ET.Element) -> Iterator[_Segment]:
    """Text of this paragraph only: a text box inside it holds paragraphs of its own."""
    stack = list(reversed(list(paragraph)))
    while stack:
        element = stack.pop()
        if element.tag == _P:
            continue
        if element.tag == _T:
            yield _Segment(element, True)
        elif element.tag in (_TAB, _BR):
            yield _Segment(element, False)
        else:
            stack.extend(reversed(list(element)))


def _paragraphs(part: _Part) -> list[_Paragraph]:
    found: list[_Paragraph] = []
    tables = 0

    def visit(element: ET.Element, table: int | None, row: int | None, column: int | None) -> None:
        nonlocal tables
        for child in element:
            if child.tag == _P:
                found.append(_Paragraph(child, part.name, len(found), list(_own_segments(child)), table, row, column))
                visit(child, table, row, column)
            elif child.tag == _TBL:
                tables += 1
                number = tables
                rows = [item for item in child if item.tag == _TR]
                for row_index, tr in enumerate(rows):
                    cells = [item for item in tr if item.tag == _TC]
                    for column_index, tc in enumerate(cells):
                        visit(tc, number, row_index, column_index)
            else:
                visit(child, table, row, column)

    visit(part.root, None, None, None)
    return found


def _part_label(part: str) -> str:
    if part == "word/document.xml":
        return "본문"
    kind = "머리글" if "header" in part else "바닥글"
    return kind


def _location(paragraph: _Paragraph) -> str:
    where = _part_label(paragraph.part)
    if paragraph.table is not None:
        return f"{where} 표{paragraph.table} {(paragraph.row or 0) + 1}행 {(paragraph.column or 0) + 1}열"
    return f"{where} 문단"


def _span_id(paragraph: _Paragraph) -> str:
    stem = Path(paragraph.part).stem
    return f"{stem}-p{paragraph.index}"


def _all_paragraphs(parts: list[_Part]) -> list[_Paragraph]:
    return [paragraph for part in parts for paragraph in _paragraphs(part)]


def list_docx_spans(example_path: Path) -> dict[str, Any]:
    """Each paragraph with text, in reading order, with where it sits (body, header, table cell)."""
    _, _, parts = _open(example_path)
    spans: list[dict[str, Any]] = []
    for order, paragraph in enumerate(item for item in _all_paragraphs(parts) if item.text.strip()):
        spans.append({
            "id": _span_id(paragraph),
            "pageIndex": 0,
            "text": paragraph.text,
            "rect": {"x": float(paragraph.column or 0), "y": float(order), "width": 1.0, "height": 1.0},
            "fontSize": 0,
            "location": _location(paragraph),
        })
        if len(spans) > _MAX_SPANS:
            raise ValueError("report_example_too_much_text")
    return {
        "schemaVersion": 1,
        "exampleHash": _sha256(example_path),
        "pageCount": 1,
        "pages": [_PAGE],
        "spans": spans,
        "exampleImages": [],
    }


def _occurrences(text: str, value: str) -> list[tuple[int, int]]:
    """Where ``value`` stands in ``text`` on its own: not the middle of a longer number."""
    found: list[tuple[int, int]] = []
    start = text.find(value)
    while start != -1:
        end = start + len(value)
        before = text[start - 1] if start > 0 else ""
        after = text[end] if end < len(text) else ""
        if not before.isdigit() and not after.isdigit():
            found.append((start, end))
            start = text.find(value, end)
        else:
            start = text.find(value, start + 1)
    return found


def _replace_range(paragraph: _Paragraph, start: int, end: int, replacement: str) -> bool:
    """Put ``replacement`` where text[start:end] is, in the run holding its first character."""
    offset = 0
    first: ET.Element | None = None
    for segment in paragraph.segments:
        length = len(segment.element.text or "") if segment.editable else 1
        seg_start, seg_end = offset, offset + length
        offset = seg_end
        if seg_end <= start or seg_start >= end:
            continue
        if not segment.editable:
            return False
        text = segment.element.text or ""
        cut_from, cut_to = max(start, seg_start) - seg_start, min(end, seg_end) - seg_start
        if first is None:
            segment.element.text = text[:cut_from] + replacement + text[cut_to:]
            first = segment.element
        else:
            segment.element.text = text[:cut_from] + text[cut_to:]
        segment.element.set(XML_SPACE, "preserve")
    return first is not None


def _tokenize(paragraph: _Paragraph, value: str, next_id: Iterator[str], example_texts: dict[str, str]) -> int:
    replaced = 0
    # Right to left, so earlier positions stay valid while later ones are replaced.
    for start, end in reversed(_occurrences(paragraph.text, value)):
        token_id = next(next_id)
        if not _replace_range(paragraph, start, end, "{{ax:" + token_id + "}}"):
            continue
        example_texts[token_id] = value
        replaced += 1
    return replaced


def _cell_signature(tr: ET.Element) -> tuple[tuple[int, str], ...]:
    signature = []
    for tc in (item for item in tr if item.tag == _TC):
        text = "".join(t.text or "" for t in tc.iter(_T))
        signature.append((len(_TOKEN.findall(text)), _TOKEN.sub("", text).strip()))
    return tuple(signature)


def _row_tokens(tr: ET.Element) -> list[str]:
    tokens = []
    for tc in (item for item in tr if item.tag == _TC):
        tokens.extend(_TOKEN.findall("".join(t.text or "" for t in tc.iter(_T))))
    return tokens


def _table_groups(parts: list[_Part]) -> list[list[list[str]]]:
    """Runs of two or more adjacent rows shaped alike, one value per cell: rows that repeat per item."""
    groups: list[list[list[str]]] = []
    for part in parts:
        for table in part.root.iter(_TBL):
            run: list[ET.Element] = []
            signature: tuple[tuple[int, str], ...] | None = None

            def close() -> None:
                if len(run) >= 2:
                    groups.append([_row_tokens(tr) for tr in run])

            for tr in (item for item in table if item.tag == _TR):
                current = _cell_signature(tr)
                repeating = any(count for count, _ in current) and all(count <= 1 for count, _ in current)
                if repeating and current == signature:
                    run.append(tr)
                    continue
                close()
                run, signature = ([tr], current) if repeating else ([], None)
            close()
    return groups


def _slot(token_id: str, order: int, column: int, example_text: str, location: str) -> dict[str, Any]:
    return {
        "id": token_id,
        "pageIndex": 0,
        "rect": {"x": float(column), "y": float(order), "width": 1.0, "height": 1.0},
        "exampleText": example_text,
        "fontSize": 0,
        "font": "",
        "color": 0,
        "location": location,
    }


def prepare_docx_report(
    example_path: Path,
    removals: list[Mapping[str, Any]],
    template_path: Path,
) -> dict[str, Any]:
    """Mark each removal's text with a slot token, then describe the slots like a PDF pair analysis."""
    if not removals:
        raise ValueError("report_values_required")
    infos, data, parts = _open(example_path)
    paragraphs = {_span_id(paragraph): paragraph for paragraph in _all_paragraphs(parts)}
    counter = (f"v{number}" for number in range(1, 1_000_000))
    example_texts: dict[str, str] = {}
    missing = 0
    # Longer values first, so "2026-09" is not split by an earlier "09".
    for removal in sorted(removals, key=lambda item: -len(str(item.get("text", "")))):
        span_id, value = removal.get("spanId"), removal.get("text")
        if not isinstance(span_id, str) or not isinstance(value, str) or not value.strip():
            raise ValueError("report_value_removal_invalid")
        paragraph = paragraphs.get(span_id)
        if paragraph is None or _tokenize(paragraph, value, counter, example_texts) == 0:
            missing += 1
    if missing:
        raise ValueError(f"report_value_not_removed:{missing}")
    _save(infos, data, parts, template_path)

    ordered = [paragraph for paragraph in _all_paragraphs(parts) if _TOKEN.search(paragraph.text)]
    order = {token: index for index, token in enumerate(token for p in ordered for token in _TOKEN.findall(p.text))}
    locations = {token: _location(p) for p in ordered for token in _TOKEN.findall(p.text)}
    columns = {token: p.column or 0 for p in ordered for token in _TOKEN.findall(p.text)}
    groups = _table_groups(parts)
    in_groups = {token for group in groups for row in group for token in row}
    scalar_slots = [
        _slot(token, order[token], columns[token], example_texts[token], locations[token])
        for token in sorted(order, key=order.__getitem__) if token not in in_groups
    ]
    table_groups = []
    for number, group in enumerate(groups, start=1):
        table_groups.append({
            "id": f"group-{number}",
            "columnCount": len(group[0]),
            "rowCount": len(group),
            "rows": [
                {"index": index, "pageIndex": 0, "y": float(order[row[0]]), "cells": [
                    _slot(token, order[token], column, example_texts[token], locations[token])
                    for column, token in enumerate(row)
                ]}
                for index, row in enumerate(group)
            ],
        })
    template_hash = _sha256(template_path)
    example_hash = _sha256(example_path)
    return {
        "templatePath": str(template_path),
        "pair": {
            "schemaVersion": 1,
            "pairId": hashlib.sha256(f"{template_hash}:{example_hash}".encode("utf-8")).hexdigest()[:24],
            "templateHash": template_hash,
            "exampleHash": example_hash,
            "pageCount": 1,
            "pages": [_PAGE],
            "layout": "flow",
            "scalarSlots": scalar_slots,
            "tableGroups": table_groups,
            "templateImages": [],
            "exampleImages": [],
        },
    }


def _find_row(parts: list[_Part], token: str) -> tuple[ET.Element, ET.Element] | None:
    needle = "{{ax:" + token + "}}"
    for part in parts:
        for table in part.root.iter(_TBL):
            for tr in (item for item in table if item.tag == _TR):
                if needle in "".join(t.text or "" for t in tr.iter(_T)):
                    return table, tr
    return None


def _rename_tokens(element: ET.Element, renames: Mapping[str, str]) -> None:
    for t in element.iter(_T):
        if t.text and "{{ax:" in t.text:
            t.text = _TOKEN.sub(lambda match: "{{ax:" + renames.get(match.group(1), match.group(1)) + "}}", t.text)


def fill_docx_report(
    template_path: Path,
    groups: list[Mapping[str, Any]],
    values: Mapping[str, Any],
    output_path: Path,
) -> dict[str, Any]:
    """Grow or shrink each repeating table to its rows, then put every value in place of its token."""
    infos, data, parts = _open(template_path)
    for group in groups:
        rows = group.get("rows")
        group_id = group.get("id")
        if not isinstance(rows, list) or not rows or not isinstance(group_id, str):
            raise ValueError("report_docx_group_invalid")
        last_tokens = [str(token) for token in rows[-1]]
        located = _find_row(parts, last_tokens[0]) if last_tokens else None
        if located is None:
            raise ValueError(f"report_docx_group_row_missing:{group_id}")
        table, last_row = located
        anchor = last_row
        row_index = len(rows)
        while True:
            renames = {token: f"overflow-{group_id}-{row_index}-{column}" for column, token in enumerate(last_tokens)}
            if renames[last_tokens[0]] not in values:
                break
            clone = copy.deepcopy(last_row)
            _rename_tokens(clone, renames)
            children = list(table)
            table.insert(children.index(anchor) + 1, clone)
            anchor = clone
            row_index += 1
        # A row is removed only when the report has no item for it: every value in it is empty.
        all_rows = [[str(token) for token in row] for row in rows]
        all_rows += [[f"overflow-{group_id}-{index}-{column}" for column in range(len(last_tokens))]
                     for index in range(len(rows), row_index)]
        for tokens in all_rows:
            if tokens and all(str(values.get(token, "")).strip() == "" for token in tokens):
                found = _find_row(parts, tokens[0])
                if found:
                    found[0].remove(found[1])

    missing: set[str] = set()

    def substitute(match: re.Match[str]) -> str:
        token = match.group(1)
        if token not in values:
            missing.add(token)
            return ""
        value = values[token]
        return "" if value is None else str(value)

    for part in parts:
        for t in part.root.iter(_T):
            if t.text and "{{ax:" in t.text:
                t.text = _TOKEN.sub(substitute, t.text)
                t.set(XML_SPACE, "preserve")
    if missing:
        raise ValueError(f"report_docx_value_missing:{len(missing)}")
    _save(infos, data, parts, output_path)

    _, _, written = _open(output_path)
    text = "".join(t.text or "" for part in written for t in part.root.iter(_T))
    verified = "{{ax:" not in text and all(
        str(value).strip() == "" or str(value) in text for value in values.values()
    )
    return {
        "outputPath": str(output_path),
        "outputHash": _sha256(output_path),
        "verified": verified,
        "fieldCount": len(values),
    }
