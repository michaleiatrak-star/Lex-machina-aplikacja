#!/usr/bin/env python3
import argparse
import base64
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
import xml.parsers.expat

MAX_INPUT_BYTES = 64 * 1024 * 1024
MAX_XML_BYTES = 64 * 1024 * 1024
MAX_ENTRIES = 10000
MAX_TOTAL_UNCOMPRESSED = 256 * 1024 * 1024
MAX_TEXT_CHARS = 100_000_000

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
ODT = "application/vnd.oasis.opendocument.text"
EML = "message/rfc822"
RTF = "application/rtf"
DOC = "application/msword"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"

def fail(code: str) -> None:
    sys.stderr.write(code + "\n")
    raise SystemExit(2)

def read_member(zf: zipfile.ZipFile, name: str) -> bytes:
    try:
        info = zf.getinfo(name)
    except KeyError:
        fail("OFFICE_DOCUMENT_MEMBER_MISSING")
    if info.file_size < 0 or info.file_size > MAX_XML_BYTES:
        fail("OFFICE_DOCUMENT_MEMBER_TOO_LARGE")
    with zf.open(info, "r") as handle:
        data = handle.read(MAX_XML_BYTES + 1)
    if len(data) > MAX_XML_BYTES:
        fail("OFFICE_DOCUMENT_MEMBER_TOO_LARGE")
    return data

def validate_archive(zf: zipfile.ZipFile) -> None:
    infos = zf.infolist()
    if len(infos) > MAX_ENTRIES:
        fail("OFFICE_DOCUMENT_ARCHIVE_TOO_MANY_ENTRIES")
    total = 0
    for info in infos:
        if info.file_size < 0:
            fail("OFFICE_DOCUMENT_ARCHIVE_INVALID")
        total += info.file_size
        if total > MAX_TOTAL_UNCOMPRESSED:
            fail("OFFICE_DOCUMENT_ARCHIVE_TOO_LARGE")

# A DOCX read as the case sees it: the body, then what Word keeps outside it (headers,
# footers, footnotes, endnotes, comments). Parsed with expat for byte positions, so the
# anonymized copy changes only the text of runs and keeps everything else byte for byte.

HEADER_RE = re.compile(r"word/header(\d*)\.xml")
FOOTER_RE = re.compile(r"word/footer(\d*)\.xml")
NOTE_SKIP = {"separator", "continuationSeparator", "continuationNotice"}
SECTIONS = (
    ("header", "Nagłówek strony:"),
    ("footer", "Stopka strony:"),
    ("footnote", "Przypisy:"),
    ("endnote", "Przypisy końcowe:"),
    ("comment", "Komentarze:"),
)


def W(local: str) -> str:
    return W_NS + "}" + local


def tag_end(raw: bytes, start: int) -> int:
    """Index just past the '>' of the tag opening at start (quotes respected)."""
    quote = 0
    index = start + 1
    while index < len(raw):
        byte = raw[index]
        if quote:
            if byte == quote:
                quote = 0
        elif byte in (0x22, 0x27):
            quote = byte
        elif byte == 0x3E:
            return index + 1
        index += 1
    fail("OFFICE_DOCUMENT_XML_INVALID")


class Paragraph:
    __slots__ = ("pieces", "mirror")

    def __init__(self):
        # ("t", node) for the text of a w:t, ("s", text) for what the reader adds.
        self.pieces = []
        self.mirror = None

    def raw(self) -> str:
        return "".join(piece[1]["text"] if piece[0] == "t" else piece[1] for piece in self.pieces)


def parse_part(raw: bytes, kind: str) -> dict:
    """Paragraphs of one part in document order, with the byte spans of their text."""
    parser = xml.parsers.expat.ParserCreate(namespace_separator="}")
    parser.buffer_text = True
    paragraphs = []
    stack = []
    runs = [0]
    texts = []
    instr = []
    deleted = []
    containers = []
    state = {"text": None, "instr": None, "del": 0, "skip": 0}

    def start(name, attrs):
        at = parser.CurrentByteIndex
        if name == W("del"):
            if state["del"] == 0:
                end = tag_end(raw, at)
                deleted.append([at, None, raw[end - 2:end] == b"/>", end])
            state["del"] += 1
            return
        if state["del"]:
            return
        if kind in ("footnote", "endnote", "comment") and name in (W("footnote"), W("endnote"), W("comment")):
            skip = attrs.get(W("type"), "") in NOTE_SKIP
            containers.append({"id": attrs.get(W("id"), ""), "skip": skip, "first": None})
            state["skip"] = 1 if skip else 0
            return
        if state["skip"]:
            return
        if name == W("p"):
            paragraph = Paragraph()
            paragraphs.append(paragraph)
            stack.append(paragraph)
            if containers and containers[-1]["first"] is None:
                containers[-1]["first"] = paragraph
            return
        if name == W("r"):
            runs[0] += 1
            return
        if not stack:
            return
        if name == W("t"):
            end = tag_end(raw, at)
            node = {"start": at, "open_end": end, "close": None, "text": "", "empty": raw[end - 2:end] == b"/>"}
            if node["empty"]:
                node["close"] = end
            else:
                state["text"] = node
            texts.append(node)
            stack[-1].pieces.append(("t", node))
        elif name == W("instrText"):
            end = tag_end(raw, at)
            if raw[end - 2:end] != b"/>":
                state["instr"] = {"open_end": end, "close": None, "text": ""}
                instr.append(state["instr"])
        elif runs[0] and name == W("tab"):
            stack[-1].pieces.append(("s", "\t"))
        elif runs[0] and name in (W("br"), W("cr")):
            stack[-1].pieces.append(("s", "\n"))
        elif name == W("footnoteReference"):
            stack[-1].pieces.append(("s", "[przypis " + attrs.get(W("id"), "") + "]"))
        elif name == W("endnoteReference"):
            stack[-1].pieces.append(("s", "[przypis końcowy " + attrs.get(W("id"), "") + "]"))
        elif name == W("commentReference"):
            stack[-1].pieces.append(("s", "[komentarz " + attrs.get(W("id"), "") + "]"))

    def end(name):
        at = parser.CurrentByteIndex
        if state["del"]:
            if name == W("del"):
                state["del"] -= 1
                if state["del"] == 0 and deleted[-1][1] is None:
                    record = deleted[-1]
                    record[1] = record[3] if record[2] else tag_end(raw, at)
            return
        if name in (W("footnote"), W("endnote"), W("comment")) and kind in ("footnote", "endnote", "comment"):
            state["skip"] = 0
            return
        if state["skip"]:
            return
        if name == W("p") and stack:
            stack.pop()
        elif name == W("r"):
            runs[0] = max(0, runs[0] - 1)
        elif name == W("t") and state["text"] is not None:
            state["text"]["close"] = at
            state["text"] = None
        elif name == W("instrText") and state["instr"] is not None:
            state["instr"]["close"] = at
            state["instr"] = None

    def chars(data):
        if state["text"] is not None:
            state["text"]["text"] += data
        elif state["instr"] is not None:
            state["instr"]["text"] += data

    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.CharacterDataHandler = chars
    try:
        parser.Parse(raw, True)
    except xml.parsers.expat.ExpatError:
        fail("OFFICE_DOCUMENT_XML_INVALID")
    labels = {"footnote": "przypis ", "endnote": "przypis końcowy ", "comment": "komentarz "}
    for container in containers:
        if container["first"] is not None and not container["skip"]:
            container["first"].pieces.insert(0, ("s", "[" + labels[kind] + container["id"] + "] "))
    return {"paragraphs": paragraphs, "texts": texts, "instr": instr, "deleted": [d[:2] for d in deleted if d[1] is not None]}


def text_parts(names: list) -> list:
    """(kind, member) in reading order: body, headers, footers, notes, comments."""
    number = lambda name: int(re.search(r"(\d*)\.xml$", name).group(1) or 0)
    parts = [("body", "word/document.xml")]
    parts += [("header", name) for name in sorted((n for n in names if HEADER_RE.fullmatch(n)), key=number)]
    parts += [("footer", name) for name in sorted((n for n in names if FOOTER_RE.fullmatch(n)), key=number)]
    for kind, name in (("footnote", "word/footnotes.xml"), ("endnote", "word/endnotes.xml"), ("comment", "word/comments.xml")):
        if name in names:
            parts.append((kind, name))
    return parts


def docx_layout(zf: zipfile.ZipFile) -> tuple:
    """The text and where each paragraph's value sits in it."""
    names = zf.namelist()
    parsed = {}
    for kind, name in text_parts(names):
        parsed[name] = (kind, parse_part(read_member(zf, name), kind))
    entries = []  # (text, paragraph or None)
    seen_values = {}

    def add(paragraph):
        raw = paragraph.raw()
        value = raw.strip()
        if value:
            entries.append((value, paragraph))

    for paragraph in parsed["word/document.xml"][1]["paragraphs"]:
        add(paragraph)
    for kind, title in SECTIONS:
        section = []
        for name, (part_kind, part) in parsed.items():
            if part_kind != kind:
                continue
            values = tuple(p.raw().strip() for p in part["paragraphs"])
            if kind in ("header", "footer"):
                # The same header in several sections (first page, even pages): read once.
                same = seen_values.get(values)
                if same is not None:
                    for paragraph, original in zip(part["paragraphs"], same):
                        paragraph.mirror = original
                    continue
                seen_values[values] = part["paragraphs"]
            section.extend(p for p in part["paragraphs"] if p.raw().strip())
        if section:
            entries.append((title, None))
            entries.extend((p.raw().strip(), p) for p in section)
    offsets = []
    position = 0
    for index, (value, paragraph) in enumerate(entries):
        if index:
            position += 2
        offsets.append((position, value, paragraph))
        position += len(value)
    text = "\n\n".join(value for value, _ in entries)
    return text, offsets, parsed


def docx_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
        validate_archive(zf)
        text, _, _ = docx_layout(zf)
    return text


WHITESPACE_RE = re.compile(r"\s+")
AUTHOR_RE = re.compile(rb'(\s[A-Za-z0-9]+:(?:author|initials|userId|providerId))="[^"]*"')
TEXT_SEGMENT_RE = re.compile(r">([^<]+)<")
ATTRIBUTE_RE = re.compile(r'="([^"]*)"')
CORE_CLEAR_RE = re.compile(r"(<(?:[A-Za-z0-9]+:)?(?:creator|lastModifiedBy|Company|Manager)>)[^<]*(</)")


def xml_escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def replace_values(text: str, values: list) -> str:
    for value, token in values:
        text = text.replace(value, token)
    return text


def scrub_xml(raw: bytes, values: list) -> bytes:
    """Values in text and attribute values of a part the text does not cover."""
    escaped = [(xml_escape(v), xml_escape(t)) for v, t in values]
    quoted = [(v.replace('"', "&quot;"), t) for v, t in escaped]
    text = raw.decode("utf-8")
    text = TEXT_SEGMENT_RE.sub(lambda m: ">" + replace_values(m.group(1), escaped) + "<", text)
    text = ATTRIBUTE_RE.sub(lambda m: '="' + replace_values(m.group(1), quoted) + '"', text)
    return text.encode("utf-8")


def authors_out(raw: bytes) -> bytes:
    def anonymous(match):
        name = match.group(1)
        return name + (b'="A"' if name.endswith(b"initials") else b'="Autor"')
    return AUTHOR_RE.sub(anonymous, raw)


def docx_anonymize(data: bytes, source: str, expected: str, replacements: list, values: list) -> dict:
    values = sorted({(v, t) for v, t in values if len(v) >= 3}, key=lambda item: -len(item[0]))
    with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
        validate_archive(zf)
        text, offsets, parsed = docx_layout(zf)
        if text != source:
            fail("DOCX_ANONYMIZED_SOURCE_CHANGED")
        # Per paragraph: (start, end, token) in its value.
        local = {}
        for start, end, token in replacements:
            placed = False
            for position, value, paragraph in offsets:
                if paragraph is None or end <= position or start >= position + len(value):
                    continue
                a = max(start, position) - position
                b = min(end, position + len(value)) - position
                local.setdefault(id(paragraph), (paragraph, []))[1].append((a, b, "" if placed else token))
                placed = True
            if not placed:
                fail("DOCX_ANONYMIZED_SPAN_UNPLACED")
        edits = {}  # member -> list of (start, end, bytes)
        mirrors = {}
        for name, (kind, part) in parsed.items():
            for paragraph in part["paragraphs"]:
                if paragraph.mirror is not None:
                    mirrors.setdefault(id(paragraph.mirror), []).append(paragraph)
        changed_nodes = {}
        for key, (paragraph, ranges) in list(local.items()):
            for target in [paragraph] + mirrors.get(key, []):
                raw = target.raw()
                lead = len(raw) - len(raw.lstrip())
                owners = []
                for piece in target.pieces:
                    if piece[0] == "t":
                        owners.extend((piece[1], k) for k in range(len(piece[1]["text"])))
                    else:
                        owners.extend((None, -1) for _ in piece[1])
                for a, b, token in sorted(ranges):
                    owned = [(node, k) for node, k in owners[lead + a:lead + b] if node is not None]
                    if not owned:
                        if token:
                            fail("DOCX_ANONYMIZED_SPAN_UNPLACED")
                        continue
                    for node, k in owned:
                        state = changed_nodes.setdefault(id(node), {"node": node, "chars": list(node["text"]), "before": {}})
                        state["chars"][k] = None
                    if token:
                        node, k = owned[0]
                        state = changed_nodes[id(node)]
                        state["before"][k] = state["before"].get(k, "") + token
        node_member = {}
        for name, (kind, part) in parsed.items():
            for node in part["texts"]:
                node_member[id(node)] = name
        for state in changed_nodes.values():
            node = state["node"]
            new = "".join(state["before"].get(k, "") + (c or "") for k, c in enumerate(state["chars"]))
            raw = zf.read(node_member[id(node)])
            qname = raw[node["start"] + 1:node["open_end"]].split(None, 1)[0].rstrip(b"/>")
            close_end = node["open_end"] if node["empty"] else tag_end(raw, node["close"])
            replacement = b"<" + qname + b' xml:space="preserve">' + xml_escape(new).encode("utf-8") + b"</" + qname + b">"
            edits.setdefault(node_member[id(node)], []).append((node["start"], close_end, replacement))
        for name, (kind, part) in parsed.items():
            raw = None
            for node in part["instr"]:
                if node["close"] is None:
                    continue
                new = replace_values(node["text"], values)
                if new != node["text"]:
                    edits.setdefault(name, []).append((node["open_end"], node["close"], xml_escape(new).encode("utf-8")))
            # Tracked deletions keep the deleted text: accepted (removed) in the copy.
            for start, end in part["deleted"]:
                edits.setdefault(name, []).append((start, end, b""))
        text_members = set(parsed)
        output = io.BytesIO()
        warnings = []
        media = 0
        with zipfile.ZipFile(output, "w") as out:
            for info in zf.infolist():
                raw = zf.read(info)
                name = info.filename
                if name in text_members:
                    spans = sorted(edits.get(name, []), key=lambda item: item[0])
                    previous = -1
                    for start, end, _ in spans:
                        if start < previous:
                            fail("DOCX_ANONYMIZED_OVERLAP")
                        previous = end
                    for start, end, replacement in reversed(spans):
                        raw = raw[:start] + replacement + raw[end:]
                    raw = authors_out(raw)
                elif name.endswith(".xml") or name.endswith(".rels"):
                    raw = authors_out(scrub_xml(raw, values))
                    if name in ("docProps/core.xml", "docProps/app.xml"):
                        raw = CORE_CLEAR_RE.sub(lambda m: m.group(1) + m.group(2), raw.decode("utf-8")).encode("utf-8")
                elif name.startswith("word/media/") or name.startswith("word/embeddings/"):
                    media += 1
                out.writestr(info, raw)
        result = output.getvalue()
    if media:
        warnings.append("MEDIA_NOT_ANONYMIZED:" + str(media))
    with zipfile.ZipFile(io.BytesIO(result), "r") as check:
        produced, _, _ = docx_layout(check)
        # A span across paragraphs leaves the paragraph break in the file: only spacing may differ.
        if WHITESPACE_RE.sub(" ", produced).strip() != WHITESPACE_RE.sub(" ", expected).strip():
            fail("DOCX_ANONYMIZED_TEXT_MISMATCH")
        # Outside the read text, no value may remain (fields, links, properties, glossary).
        for info in check.infolist():
            if not (info.filename.endswith(".xml") or info.filename.endswith(".rels")):
                continue
            body = check.read(info).decode("utf-8", "replace")
            if info.filename in text_members:
                body = re.sub(r"<w:t(?:\s[^>]*)?>[^<]*</w:t>", "", body)
            for value, _ in values:
                if xml_escape(value) in body:
                    fail("DOCX_ANONYMIZED_LEAK:" + info.filename)
    return {"data": base64.b64encode(result).decode("ascii"), "warnings": warnings}


def odt_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
        validate_archive(zf)
        xml = read_member(zf, "content.xml")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        fail("OFFICE_DOCUMENT_XML_INVALID")

    p_tag = "{" + TEXT_NS + "}p"
    h_tag = "{" + TEXT_NS + "}h"
    lines = []
    for node in root.iter():
        if node.tag not in (p_tag, h_tag):
            continue
        value = "".join(node.itertext()).strip()
        if value:
            lines.append(value)
    return "\n\n".join(lines)


# --- E-mail (.eml) ---------------------------------------------------------------------
def html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</tr>|</h\d>", "\n", html)
    text = re.sub(r"<[^>]+>", "", html)
    import html as html_module
    text = html_module.unescape(text)
    return re.sub(r"[ \t]+\n", "\n", re.sub(r"\n{3,}", "\n\n", text)).strip()

def eml_text(data: bytes) -> str:
    """Headers, the body (plain text, else the HTML as text) and the names of the
    attachments. The attachments are listed, not read: they go to the case separately."""
    from email import policy
    from email.parser import BytesParser

    message = BytesParser(policy=policy.default).parsebytes(data)
    lines = []
    for name, label in (("From", "Od"), ("To", "Do"), ("Cc", "DW"), ("Date", "Data"), ("Subject", "Temat")):
        value = message.get(name)
        if value:
            lines.append("%s: %s" % (label, str(value).strip()))
    body = message.get_body(preferencelist=("plain", "html"))
    text = ""
    if body is not None:
        try:
            content = body.get_content()
        except (LookupError, UnicodeDecodeError):
            content = (body.get_payload(decode=True) or b"").decode("utf-8", errors="replace")
        text = html_to_text(content) if body.get_content_type() == "text/html" else content.strip()
    attachments = [part.get_filename() or "(bez nazwy)" for part in message.iter_attachments()]
    out = "\n".join(lines)
    if text:
        out += "\n\n" + text
    if attachments:
        out += "\n\nZałączniki: " + ", ".join(attachments)
    return out.strip()

# --- RTF ---------------------------------------------------------------------------------
RTF_SKIP = {"fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr",
            "footerl", "footerr", "object", "themedata", "datastore", "latentstyles", "listtable",
            "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "mmathPr", "fldinst"}
RTF_TOKEN = re.compile(rb"\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\(.)|([{}])|(\r\n|\r|\n)|([^\\{}\r\n]+)", re.S)

def rtf_text(data: bytes) -> str:
    """Text of an RTF document: paragraphs, tabs, Polish letters in the document's code page
    (\\ansicpg, e.g. 1250) and Unicode (\\u). Pictures, fields' codes, headers and tables of
    fonts/colours are skipped."""
    if not data.lstrip().startswith(b"{\\rtf"):
        fail("OFFICE_DOCUMENT_ARCHIVE_INVALID")
    codepage = "cp1252"
    match = re.search(rb"\\ansicpg(\d+)", data[:4096])
    if match:
        codepage = "cp%s" % match.group(1).decode()
    out, stack = [], []
    skip, uc, pending_skip = False, 1, 0
    star = False
    for token in RTF_TOKEN.finditer(data):
        word, arg, hexa, symbol, brace, newline, text = token.groups()
        if brace == b"{":
            stack.append((skip, uc))
            star = False
            continue
        if brace == b"}":
            skip, uc = stack.pop() if stack else (False, 1)
            continue
        if newline:
            continue
        if word is not None:
            name = word.decode()
            if star or name in RTF_SKIP:
                skip = True
                star = False
                continue
            if skip:
                continue
            if name in ("par", "line", "row", "sect", "page"):
                out.append("\n")
            elif name == "tab" or name == "cell":
                out.append("\t")
            elif name == "uc" and arg is not None:
                uc = int(arg)
            elif name == "u" and arg is not None:
                value = int(arg)
                out.append(chr(value + 65536 if value < 0 else value))
                pending_skip = uc
            elif name in ("emdash", "endash"):
                out.append("—" if name == "emdash" else "–")
            elif name in ("lquote", "rquote"):
                out.append("’")
            elif name in ("ldblquote", "rdblquote"):
                out.append("„" if name == "ldblquote" else "”")
            continue
        if symbol is not None:
            if symbol == b"*":
                star = True
            elif not skip and symbol in (b"\\", b"{", b"}"):
                out.append(symbol.decode())
            elif not skip and symbol == b"~":
                out.append("\u00a0")
            continue
        if skip:
            continue
        if hexa is not None:
            if pending_skip:
                pending_skip -= 1
                continue
            out.append(bytes([int(hexa, 16)]).decode(codepage, errors="replace"))
            continue
        if text:
            chunk = text.decode(codepage, errors="replace")
            if pending_skip:
                drop = min(pending_skip, len(chunk))
                chunk = chunk[drop:]
                pending_skip -= drop
            out.append(chunk)
    return re.sub(r"\n{3,}", "\n\n", "".join(out)).strip()


# Word 97-2003 (.doc): a compound file (CFB) whose WordDocument stream holds the text in pieces
# listed by the piece table (CLX) of the 0Table/1Table stream. Text only, no layout; standard
# library only (the user's computer has no LibreOffice). [MS-CFB], [MS-DOC] 2.4.1.
CFB_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
CFB_FREE = 0xFFFFFFFF
CFB_END = 0xFFFFFFFE

def u16(b: bytes, o: int) -> int:
    return int.from_bytes(b[o:o + 2], "little")

def u32(b: bytes, o: int) -> int:
    return int.from_bytes(b[o:o + 4], "little")

def cfb_streams(data: bytes) -> dict:
    if len(data) < 512 or data[:8] != CFB_MAGIC:
        fail("DOC_NOT_COMPOUND_FILE")
    sector_size = 1 << u16(data, 0x1E)
    mini_size = 1 << u16(data, 0x20)
    if sector_size not in (512, 4096) or mini_size != 64:
        fail("DOC_COMPOUND_FILE_INVALID")
    mini_cutoff = u32(data, 0x38)

    def sector(index: int) -> bytes:
        start = (index + 1) * sector_size
        if start + sector_size > len(data) + sector_size:
            fail("DOC_COMPOUND_FILE_INVALID")
        return data[start:start + sector_size]

    difat = [u32(data, 0x4C + 4 * i) for i in range(109)]
    next_difat, guard = u32(data, 0x44), 0
    while next_difat not in (CFB_FREE, CFB_END) and guard < 10000:
        block = sector(next_difat)
        difat.extend(u32(block, 4 * i) for i in range(sector_size // 4 - 1))
        next_difat, guard = u32(block, sector_size - 4), guard + 1
    fat = []
    for index in difat:
        if index in (CFB_FREE, CFB_END):
            continue
        block = sector(index)
        fat.extend(u32(block, 4 * i) for i in range(sector_size // 4))

    def chain(start: int, table: list) -> list:
        out, seen = [], set()
        while start not in (CFB_FREE, CFB_END) and start < len(table):
            if start in seen:
                fail("DOC_COMPOUND_FILE_INVALID")
            seen.add(start)
            out.append(start)
            start = table[start]
        return out

    directory = b"".join(sector(i) for i in chain(u32(data, 0x30), fat))
    entries = []
    for offset in range(0, len(directory) - 127, 128):
        raw = directory[offset:offset + 128]
        length = u16(raw, 0x40)
        name = raw[:max(0, length - 2)].decode("utf-16-le", "replace")
        entries.append((name, raw[0x42], u32(raw, 0x74), u32(raw, 0x78)))
    if not entries:
        fail("DOC_COMPOUND_FILE_INVALID")
    root = entries[0]
    mini_stream = b"".join(sector(i) for i in chain(root[2], fat))
    minifat = []
    for index in chain(u32(data, 0x3C), fat):
        block = sector(index)
        minifat.extend(u32(block, 4 * i) for i in range(sector_size // 4))
    streams = {}
    for name, kind, start, size in entries[1:]:
        if kind != 2:
            continue
        if size < mini_cutoff:
            body = b"".join(mini_stream[i * mini_size:(i + 1) * mini_size] for i in chain(start, minifat))
        else:
            body = b"".join(sector(i) for i in chain(start, fat))
        streams[name] = body[:size]
    return streams

def doc_clean(text: str) -> str:
    # Fields: keep the shown result, drop the instruction ("\\x13 PAGE \\x14 3 \\x15" -> "3").
    out, depth_instr = [], []
    for ch in text:
        if ch == "\x13":
            depth_instr.append(True)
        elif ch == "\x14":
            if depth_instr:
                depth_instr[-1] = False
        elif ch == "\x15":
            if depth_instr:
                depth_instr.pop()
        elif depth_instr and depth_instr[-1]:
            continue
        else:
            out.append(ch)
    text = "".join(out)
    text = text.replace("\r\x07", "\n").replace("\x07", "\t").replace("\r", "\n").replace("\x0b", "\n").replace("\x0c", "\n\n")
    text = text.replace("\x1e", "-").replace("\x1f", "").replace("\xa0", " ")
    text = re.sub(r"[\x00-\x08\x0e-\x1d]", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"

def doc_text(data: bytes) -> str:
    streams = cfb_streams(data)
    word = streams.get("WordDocument")
    if not word or len(word) < 0x200 or u16(word, 0) != 0xA5EC:
        fail("DOC_FORMAT_UNSUPPORTED")
    flags = u16(word, 0x0A)
    if flags & 0x0100:
        fail("OFFICE_DOCUMENT_ENCRYPTED")
    table = streams.get("1Table" if flags & 0x0200 else "0Table")
    if not table:
        fail("DOC_FORMAT_UNSUPPORTED")
    csw = u16(word, 32)
    lw = 34 + csw * 2
    cslw = u16(word, lw)
    fc_lcb = lw + 2 + cslw * 4 + 2
    ccp_text = u32(word, lw + 2 + 0x0C)
    ccp_ftn = u32(word, lw + 2 + 0x10)
    fc_clx, lcb_clx = u32(word, fc_lcb + 0x108), u32(word, fc_lcb + 0x10C)
    clx = table[fc_clx:fc_clx + lcb_clx]
    pos = 0
    while pos < len(clx) and clx[pos] == 0x01:
        pos += 3 + u16(clx, pos + 1)
    if pos >= len(clx) or clx[pos] != 0x02:
        fail("DOC_FORMAT_UNSUPPORTED")
    lcb = u32(clx, pos + 1)
    plc = clx[pos + 5:pos + 5 + lcb]
    count = (lcb - 4) // 12
    cps = [u32(plc, 4 * i) for i in range(count + 1)]
    pieces = []
    for i in range(count):
        pcd = plc[4 * (count + 1) + 8 * i:4 * (count + 1) + 8 * i + 8]
        fc = u32(pcd, 2)
        chars = cps[i + 1] - cps[i]
        if chars <= 0:
            continue
        if fc & 0x40000000:
            start = (fc & 0x3FFFFFFF) // 2
            pieces.append(word[start:start + chars].decode("cp1252", "replace"))
        else:
            pieces.append(word[fc:fc + 2 * chars].decode("utf-16-le", "replace"))
    text = "".join(pieces)
    main_text = text[:ccp_text] if ccp_text else text
    notes = text[ccp_text:ccp_text + ccp_ftn] if ccp_ftn else ""
    cleaned = doc_clean(main_text)
    if notes.strip():
        cleaned += "\nPrzypisy:\n" + doc_clean(notes)
    if not cleaned.strip():
        fail("DOC_TEXT_EMPTY")
    return cleaned

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--media-type", required=True)
    parser.add_argument("--anonymize", action="store_true")
    args = parser.parse_args()

    if args.anonymize:
        # stdin: {"data": base64, "source", "expected", "replacements": [[start, end, token]], "values": [[value, token]]}
        request = json.loads(sys.stdin.buffer.read(4 * MAX_INPUT_BYTES).decode("utf-8"))
        if args.media_type != DOCX:
            fail("OFFICE_DOCUMENT_MEDIA_TYPE_UNSUPPORTED")
        try:
            result = docx_anonymize(
                base64.b64decode(request["data"]),
                request["source"],
                request["expected"],
                [(int(a), int(b), str(t)) for a, b, t in request["replacements"]],
                [(str(v), str(t)) for v, t in request["values"]],
            )
        except zipfile.BadZipFile:
            fail("OFFICE_DOCUMENT_ARCHIVE_INVALID")
        sys.stdout.write(json.dumps(result))
        return

    data = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if not data or len(data) > MAX_INPUT_BYTES:
        fail("OFFICE_DOCUMENT_SIZE_INVALID")

    try:
        if args.media_type == DOCX:
            text = docx_text(data)
        elif args.media_type == ODT:
            text = odt_text(data)
        elif args.media_type == EML:
            text = eml_text(data)
        elif args.media_type == RTF:
            text = rtf_text(data)
        elif args.media_type == DOC:
            text = doc_text(data)
        else:
            fail("OFFICE_DOCUMENT_MEDIA_TYPE_UNSUPPORTED")
    except zipfile.BadZipFile:
        fail("OFFICE_DOCUMENT_ARCHIVE_INVALID")

    if len(text) > MAX_TEXT_CHARS:
        fail("OFFICE_DOCUMENT_TEXT_TOO_LARGE")

    sys.stdout.write(json.dumps({
        "text": text,
        "chars": len(text)
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
