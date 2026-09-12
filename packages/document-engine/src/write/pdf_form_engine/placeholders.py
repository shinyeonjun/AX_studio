"""Remove selected placeholder glyphs without painting over source content.

Text advances are retained as TJ spacing, so neighbouring labels and suffixes
stay at their original positions. Fonts are decoded by the pinned pypdf parser;
unresolved tokens fail closed rather than yielding an apparently filled PDF.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Mapping

from pypdf._font import Font
from pypdf.generic import (ArrayObject, ByteStringObject, ContentStream, DictionaryObject,
                           FloatObject, NameObject, TextStringObject)

from .primitives import _object
from .primitives.constants import _PLACEHOLDER_RE

_IDENTITY = (1., 0., 0., 1., 0., 0.)


def _multiply(a: tuple, b: tuple) -> tuple:
    return (a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3],
            a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3],
            a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5])


@dataclass
class _State:
    cm: tuple = _IDENTITY
    tm: tuple = _IDENTITY
    line: tuple = _IDENTITY
    font: Font | None = None
    size: float = 12.
    leading: float = 0.
    char_space: float = 0.
    word_space: float = 0.
    scale: float = 1.
    rise: float = 0.


@dataclass
class _Glyph:
    text: str
    raw: bytes
    spacing: float
    point: tuple[float, float]
    removed: bool = False


def remove_placeholders(page: Any, writer: Any, fields: list[Mapping[str, Any]]) -> None:
    pending = list(fields)
    height = float(page.mediabox.height)

    def rewrite(source: Any, resources: Any, initial: _State, ancestors: set[int]) -> ContentStream:
        if id(source) in ancestors or len(ancestors) >= 32:
            raise ValueError("cyclic_pdf_content")
        ancestors = ancestors | {id(source)}
        stream = ContentStream(source, writer, "bytes")
        state = replace(initial)
        stack: list[_State] = []
        runs: list[tuple[list, bytes]] = []
        glyphs: list[_Glyph] = []
        # Each show operation becomes one TJ array; glyphs remain mutable until
        # tokens spanning consecutive Tj/TJ operations have been resolved.
        font_cache: dict[str, Font] = {}

        def move_line(x: float, y: float) -> None:
            state.line = _multiply((1, 0, 0, 1, x, y), state.line)
            state.tm = state.line

        def advance(distance: float) -> None:
            state.tm = _multiply((1, 0, 0, 1, distance, 0), state.tm)

        def show(parts: list) -> list:
            result: list = []
            for part in parts:
                if not isinstance(part, (bytes, str)):
                    result.append(part)
                    advance(-float(part) * state.size * state.scale / 1000)
                    continue
                if state.font is None or state.size <= 0:
                    raise ValueError("placeholder_font_unresolved")
                raw = part.original_bytes if isinstance(part, TextStringObject) else bytes(part)
                font = state.font
                encoding = font.encoding
                if isinstance(encoding, str):
                    decoded = raw.decode(encoding, errors="strict")
                    units = [(ch, ch.encode(encoding)) for ch in decoded]
                    if b"".join(unit for _, unit in units) != raw:
                        raise ValueError("placeholder_encoding_unsupported")
                else:
                    units = [(encoding.get(code, chr(code)), bytes([code])) for code in raw]
                for code, unit in units:
                    text = str(font.character_map.get(code, code))
                    width_key = chr(int.from_bytes(unit, "big"))
                    width = font.character_widths.get(width_key, font.character_widths.get("default", 500))
                    spacing = width + (state.char_space + (state.word_space if unit == b" " else 0)) * 1000 / state.size
                    matrix = _multiply(state.tm, state.cm)
                    point = (matrix[4] + state.rise * matrix[2], height - matrix[5] - state.rise * matrix[3])
                    glyph = _Glyph(text, unit, spacing, point)
                    glyphs.append(glyph)
                    result.append(glyph)
                    advance(spacing * state.size * state.scale / 1000)
            return result

        for operands, operator in stream.operations:
            if operator == b"q":
                stack.append(replace(state))
            elif operator == b"Q":
                if stack:
                    # Text matrices are not part of the saved graphics state.
                    tm, line = state.tm, state.line
                    state = stack.pop()
                    state.tm, state.line = tm, line
            elif operator == b"cm":
                state.cm = _multiply(tuple(float(v) for v in operands), state.cm)
            elif operator == b"BT":
                state.tm = state.line = _IDENTITY
                glyphs.append(_Glyph("\n", b"", 0, (0, 0)))
            elif operator == b"Tf":
                name = str(operands[0])
                if name not in font_cache:
                    font_cache[name] = Font.from_font_resource(_object(resources["/Font"][name]))
                state.font, state.size = font_cache[name], float(operands[1])
            elif operator == b"Tm":
                state.tm = state.line = tuple(float(v) for v in operands)
                glyphs.append(_Glyph("\n", b"", 0, (0, 0)))
            elif operator in {b"Td", b"TD"}:
                if operator == b"TD":
                    state.leading = -float(operands[1])
                move_line(float(operands[0]), float(operands[1]))
                if float(operands[1]):
                    glyphs.append(_Glyph("\n", b"", 0, (0, 0)))
            elif operator == b"T*":
                move_line(0, -state.leading)
                glyphs.append(_Glyph("\n", b"", 0, (0, 0)))
            elif operator in {b"Tc", b"Tw", b"TL", b"Ts", b"Tz"}:
                attr = {b"Tc": "char_space", b"Tw": "word_space", b"TL": "leading",
                        b"Ts": "rise", b"Tz": "scale"}[operator]
                setattr(state, attr, float(operands[0]) / (100 if operator == b"Tz" else 1))
            elif operator == b"Do":
                objects = _object(resources.get("/XObject") or {})
                child = _object(objects.get(operands[0]))
                if child and child.get("/Subtype") == "/Form":
                    # One copy per invocation avoids changing other uses of a
                    # shared XObject when only one field id was requested.
                    child_resources = DictionaryObject(_object(child.get("/Resources") or resources))
                    child_state = replace(state, cm=_multiply(tuple(child.get("/Matrix", _IDENTITY)), state.cm))
                    rewritten = rewrite(child, child_resources, child_state, ancestors)
                    rewritten.update({k: v for k, v in child.items() if k not in {"/Length", "/Filter", "/DecodeParms", "/Resources"}})
                    rewritten[NameObject("/Resources")] = child_resources
                    objects = DictionaryObject(objects)
                    name = NameObject("/AxPlaceholder" + str(len(objects)))
                    objects[name] = writer._add_object(rewritten)
                    resources[NameObject("/XObject")] = objects
                    operands = [name]
            if operator in {b"Tj", b"TJ", b"'", b'"'}:
                if operator in {b"'", b'"'}:
                    if operator == b'"':
                        state.word_space, state.char_space = float(operands[0]), float(operands[1])
                        runs.extend([([operands[0]], b"Tw"), ([operands[1]], b"Tc")])
                    move_line(0, -state.leading)
                    glyphs.append(_Glyph("\n", b"", 0, (0, 0)))
                    runs.append(([], b"T*"))
                parts = operands[0] if operator == b"TJ" else [operands[-1]]
                runs.append(([show(parts)], b"TJ"))
            else:
                runs.append((operands, operator))

        text = "".join(g.text for g in glyphs)
        offsets: list[_Glyph] = [g for g in glyphs for _ in g.text]
        for match in _PLACEHOLDER_RE.finditer(text):
            name = (match.group(1) or match.group(2)).strip()
            token = offsets[match.start():match.end()]
            x, y = token[0].point
            candidates = [field for field in pending if str(field.get("name")) == name
                          and float(field["rect"]["x"]) - 3 <= x <= float(field["rect"]["x"]) + float(field["rect"]["width"]) + 3
                          and float(field["rect"]["y"]) - 3 <= y <= float(field["rect"]["y"]) + float(field["rect"]["height"]) + 3]
            if not candidates:
                continue
            if len(candidates) != 1:
                raise ValueError("placeholder_region_ambiguous:" + name)
            for glyph in token:
                glyph.removed = True
            pending.remove(candidates[0])

        for operands, operator in runs:
            if operator != b"TJ":
                continue
            rebuilt = ArrayObject()
            buffer = bytearray()
            for item in operands[0]:
                if isinstance(item, _Glyph) and not item.removed:
                    buffer.extend(item.raw)
                else:
                    if buffer:
                        rebuilt.append(ByteStringObject(bytes(buffer)))
                        buffer.clear()
                    rebuilt.append(FloatObject(-item.spacing) if isinstance(item, _Glyph) else item)
            if buffer:
                rebuilt.append(ByteStringObject(bytes(buffer)))
            operands[0] = rebuilt
        stream.operations = runs
        return stream

    resources = DictionaryObject(_object(page["/Resources"]))
    rewritten = rewrite(page.get_contents(), resources, _State(), set())
    if pending:
        raise ValueError("placeholder_not_removed:" + ",".join(str(field["name"]) for field in pending))
    page[NameObject("/Resources")] = resources
    page[NameObject("/Contents")] = writer._add_object(rewritten)
