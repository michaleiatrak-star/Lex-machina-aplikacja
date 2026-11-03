"""Fields of a PDF form (AcroForm) and the same PDF with them filled in, on this computer.

read: PDF bytes (stdin) -> {"fields": [{"name", "type", "value", "options", "page", "label",
      "readOnly", "maxLength"}]}  (type: text | checkbox | radio | combo | list)
fill: {"dataBase64": ..., "values": {name: value}, "flatten": bool} (stdin) -> PDF bytes
      A checkbox takes true/false, a radio group the option chosen, a list or combo one of
      its options. "flatten" turns the fields into page content (no longer editable).

Errors on stderr (exit 2): PDF_FORM_INVALID, PDF_FORM_ENCRYPTED, PDF_FORM_NO_FIELDS,
PDF_FORM_UNKNOWN_FIELD:<name>, PDF_FORM_VALUE_INVALID:<name>, PDF_FORM_READ_ONLY:<name>.
"""
import base64
import json
import os
import sys

MAX_INPUT_BYTES = 128 * 1024 * 1024
MAX_VALUE = 20_000


def fail(code):
    sys.stderr.write(code + "\n")
    raise SystemExit(2)


def load():
    try:
        import pymupdf as fitz  # the old "fitz" name prints a warning on stdout
    except ImportError:
        import fitz
    return fitz


def open_pdf(fitz, data):
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:  # noqa: BLE001
        fail("PDF_FORM_INVALID")
    if doc.needs_pass:
        fail("PDF_FORM_ENCRYPTED")
    return doc


TYPES = {}


def kind(fitz, widget):
    if not TYPES:
        TYPES.update({
            fitz.PDF_WIDGET_TYPE_TEXT: "text",
            fitz.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
            fitz.PDF_WIDGET_TYPE_RADIOBUTTON: "radio",
            fitz.PDF_WIDGET_TYPE_COMBOBOX: "combo",
            fitz.PDF_WIDGET_TYPE_LISTBOX: "list",
        })
    return TYPES.get(widget.field_type)


def on_state(widget):
    """The "on" name of a checkbox or radio button (often "Yes", "Tak", "1" or the option)."""
    try:
        state = widget.on_state()
        if state:
            return str(state)
    except Exception:  # noqa: BLE001
        pass
    states = widget.button_states() or {}
    for value in (states.get("normal") or []) + (states.get("down") or []):
        if value != "Off":
            return str(value)
    return "Yes"


def read_fields(doc, fitz):
    fields = {}
    order = []
    for page in doc:
        for widget in page.widgets() or []:
            field_type = kind(fitz, widget)
            name = widget.field_name
            if not field_type or not name:
                continue
            readonly = bool(widget.field_flags & 1)
            if name not in fields:
                order.append(name)
                fields[name] = {
                    "name": name,
                    "type": field_type,
                    "value": None,
                    "options": [],
                    "page": page.number + 1,
                    "label": (widget.field_label or "").strip() or name,
                    "readOnly": readonly,
                }
                if field_type == "text" and widget.text_maxlen:
                    fields[name]["maxLength"] = widget.text_maxlen
            item = fields[name]
            if field_type == "checkbox":
                item["value"] = bool(widget.field_value) and widget.field_value not in ("Off", False)
            elif field_type == "radio":
                choice = on_state(widget)
                if choice not in item["options"]:
                    item["options"].append(choice)
                if widget.field_value not in (None, "", "Off", False):
                    item["value"] = choice if widget.field_value is True else str(widget.field_value)
            elif field_type in ("combo", "list"):
                item["options"] = [o[1] if isinstance(o, (list, tuple)) else str(o) for o in (widget.choice_values or [])]
                item["value"] = widget.field_value if widget.field_value not in (None, "") else None
            else:
                item["value"] = widget.field_value or ""
    return [fields[name] for name in order]


def fill(doc, fitz, values, flatten):
    known = {field["name"]: field for field in read_fields(doc, fitz)}
    if not known:
        fail("PDF_FORM_NO_FIELDS")
    for name, value in values.items():
        field = known.get(name)
        if field is None:
            fail("PDF_FORM_UNKNOWN_FIELD:%s" % name[:200])
        if field["readOnly"]:
            fail("PDF_FORM_READ_ONLY:%s" % name[:200])
        if field["type"] == "checkbox" and not isinstance(value, bool):
            fail("PDF_FORM_VALUE_INVALID:%s" % name[:200])
        if field["type"] in ("radio", "combo", "list") and value is not None and str(value) not in field["options"]:
            fail("PDF_FORM_VALUE_INVALID:%s" % name[:200])
        if field["type"] == "text" and (not isinstance(value, str) or len(value) > min(MAX_VALUE, field.get("maxLength") or MAX_VALUE)):
            fail("PDF_FORM_VALUE_INVALID:%s" % name[:200])
    for page in doc:
        for widget in page.widgets() or []:
            name = widget.field_name
            if name not in values:
                continue
            value = values[name]
            field_type = kind(fitz, widget)
            if field_type == "checkbox":
                widget.field_value = on_state(widget) if value else "Off"
            elif field_type == "radio":
                widget.field_value = on_state(widget) == str(value)
            elif field_type in ("combo", "list"):
                widget.field_value = "" if value is None else str(value)
            else:
                widget.field_value = value
            widget.update()
    if flatten:
        flatten_fields(doc, fitz)
    else:
        # Viewers redraw the fields with their own fonts: the built-in appearance (Helvetica)
        # has no Polish letters but o-acute.
        try:
            doc.xref_set_key(doc.pdf_catalog(), "AcroForm/NeedAppearances", "true")
        except Exception:  # noqa: BLE001
            pass
    return doc.tobytes(garbage=3, deflate=True)


FONT_CANDIDATES = [
    os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", "arial.ttf"),
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def unicode_font(fitz):
    """A font with the Polish letters: the system's Arial, else the built-in Unicode one."""
    for path in FONT_CANDIDATES:
        if os.path.isfile(path):
            try:
                return fitz.Font(fontfile=path)
            except Exception:  # noqa: BLE001
                continue
    return fitz.Font("china-s")


def flatten_fields(doc, fitz):
    """Fields become page content: the value written where the field was, then the field
    removed (PyMuPDF's own bake draws Helvetica, which drops the Polish letters)."""
    font = unicode_font(fitz)
    for page in doc:
        drawn = []
        widgets = list(page.widgets() or [])
        # All values first: deleting one button of a radio group changes what its siblings read.
        for widget in widgets:
            field_type = kind(fitz, widget)
            rect = fitz.Rect(widget.rect)
            value = widget.field_value
            if field_type in ("text", "combo", "list"):
                text = "" if value in (None, False) else str(value)
                if text:
                    drawn.append(("text", rect, text, widget.text_fontsize or 0))
            elif field_type in ("checkbox", "radio"):
                state = doc.xref_get_key(widget.xref, "AS")
                if state[0] == "name" and state[1] not in ("/Off", "/"):
                    drawn.append(("mark", rect, "", 0))
        for widget in widgets:
            page.delete_widget(widget)
        for kind_name, rect, text, size in drawn:
            if kind_name == "mark":
                inner = rect + (rect.width * 0.2, rect.height * 0.2, -rect.width * 0.2, -rect.height * 0.2)
                page.draw_line(inner.tl, inner.br, width=1.2)
                page.draw_line(inner.bl, inner.tr, width=1.2)
                continue
            writer = fitz.TextWriter(page.rect)
            size = size or max(6.0, min(11.0, rect.height * 0.65))
            # Shrink until it fits the field (multi-line fields wrap).
            while size > 5:
                try:
                    rest = writer.fill_textbox(rect + (2, 1, -2, 0), text, font=font, fontsize=size)
                except Exception:  # noqa: BLE001
                    rest = [text]
                if not rest:
                    break
                writer = fitz.TextWriter(page.rect)
                size -= 0.5
            writer.write_text(page)


def main():
    operation = sys.argv[1] if len(sys.argv) > 1 else ""
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES * 2)
    fitz = load()
    if operation == "read":
        if not raw or len(raw) > MAX_INPUT_BYTES:
            fail("PDF_FORM_INVALID")
        doc = open_pdf(fitz, raw)
        sys.stdout.write(json.dumps({"fields": read_fields(doc, fitz)}, ensure_ascii=False))
        return
    if operation != "fill":
        fail("PDF_FORM_OPERATION_INVALID")
    request = json.loads(raw.decode("utf-8"))
    data = base64.b64decode(request.get("dataBase64", ""), validate=True)
    values = request.get("values")
    if not data or len(data) > MAX_INPUT_BYTES or not isinstance(values, dict) or len(values) > 5000:
        fail("PDF_FORM_INVALID")
    doc = open_pdf(fitz, data)
    sys.stdout.buffer.write(fill(doc, fitz, values, bool(request.get("flatten"))))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write("PDF_FORM_FAILED:%s\n" % exc.__class__.__name__)
        raise SystemExit(2)
