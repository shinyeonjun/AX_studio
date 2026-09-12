"""Canonical AcroForm values and their independently rendered appearances."""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Any, Mapping

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (ArrayObject, BooleanObject, DecodedStreamObject, DictionaryObject,
                           NameObject, NumberObject, RectangleObject, TextStringObject)
from reportlab.pdfgen import canvas

from .fonts import _draw_text
from .primitives import (_as_string, _field_rect, _form_field_type, _inherited,
                         _object, _qualified_field_name, _widget_export_value)


def prepare_form(writer: PdfWriter) -> None:
    """Repair only unambiguous orphaned field roots, never duplicate a field name."""
    form = writer.root_object.get('/AcroForm')
    if form is None:
        form = DictionaryObject({NameObject('/Fields'): ArrayObject()})
        writer.root_object[NameObject('/AcroForm')] = writer._add_object(form)
    form = _object(form)
    if '/XFA' in form:
        raise ValueError('xfa_form_unsupported')
    roots = form.setdefault(NameObject('/Fields'), ArrayObject())
    reachable: set[int] = set()
    named: dict[str, int] = {}

    def visit(reference: Any) -> None:
        field = _object(reference)
        if id(field) in reachable:
            return
        reachable.add(id(field))
        if field.get('/T') is not None:
            name = _qualified_field_name(field)
            if name in named and named[name] != id(field):
                raise ValueError('ambiguous_form_field:' + name)
            named[name] = id(field)
        if _inherited(field, '/FT') == '/Sig' and _inherited(field, '/V'):
            raise ValueError('signed_pdf_edit_forbidden')
        for child in field.get('/Kids') or []:
            visit(child)

    for root in roots:
        visit(root)
    for page in writer.pages:
        for reference in page.get('/Annots') or []:
            widget = _object(reference)
            if widget.get('/Subtype') != '/Widget' or id(widget) in reachable:
                continue
            root = widget
            seen: set[int] = set()
            while root.get('/Parent') is not None:
                if id(root) in seen:
                    raise ValueError('cyclic_form_field')
                seen.add(id(root))
                root = _object(root['/Parent'])
            name = _qualified_field_name(widget)
            if name in named or id(root) in reachable:
                raise ValueError('ambiguous_form_field:' + name)
            roots.append(root.indirect_reference or writer._add_object(root))
            visit(root)
    form[NameObject('/NeedAppearances')] = BooleanObject(False)


@dataclass
class FormWidget:
    raw: Any
    page_height: float

    @property
    def field_name(self) -> str:
        return _qualified_field_name(self.raw)

    @property
    def rect(self) -> tuple[float, float, float, float]:
        rect = _field_rect(self.raw.get('/Rect'), self.page_height)
        if rect is None:
            raise ValueError('native_field_rect_invalid')
        return rect['x'], rect['y'], rect['x'] + rect['width'], rect['y'] + rect['height']

    @property
    def canonical(self) -> Any:
        current = self.raw
        seen: set[int] = set()
        while current.get('/T') is None and current.get('/Parent') is not None:
            if id(current) in seen:
                raise ValueError('cyclic_form_field')
            seen.add(id(current))
            current = _object(current['/Parent'])
        return current

    @property
    def field_value(self) -> Any:
        if _form_field_type(self.raw) in {'radio', 'checkbox'}:
            return self.raw.get('/AS', '/Off')
        return _inherited(self.raw, '/V') or ''

    def on_state(self) -> str:
        value = _widget_export_value(self.raw)
        if not value:
            raise ValueError('native_button_appearance_missing:' + self.field_name)
        return '/' + value

    def write_value(self, writer: PdfWriter, value: Any, field: Mapping[str, Any],
                    font_path: str | None) -> None:
        if _form_field_type(self.raw) in {'checkbox', 'radio'}:
            state = NameObject(str(value) if value is not False else '/Off')
            normal = _object((_object(self.raw.get('/AP')) or {}).get('/N'))
            if not isinstance(normal, DictionaryObject) or state not in normal:
                raise ValueError('native_button_appearance_missing:' + self.field_name)
            self.raw[NameObject('/AS')] = state
            self.canonical[NameObject('/V')] = state
            return
        stored = (ArrayObject([TextStringObject(str(v)) for v in value]) if isinstance(value, (list, tuple))
                  else TextStringObject(str(value)))
        self.canonical[NameObject('/V')] = stored
        if '/V' in self.raw:
            self.raw[NameObject('/V')] = stored
        x0, y0, x1, y1 = self.rect
        width, height = x1 - x0, y1 - y0
        memory = BytesIO()
        drawing = canvas.Canvas(memory, pagesize=(width, height))
        mk = _object(self.raw.get('/MK')) or {}
        background, border = mk.get('/BG'), mk.get('/BC')
        for color, fill in ((background, True), (border, False)):
            if color:
                values = [float(c) for c in color]
                rgb = values * 3 if len(values) == 1 else values[:3]
                if len(rgb) == 3:
                    if fill:
                        drawing.setFillColorRGB(*rgb)
                    else:
                        drawing.setStrokeColorRGB(*rgb)
                    drawing.rect(0.5, 0.5, width - 1, height - 1, stroke=int(not fill), fill=int(fill))
        requested = value if isinstance(value, (list, tuple)) else [value]
        options = _inherited(self.raw, '/Opt') or []
        display_values = {str(option[0]): str(option[1]) for option in options
                          if isinstance(option, (list, tuple)) and len(option) >= 2}
        text = '\n'.join(display_values.get(str(v), str(v)) for v in requested)
        try:
            _draw_text(drawing, (2, 2, width - 2, height - 2),
                       {**field, 'align': {0: 'left', 1: 'center', 2: 'right'}.get(int(_inherited(self.raw, '/Q') or 0), 'left')},
                       text, page_height=height, font_path=font_path)
        except ValueError as error:
            if str(error) in {'font_glyph_missing', 'unicode_font_required'}:
                raise ValueError('output_text_render_verification_failed:' + self.field_name) from error
            raise
        drawing.showPage()
        drawing.save()
        appearance = PdfReader(memory).pages[0]
        stream = DecodedStreamObject()
        stream.set_data(appearance.get_contents().get_data())
        stream.update({NameObject('/Type'): NameObject('/XObject'), NameObject('/Subtype'): NameObject('/Form'),
                       NameObject('/FormType'): NumberObject(1), NameObject('/BBox'): RectangleObject((0, 0, width, height)),
                       NameObject('/Resources'): appearance['/Resources'].clone(writer)})
        self.raw[NameObject('/AP')] = DictionaryObject({NameObject('/N'): writer._add_object(stream)})
        # Keep /DA resolvable for subsequent interactive editing, not merely
        # the current /AP. Use unique names in the form-wide font dictionary.
        fonts = [operands for operands, operator in appearance.get_contents().operations if operator == b'Tf']
        if fonts:
            font_name, size = fonts[-1]
            font = stream['/Resources']['/Font'].raw_get(font_name)
            name = NameObject('/AxEditable' + str(font.idnum))
            form = writer.root_object['/AcroForm']
            resources = form.setdefault(NameObject('/DR'), DictionaryObject())
            resources.setdefault(NameObject('/Font'), DictionaryObject())[name] = font
            default_appearance = TextStringObject(f'{name} {size} Tf 0 g')
            self.canonical[NameObject('/DA')] = default_appearance
            self.raw[NameObject('/DA')] = default_appearance


def appearance_pdf(widget: FormWidget) -> bytes:
    """Expose the saved appearance without generating or repairing its content."""
    normal = _object(_object(widget.raw.get('/AP') or {}).get('/N'))
    if isinstance(normal, DictionaryObject) and not hasattr(normal, 'get_data'):
        normal = _object(normal.get(widget.raw.get('/AS', '/Off')))
    if normal is None or not hasattr(normal, 'get_data') or not normal.get_data():
        raise ValueError('output_appearance_missing:' + widget.field_name)
    writer = PdfWriter()
    bbox = normal.get('/BBox') or (0, 0, widget.rect[2] - widget.rect[0], widget.rect[3] - widget.rect[1])
    page = writer.add_blank_page(float(bbox[2]) - float(bbox[0]), float(bbox[3]) - float(bbox[1]))
    page[NameObject('/MediaBox')] = RectangleObject(bbox)
    page[NameObject('/Resources')] = _object(normal.get('/Resources') or DictionaryObject()).clone(writer)
    content = DecodedStreamObject()
    content.set_data(normal.get_data())
    page[NameObject('/Contents')] = writer._add_object(content)
    buffer = BytesIO()
    writer.write(buffer)
    writer.close()
    return buffer.getvalue()
