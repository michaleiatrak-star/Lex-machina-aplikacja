#!/usr/bin/env python3
import base64
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

FIXED_DATE = (1980, 1, 1, 0, 0, 0)
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
ALIAS_RE = re.compile(r"\[LMPII:D\d{2}:[A-Z_]+:\d{4}(?:\|(?:NOM|GEN|DAT|ACC|INS|LOC|VOC))?\]")
PERSON_CASES = {"NOM", "GEN", "DAT", "ACC", "INS", "LOC", "VOC"}


def pii_ref_text(node):
    """Alias placeholder; a person reference may carry its grammatical case."""
    alias = node.get("alias", "")
    case = node.get("case")
    if case is None:
        return alias
    if case not in PERSON_CASES or not alias.endswith("]"):
        raise ValueError("AST_PII_CASE_INVALID")
    return alias[:-1] + "|" + case + "]"

DOCX_CT = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""

DOCX_ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""

# Without these relationships Word ignores styles.xml and numbering.xml:
# title, headings and quotes would render as plain paragraphs.
DOCX_DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>"""

DOCX_CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Lex Machina document</dc:title><dc:creator>Lex Machina</dc:creator></cp:coreProperties>"""

DOCX_APP = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Lex Machina</Application></Properties>"""

# Every style is based on Normal (one font in the whole document) and pPr precedes rPr
# (CT_Style order); docDefaults give the font also to parts Word styles itself.
DOCX_STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="23"/><w:lang w:val="pl-PL"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
</w:styles>"""

# Page number centred in the footer ("1", "2", ...): a field, so text extraction of
# word/document.xml (the validator's comparison with the AST) is unchanged.
DOCX_FOOTER = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>"""

DOCX_SETTINGS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/></w:settings>"""
DOCX_FONT = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Arial"/></w:fonts>"""
DOCX_NUMBERING = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>"""

ODT_MIMETYPE = b"application/vnd.oasis.opendocument.text"
ODT_MANIFEST = """<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>
</manifest:manifest>"""

# The same layout as the DOCX: A4, 2.5 cm margins, justified body, centred page number,
# numbered lists, right-aligned signature. Before, the styles named in content.xml were not
# defined (signature not aligned, ordered lists as bullets, default margins and font).
ODT_STYLES = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3">
<office:font-face-decls><style:font-face style:name="Arial" svg:font-family="Arial"/></office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.21cm" fo:line-height="125%" fo:text-align="justify"/><style:text-properties style:font-name="Arial" fo:font-size="11.5pt" fo:language="pl" fo:country="PL"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph"/>
<style:style style:name="Title" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.42cm"/><style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:default-outline-level="1"><style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.21cm" fo:keep-with-next="always" fo:text-align="start"/><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:default-outline-level="2"><style:paragraph-properties fo:margin-top="0.35cm" fo:margin-bottom="0.18cm" fo:keep-with-next="always" fo:text-align="start"/><style:text-properties fo:font-size="12.5pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:default-outline-level="3"><style:paragraph-properties fo:margin-top="0.28cm" fo:margin-bottom="0.14cm" fo:keep-with-next="always" fo:text-align="start"/><style:text-properties fo:font-size="11.5pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Quote" style:family="paragraph"><style:paragraph-properties fo:margin-left="1.27cm" fo:margin-right="1.27cm"/><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Signature" style:family="paragraph"><style:paragraph-properties fo:text-align="end" fo:margin-top="0.85cm"/></style:style>
<style:style style:name="PageBreak" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style>
<style:style style:name="Footer" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="9pt"/></style:style>
<text:list-style style:name="Numbered"><text:list-level-style-number text:level="1" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="1.27cm" fo:text-indent="-0.635cm" fo:margin-left="1.27cm"/></style:list-level-properties></text:list-level-style-number></text:list-style>
<text:list-style style:name="Bulleted"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="1.27cm" fo:text-indent="-0.635cm" fo:margin-left="1.27cm"/></style:list-level-properties></text:list-level-style-bullet></text:list-style>
</office:styles>
<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2.5cm" fo:margin-bottom="2cm" fo:margin-left="2.5cm" fo:margin-right="2.5cm"/><style:footer-style><style:header-footer-properties fo:min-height="0.6cm" fo:margin-top="0.3cm"/></style:footer-style></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"><style:footer><text:p text:style-name="Footer"><text:page-number text:select-page="current">1</text:page-number></text:p></style:footer></style:master-page></office:master-styles>
</office:document-styles>"""
ODT_META = """<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:meta/></office:document-meta>"""
ODT_SETTINGS = """<?xml version="1.0" encoding="UTF-8"?><office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:settings/></office:document-settings>"""

DOCX_ALLOWED = {
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/core.xml",
    "docProps/app.xml",
    "word/document.xml",
    "word/styles.xml",
    "word/settings.xml",
    "word/fontTable.xml",
    "word/numbering.xml",
    "word/_rels/document.xml.rels",
}
# Documents rendered before the footer existed stay valid (deanonymized and checked later).
DOCX_REQUIRED = set(DOCX_ALLOWED)
DOCX_ALLOWED = DOCX_ALLOWED | {"word/footer1.xml"}
ODT_ALLOWED = {
    "mimetype",
    "content.xml",
    "styles.xml",
    "meta.xml",
    "settings.xml",
    "META-INF/manifest.xml",
}

# Parts a firm's letterhead brings into a rendered document (render_docx with a template):
# its headers and footers, their relationships and the images they show. Nothing else of
# the template is copied; the body is always the generated one.
LETTERHEAD_PART_RE = re.compile(r"^word/(?:header|footer)\d{1,3}\.xml$")
LETTERHEAD_RELS_RE = re.compile(r"^word/_rels/(?:header|footer)\d{1,3}\.xml\.rels$")
LETTERHEAD_MEDIA_RE = re.compile(r"^word/media/lex_t\d{1,3}\.(png|jpeg|gif|bmp|emf|wmf)$")
MEDIA_CONTENT_TYPES = {"png": "image/png", "jpeg": "image/jpeg", "gif": "image/gif", "bmp": "image/bmp", "emf": "image/x-emf", "wmf": "image/x-wmf"}
MAX_LETTERHEAD_PARTS = 6
MAX_LETTERHEAD_MEDIA = 12
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
REL_TYPE_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"

def docx_part_allowed(name):
    return (name in DOCX_ALLOWED or LETTERHEAD_PART_RE.match(name) is not None
            or LETTERHEAD_RELS_RE.match(name) is not None or LETTERHEAD_MEDIA_RE.match(name) is not None)

def zip_bytes(entries, stored_first=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries:
            info = zipfile.ZipInfo(name, FIXED_DATE)
            info.external_attr = 0o600 << 16
            compress = zipfile.ZIP_STORED if name == stored_first else zipfile.ZIP_DEFLATED
            zf.writestr(info, data, compress_type=compress, compresslevel=9 if compress == zipfile.ZIP_DEFLATED else None)
    result = buf.getvalue()
    if len(result) > MAX_PACKAGE_BYTES:
        raise ValueError("DOCUMENT_PACKAGE_TOO_LARGE")
    return result

def inline_text(nodes):
    parts = []
    for node in nodes or []:
        t = node.get("type")
        if t == "text":
            parts.append(node.get("text", ""))
        elif t == "pii_ref":
            parts.append(pii_ref_text(node))
        elif t == "xref":
            parts.append(node.get("label", ""))
        else:
            raise ValueError("AST_INLINE_TYPE_UNSUPPORTED")
    return "".join(parts)

def docx_text_run(text, rpr=""):
    xml_space = ' xml:space="preserve"' if text[:1].isspace() or text[-1:].isspace() else ""
    return "<w:r>%s<w:t%s>%s</w:t></w:r>" % (rpr, xml_space, escape(text))

def with_bold(rpr):
    """The run properties with bold added (a party's name, a label such as "Dotyczy:")."""
    if not rpr:
        return "<w:rPr><w:b/></w:rPr>"
    return rpr.replace("<w:rPr>", "<w:rPr><w:b/>", 1)

def docx_runs(nodes, rpr=""):
    runs = []
    for node in nodes or []:
        t = node.get("type")
        text = node.get("text", "") if t == "text" else pii_ref_text(node) if t == "pii_ref" else node.get("label", "")
        node_rpr = with_bold(rpr) if t == "text" and node.get("bold") is True else rpr
        # A line break inside a text node (court address, parties) is a line break in the
        # document, not a space; each line is its own w:t (text extraction joins them with "\n").
        lines = text.split("\n")
        for index, line in enumerate(lines):
            if index:
                runs.append("<w:r>%s<w:br/></w:r>" % node_rpr)
            if line or len(lines) == 1:
                runs.append(docx_text_run(line, node_rpr))
    return "".join(runs)

def docx_paragraph(nodes, style=None, extra_ppr="", rpr=""):
    style_xml = '<w:pStyle w:val="%s"/>' % style if style else ""
    ppr = "<w:pPr>%s%s</w:pPr>" % (style_xml, extra_ppr) if style_xml or extra_ppr else ""
    return "<w:p>%s%s</w:p>" % (ppr, docx_runs(nodes, rpr))

# Text width of an A4 page with 2.5 cm margins, in twentieths of a point.
DOCX_TEXT_WIDTH = 11906 - 2 * 1417

# Layout of a letter or pleading (pisma-proste-v2 M4-struktura): place and date on the right,
# the court or authority in the right half, the title centred in capitals, signature on the
# right. The AST has no alignment, so the header (blocks before the first level-1 heading)
# is recognised by its text; the text itself never changes (the validator compares it).
PLACE_DATE_RE = re.compile(r"^\s*(?:\[Miejscowo\w*,? data\]|[A-ZĄĆĘŁŃÓŚŹŻ][\w .ąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]{1,40},?\s+(?:dnia\s+)?(?:\d{1,2}[ .]|\[))", re.UNICODE)
ADDRESSEE_RE = re.compile(
    r"^\s*(?:Do\s|Sąd|Wojewódzki Sąd|Naczelny Sąd|Trybunał|Prokurat|Komornik|Urząd|Naczelnik|Zakład Ubezpieczeń|"
    r"Kasa Rolniczego|Krajowa Izba|Samorządowe Kolegium|Dyrektor|Prezes|Rzecznik|Wójt|Burmistrz|Prezydent|Starosta|Wojewoda|"
    r"Inspektor|Państwowa Inspekcja|Krajowa Informacja|Izba Administracji|Komendant|Sz\.\s*P\.|Szanown)", re.UNICODE)
LETTER_TYPES = {"pleading", "letter"}
# A paragraph's role (letter-markup.ts) decides its layout, not its text.
ROLE_LAYOUT = {"place_date": "place_date", "basis": "center", "party": "party", "addressee": "addressee", "subject": "justify"}

def inline_plain(nodes):
    return "".join(node.get("text", "") if node.get("type") == "text" else node.get("label", "") for node in nodes or [])

def block_layout(ast):
    """Per block index: None, "right", "half" (right half of the page) or "center"."""
    layout = {}
    blocks = ast.get("blocks") or []
    kind = ast.get("documentType")
    if kind in LETTER_TYPES:
        title_seen = bool(ast.get("title"))
        for index, block in enumerate(blocks):
            t = block.get("type")
            if t == "heading" and int(block.get("level", 1)) == 1:
                layout[index] = "center"
                title_seen = True
                continue
            role = block.get("role") if t == "paragraph" else None
            if role:
                layout[index] = ROLE_LAYOUT.get(role)
                continue
            if title_seen or t != "paragraph":
                continue
            text = inline_plain(block.get("content"))
            if PLACE_DATE_RE.match(text) and len(text) < 90:
                layout[index] = "right"
            elif ADDRESSEE_RE.match(text):
                layout[index] = "half"
    elif kind == "contract":
        for index, block in enumerate(blocks):
            if block.get("type") != "heading":
                continue
            level = int(block.get("level", 1))
            text = inline_plain(block.get("content")).strip()
            if level == 1 or text.startswith("§"):
                layout[index] = "center"
    return layout

def has_line_break(nodes):
    return any("\n" in (node.get("text", "") or "") for node in nodes or [] if node.get("type") == "text")

DOCX_ALIGN = {
    # The header of an office letter: a blank line's space after each block, the addressee
    # from 9 cm (the right half of the page), as in the office's templates.
    "place_date": '<w:spacing w:after="240"/><w:jc w:val="right"/>',
    "party": '<w:spacing w:after="240"/><w:jc w:val="left"/>',
    "addressee": '<w:spacing w:after="240"/><w:ind w:left="5103"/><w:jc w:val="left"/>',
    "left": '<w:jc w:val="left"/>',
    "justify": '<w:jc w:val="both"/>',
    "right": '<w:jc w:val="right"/>',
    "half": '<w:ind w:left="%d"/><w:jc w:val="left"/>' % ((11906 - 2 * 1417) // 2),
    "center": '<w:jc w:val="center"/>'
}

def docx_block(block, align=None, profile=None):
    t = block.get("type")
    extra = DOCX_ALIGN.get(align, "")
    if t == "heading":
        level = int(block.get("level", 1))
        # The title of a letter: centred, in capitals (formatting, the text is unchanged).
        return docx_paragraph(block.get("content"), "Heading%d" % level, extra, "<w:rPr><w:caps/></w:rPr>" if align == "center" and level == 1 else "")
    if t == "paragraph":
        # A justified line that ends with a manual break is stretched across the page.
        if not extra and has_line_break(block.get("content")):
            extra = '<w:jc w:val="left"/>'
        return docx_paragraph(block.get("content"), None, extra)
    if t == "quote":
        return docx_paragraph(block.get("content"), "Quote")
    if t == "signature":
        return docx_paragraph(block.get("content"), None, '<w:keepLines/><w:spacing w:before="480"/><w:jc w:val="right"/>')
    if t == "page_break":
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    if t == "list":
        out = []
        ordered = bool(block.get("ordered"))
        # The first number of points running through the letter ("23." after a heading).
        start = block.get("start") if isinstance(block.get("start"), int) and block.get("start") >= 1 else 1
        for index, item in enumerate(block.get("items") or [], start=start):
            # An office letter numbers its points "1)", as in the office's templates.
            prefix = (("%d) " if profile == "lex-office-tnr-v1" else "%d. ") % index) if ordered else "• "
            nodes = [{"type": "text", "text": prefix}] + list(item)
            # Office letter: the number at the margin, the wrapped lines under the item's text.
            indent = '<w:ind w:left="357" w:hanging="357"/>' if profile == "lex-office-tnr-v1" else '<w:ind w:left="720" w:hanging="360"/>'
            out.append(docx_paragraph(nodes, None, indent))
        return "".join(out)
    if t == "table":
        # Declared columns of equal width within the margins: without w:tblGrid and cell
        # widths LibreOffice dropped all but the first column and the table left the page.
        source_rows = block.get("rows") or []
        columns = max([len(row) for row in source_rows] or [1]) or 1
        width = DOCX_TEXT_WIDTH // columns
        rows = []
        for row in source_rows:
            cells = []
            for index in range(columns):
                cell = row[index] if index < len(row) else {"blocks": []}
                body = "".join(docx_block(child) for child in cell.get("blocks") or []) or "<w:p/>"
                cells.append('<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>%s</w:tc>' % (width, body))
            rows.append("<w:tr><w:trPr><w:cantSplit/></w:trPr>%s</w:tr>" % "".join(cells))
        grid = "".join('<w:gridCol w:w="%d"/>' % width for _ in range(columns))
        return ('<w:tbl><w:tblPr><w:tblW w:w="%d" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
                '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>'
                '<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>'
                '<w:tblGrid>%s</w:tblGrid>%s</w:tbl><w:p/>') % (width * columns, grid, "".join(rows))
    raise ValueError("AST_BLOCK_TYPE_UNSUPPORTED")

# A law office's letter (the office's templates): Times New Roman 12 throughout, single line
# spacing, 6 pt after a paragraph, title in capitals and sections in bold in the text size.
DOCX_OFFICE_STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pl-PL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="100"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="80"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
</w:styles>"""

# Page margins (twentieths of a point): top, right, bottom, left.
PAGE_MARGINS = {"lex-office-tnr-v1": (1134, 1134, 1134, 1417)}

def docx_styles_for(profile):
    if profile == "lex-office-tnr-v1":
        return DOCX_OFFICE_STYLES
    if profile == "lex-classic-tnr-v1":
        return DOCX_STYLES.replace("Arial", "Times New Roman").replace('<w:sz w:val="23"/><w:lang', '<w:sz w:val="24"/><w:lang').replace('w:cs="Times New Roman"/><w:sz w:val="23"/>', 'w:cs="Times New Roman"/><w:sz w:val="24"/>')
    if profile == "lex-light-legal-design-v1":
        heading = '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr>'
        assert heading in DOCX_STYLES
        # analizator-umow-v1 legal design: section titles with a grey bottom rule.
        return DOCX_STYLES.replace(heading, '<w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="808080"/></w:pBdr><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr>', 1)
    return DOCX_STYLES

def odt_styles_for(profile):
    if profile == "lex-office-tnr-v1":
        tnr = ODT_STYLES.replace("Arial", "Times New Roman").replace('style:font-name="Times New Roman" fo:font-size="11.5pt"', 'style:font-name="Times New Roman" fo:font-size="12pt"')
        for size in ("16pt", "14pt", "12.5pt", "11.5pt"):
            tnr = tnr.replace('fo:font-size="%s"' % size, 'fo:font-size="12pt"')
        return (tnr.replace('fo:line-height="125%"', 'fo:line-height="115%"')
                .replace('fo:margin-top="2.5cm" fo:margin-bottom="2cm" fo:margin-left="2.5cm" fo:margin-right="2.5cm"',
                         'fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2.5cm" fo:margin-right="2cm"'))
    if profile == "lex-classic-tnr-v1":
        return ODT_STYLES.replace("Arial", "Times New Roman").replace('style:font-name="Times New Roman" fo:font-size="11.5pt"', 'style:font-name="Times New Roman" fo:font-size="12pt"')
    return ODT_STYLES

def read_template_entries(data):
    """The firm template's parts, with the size limits of read_zip and no part filter."""
    if len(data) > MAX_PACKAGE_BYTES:
        raise ValueError("DOCUMENT_PACKAGE_TOO_LARGE")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data), "r")
    except zipfile.BadZipFile:
        raise ValueError("TEMPLATE_PACKAGE_INVALID")
    with zf:
        entries = {}
        total = 0
        for info in zf.infolist():
            total += info.file_size
            if total > MAX_PACKAGE_BYTES * 4:
                raise ValueError("DOCUMENT_PACKAGE_EXPANSION_LIMIT")
            entries[info.filename] = zf.read(info.filename)
        return entries

def template_letterhead(data):
    """Headers, footers (with their images) and the page setup of the template's last
    section: what a firm's letterhead is. Fails closed (ValueError) on anything that would
    have to be copied blindly: an external link, a non-image relationship, a missing part."""
    entries = read_template_entries(data)
    if "word/document.xml" not in entries:
        raise ValueError("TEMPLATE_NOT_DOCX")
    doc = ET.fromstring(entries["word/document.xml"])
    body = doc.find("{%s}body" % W_NS)
    sect = body.find("{%s}sectPr" % W_NS) if body is not None else None
    if sect is None:
        raise ValueError("TEMPLATE_SECTION_MISSING")
    rels = {}
    if "word/_rels/document.xml.rels" in entries:
        for rel in ET.fromstring(entries["word/_rels/document.xml.rels"]).iter("{%s}Relationship" % PKG_REL_NS):
            rels[rel.attrib.get("Id")] = rel.attrib
    parts, media, references = [], [], []
    for ref in list(sect):
        kind = ref.tag.split("}")[1]
        if kind not in ("headerReference", "footerReference"):
            continue
        ref_type = ref.attrib.get("{%s}type" % W_NS, "default")
        if ref_type == "even":
            continue
        rel = rels.get(ref.attrib.get("{%s}id" % R_NS))
        if not rel or rel.get("TargetMode") == "External":
            raise ValueError("TEMPLATE_LETTERHEAD_RELATIONSHIP_INVALID")
        source = "word/" + rel.get("Target", "").lstrip("/").replace("word/", "", 1)
        if source not in entries or not re.match(r"^word/(?:header|footer)\d{1,3}\.xml$", source):
            raise ValueError("TEMPLATE_LETTERHEAD_PART_MISSING")
        if len(parts) >= MAX_LETTERHEAD_PARTS:
            raise ValueError("TEMPLATE_LETTERHEAD_TOO_MANY_PARTS")
        part_kind = "header" if kind == "headerReference" else "footer"
        name = "%s%d.xml" % (part_kind, 100 + len(parts))
        ET.fromstring(entries[source])
        part_rels = None
        rels_source = "word/_rels/" + source.split("/", 1)[1] + ".rels"
        if rels_source in entries:
            rels_root = ET.fromstring(entries[rels_source])
            image_rels = []
            for prel in rels_root.iter("{%s}Relationship" % PKG_REL_NS):
                if prel.attrib.get("TargetMode") == "External":
                    raise ValueError("DOCUMENT_PACKAGE_EXTERNAL_RELATIONSHIP")
                if prel.attrib.get("Type") != REL_TYPE_BASE + "image":
                    raise ValueError("TEMPLATE_LETTERHEAD_RELATIONSHIP_UNSUPPORTED")
                target = "word/" + prel.attrib.get("Target", "").lstrip("/").replace("word/", "", 1)
                ext = target.rsplit(".", 1)[-1].lower().replace("jpg", "jpeg")
                if target not in entries or ext not in MEDIA_CONTENT_TYPES:
                    raise ValueError("TEMPLATE_LETTERHEAD_MEDIA_INVALID")
                if len(media) >= MAX_LETTERHEAD_MEDIA:
                    raise ValueError("TEMPLATE_LETTERHEAD_TOO_MANY_MEDIA")
                media_name = "media/lex_t%d.%s" % (len(media) + 1, ext)
                media.append(("word/" + media_name, entries[target], ext))
                image_rels.append((prel.attrib.get("Id", ""), media_name))
            # Written anew in the default namespace: OPC readers (LibreOffice) refuse the
            # "ns0:" prefixes ElementTree would give a re-serialized part.
            part_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                         '<Relationships xmlns="%s">%s</Relationships>' % (PKG_REL_NS, "".join(
                             '<Relationship Id="%s" Type="%simage" Target="%s"/>' % (escape(rid, {'"': "&quot;"}), REL_TYPE_BASE, target)
                             for rid, target in image_rels))).encode("utf-8")
        rid = "rIdT%d" % (len(parts) + 1)
        parts.append((part_kind, name, entries[source], part_rels, rid))
        references.append('<w:%s w:type="%s" r:id="%s"/>' % (kind, escape(ref_type, {'"': "&quot;"}), rid))
    def first(tag):
        node = sect.find("{%s}%s" % (W_NS, tag))
        return node.attrib if node is not None else None
    def number(attrs, key, default):
        value = (attrs or {}).get("{%s}%s" % (W_NS, key))
        return int(value) if value is not None and re.fullmatch(r"\d{1,6}", value) else default
    size, margins = first("pgSz"), first("pgMar")
    page = (number(size, "w", 11906), number(size, "h", 16838))
    pg_mar = tuple(number(margins, key, default) for key, default in
                   (("top", 1417), ("right", 1417), ("bottom", 1417), ("left", 1417), ("header", 720), ("footer", 567)))
    return {"parts": parts, "media": media, "references": references, "page": page, "margins": pg_mar,
            "titlePg": sect.find("{%s}titlePg" % W_NS) is not None}

def render_docx(ast, letterhead=None):
    body = []
    if ast.get("title"):
        body.append(docx_paragraph(ast.get("title"), "Title"))
    layout = block_layout(ast)
    body.extend(docx_block(block, layout.get(index), ast.get("styleProfile")) for index, block in enumerate(ast.get("blocks") or []))
    top, right, bottom, left = PAGE_MARGINS.get(ast.get("styleProfile"), (1417, 1417, 1417, 1417))
    sect = ('<w:sectPr><w:footerReference w:type="default" r:id="rId5"/><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" w:header="720" w:footer="567" w:gutter="0"/></w:sectPr>') % (top, right, bottom, left)
    content_types, doc_rels = DOCX_CT, DOCX_DOC_RELS
    extra = []
    own_footer = True
    if letterhead:
        # The firm's letterhead: its headers and footers and its page setup; Lex keeps its
        # page-number footer only where the template has no default footer.
        own_footer = not any(kind == "footer" and 'w:type="default"' in ref
                             for (kind, _, _, _, _), ref in zip(letterhead["parts"], letterhead["references"]))
        refs = "".join(letterhead["references"]) + ('<w:footerReference w:type="default" r:id="rId5"/>' if own_footer else "")
        t, r, b, l, h, f = letterhead["margins"]
        sect = ('<w:sectPr>%s<w:pgSz w:w="%d" w:h="%d"/><w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" '
                'w:header="%d" w:footer="%d" w:gutter="0"/>%s</w:sectPr>') % (
                    refs, letterhead["page"][0], letterhead["page"][1], t, r, b, l, h, f, "<w:titlePg/>" if letterhead["titlePg"] else "")
        overrides, relationships = [], []
        for kind, name, data, rels, rid in letterhead["parts"]:
            overrides.append('<Override PartName="/word/%s" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.%s+xml"/>' % (name, kind))
            relationships.append('<Relationship Id="%s" Type="%s%s" Target="%s"/>' % (rid, REL_TYPE_BASE, kind, name))
            extra.append(("word/" + name, data))
            if rels is not None:
                extra.append(("word/_rels/" + name + ".rels", rels))
        defaults = "".join('<Default Extension="%s" ContentType="%s"/>' % (ext, MEDIA_CONTENT_TYPES[ext]) for ext in sorted({ext for _, _, ext in letterhead["media"]}))
        extra.extend((name, data) for name, data, _ in letterhead["media"])
        content_types = DOCX_CT.replace('<Default Extension="xml" ContentType="application/xml"/>', '<Default Extension="xml" ContentType="application/xml"/>' + defaults, 1).replace("</Types>", "".join(overrides) + "</Types>")
        doc_rels = DOCX_DOC_RELS.replace("</Relationships>", "".join(relationships) + "</Relationships>")
        if not own_footer:
            content_types = content_types.replace('<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>', "")
            doc_rels = doc_rels.replace('<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>', "")
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>%s%s</w:body></w:document>') % ("".join(body), sect)
    entries = [
        ("[Content_Types].xml", content_types),
        ("_rels/.rels", DOCX_ROOT_RELS),
        ("docProps/core.xml", DOCX_CORE),
        ("docProps/app.xml", DOCX_APP),
        ("word/document.xml", document),
        ("word/styles.xml", docx_styles_for(ast.get("styleProfile"))),
        ("word/settings.xml", DOCX_SETTINGS),
        ("word/fontTable.xml", DOCX_FONT),
        ("word/numbering.xml", DOCX_NUMBERING),
        *([("word/footer1.xml", DOCX_FOOTER)] if own_footer else []),
        ("word/_rels/document.xml.rels", doc_rels),
        *extra,
    ]
    return zip_bytes([(n, d.encode("utf-8") if isinstance(d, str) else d) for n, d in entries])

def odt_inline(nodes):
    # Lines of a text node with a line break each go into a span: deanonymization replaces
    # aliases in p/h/span text, and a tail after <text:line-break/> would be left as is.
    if any(node.get("type") == "text" and node.get("bold") is True for node in nodes or []):
        parts = []
        for node in nodes or []:
            style = ' text:style-name="T_bold"' if node.get("type") == "text" and node.get("bold") is True else ""
            lines = inline_text([node]).split("\n")
            parts.append("<text:line-break/>".join("<text:span%s>%s</text:span>" % (style, escape(line)) for line in lines))
        return "".join(parts)
    lines = inline_text(nodes).split("\n")
    if len(lines) == 1:
        return escape(lines[0])
    return "<text:line-break/>".join("<text:span>%s</text:span>" % escape(line) for line in lines)

ODT_ALIGN = {"right": "P_right", "half": "P_half", "center": "P_center", "left": "P_left", "justify": None,
             "place_date": "P_right", "party": "P_left", "addressee": "P_addressee"}

def odt_block(block, align=None):
    t = block.get("type")
    if t == "heading":
        level = int(block.get("level", 1))
        style = "H%d_center" % level if align == "center" else "Heading_20_%d" % level
        return '<text:h text:style-name="%s" text:outline-level="%d">%s</text:h>' % (style, level, odt_inline(block.get("content")))
    if t == "paragraph":
        style = ODT_ALIGN.get(align) or ("P_left" if has_line_break(block.get("content")) else None)
        return ('<text:p text:style-name="%s">%s</text:p>' % (style, odt_inline(block.get("content")))) if style else "<text:p>%s</text:p>" % odt_inline(block.get("content"))
    if t == "quote":
        return '<text:p text:style-name="Quote">%s</text:p>' % odt_inline(block.get("content"))
    if t == "signature":
        return '<text:p text:style-name="Signature">%s</text:p>' % odt_inline(block.get("content"))
    if t == "page_break":
        return '<text:p text:style-name="PageBreak"/>'
    if t == "list":
        start = block.get("start") if block.get("ordered") and isinstance(block.get("start"), int) and block.get("start") > 1 else None
        items = "".join(
            "<text:list-item%s><text:p>%s</text:p></text:list-item>" % (' text:start-value="%d"' % start if start and index == 0 else "", odt_inline(item))
            for index, item in enumerate(block.get("items") or [])
        )
        return '<text:list text:style-name="%s">%s</text:list>' % ("Numbered" if block.get("ordered") else "Bulleted", items)
    if t == "table":
        source_rows = block.get("rows") or []
        columns = max([len(row) for row in source_rows] or [1]) or 1
        rows = []
        for row in source_rows:
            cells = []
            for index in range(columns):
                cell = row[index] if index < len(row) else {"blocks": []}
                body = "".join(odt_block(child) for child in cell.get("blocks") or []) or "<text:p/>"
                cells.append('<table:table-cell table:style-name="Cell" office:value-type="string">%s</table:table-cell>' % body)
            rows.append("<table:table-row>%s</table:table-row>" % "".join(cells))
        return '<table:table table:name="Tabela" table:style-name="Table"><table:table-column table:number-columns-repeated="%d"/>%s</table:table>' % (columns, "".join(rows))
    raise ValueError("AST_BLOCK_TYPE_UNSUPPORTED")

def render_odt(ast):
    body = []
    if ast.get("title"):
        body.append('<text:p text:style-name="Title">%s</text:p>' % odt_inline(ast.get("title")))
    layout = block_layout(ast)
    body.extend(odt_block(block, layout.get(index)) for index, block in enumerate(ast.get("blocks") or []))
    content = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"><office:automatic-styles><style:style style:name="Table" style:family="table"><style:table-properties style:width="16cm" table:align="margins"/></style:style><style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #000000"/></style:style><style:style style:name="P_right" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="end"/></style:style><style:style style:name="P_half" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="8cm" fo:text-align="start"/></style:style><style:style style:name="P_left" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="start"/></style:style><style:style style:name="P_center" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/></style:style><style:style style:name="H1_center" style:family="paragraph" style:parent-style-name="Heading_20_1"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:text-transform="uppercase"/></style:style><style:style style:name="H2_center" style:family="paragraph" style:parent-style-name="Heading_20_2"><style:paragraph-properties fo:text-align="center"/></style:style><style:style style:name="H3_center" style:family="paragraph" style:parent-style-name="Heading_20_3"><style:paragraph-properties fo:text-align="center"/></style:style><style:style style:name="P_addressee" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="9cm" fo:text-align="start" fo:margin-bottom="0.42cm"/></style:style><style:style style:name="T_bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text>%s</office:text></office:body></office:document-content>""" % "".join(body)
    entries = [
        ("mimetype", ODT_MIMETYPE),
        ("content.xml", content.encode("utf-8")),
        ("styles.xml", odt_styles_for(ast.get("styleProfile")).encode("utf-8")),
        ("meta.xml", ODT_META.encode("utf-8")),
        ("settings.xml", ODT_SETTINGS.encode("utf-8")),
        ("META-INF/manifest.xml", ODT_MANIFEST.encode("utf-8")),
    ]
    return zip_bytes(entries, stored_first="mimetype")

def read_zip(data, allowed, required):
    if len(data) > MAX_PACKAGE_BYTES:
        raise ValueError("DOCUMENT_PACKAGE_TOO_LARGE")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data), "r")
    except zipfile.BadZipFile:
        raise ValueError("DOCUMENT_PACKAGE_INVALID")
    with zf:
        names = zf.namelist()
        if len(names) != len(set(names)):
            raise ValueError("DOCUMENT_PACKAGE_DUPLICATE_ENTRY")
        if any(not (allowed(name) if callable(allowed) else name in allowed) for name in names):
            raise ValueError("DOCUMENT_PACKAGE_FORBIDDEN_PART")
        if not required.issubset(set(names)):
            raise ValueError("DOCUMENT_PACKAGE_REQUIRED_PART_MISSING")
        total = 0
        entries = {}
        for info in zf.infolist():
            total += info.file_size
            if total > MAX_PACKAGE_BYTES * 4:
                raise ValueError("DOCUMENT_PACKAGE_EXPANSION_LIMIT")
            entries[info.filename] = zf.read(info.filename)
        return names, entries

def assert_no_external_relationships(entries):
    rel_ns = "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"
    for name, data in entries.items():
        if not name.endswith(".rels"):
            continue
        root = ET.fromstring(data)
        for rel in root.iter(rel_ns):
            if rel.attrib.get("TargetMode") == "External":
                raise ValueError("DOCUMENT_PACKAGE_EXTERNAL_RELATIONSHIP")

def extract_docx_text(entries):
    root = ET.fromstring(entries["word/document.xml"])
    ttag = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
    return "\n".join((node.text or "") for node in root.iter(ttag))

def extract_odt_text(entries):
    root = ET.fromstring(entries["content.xml"])
    text_ns = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    tags = {"{%s}p" % text_ns, "{%s}h" % text_ns}
    breaks = {"{%s}line-break" % text_ns, "{%s}tab" % text_ns, "{%s}s" % text_ns}
    def text_of(node):
        parts = [node.text or ""]
        for child in node:
            parts.append(" " if child.tag in breaks else text_of(child))
            parts.append(child.tail or "")
        return "".join(parts)
    return "\n".join(text_of(node) for node in root.iter() if node.tag in tags)

def validate_docx(data):
    names, entries = read_zip(data, docx_part_allowed, DOCX_REQUIRED)
    assert_no_external_relationships(entries)
    for name, raw in entries.items():
        if name.endswith(".xml") or name.endswith(".rels"):
            ET.fromstring(raw)
    text = extract_docx_text(entries)
    return names, entries, text

def validate_odt(data):
    names, entries = read_zip(data, ODT_ALLOWED, ODT_ALLOWED)
    if names[0] != "mimetype" or entries["mimetype"] != ODT_MIMETYPE:
        raise ValueError("ODT_MIMETYPE_INVALID")
    for name, raw in entries.items():
        if name.endswith(".xml"):
            ET.fromstring(raw)
    text = extract_odt_text(entries)
    return names, entries, text

# Verification markers belong to the chat, not to a filed document
# (STRIP-VER-GATE); drafts rendered before the runtime stripped them still
# carry them. Same set as lex-runtime src/verification-markers.ts.
VERIFICATION_MARKER_RE = re.compile(
    r"[ \t]*(?:✅|🟢|🟡|🟠|🔴|🔗|🟨|📚|⚠️|⚠)?\uFE0F?\s*"
    r"\[(?:VER(?:-FRAGMENT|-TREŚĆ)?|KALIBRACJA|BLOKADA|KOTWICA-TEKSTOWA|KOTWICA-URZĘDOWA|TREŚĆ|"
    r"NIEWERYFIKOWANE|CASE-QUOTE|CASE-SUPPORT)(?::[^\]\r\n]*)?\]"
)

def strip_verification_markers(text):
    stripped = VERIFICATION_MARKER_RE.sub("", text)
    return re.sub(r"[ \t]+([.,;:)\]])", r"\1", stripped) if stripped != text else text

def replace_text_nodes(root, tags, replacements):
    replaced = 0
    for node in root.iter():
        if node.tag in tags and node.tail and VERIFICATION_MARKER_RE.search(node.tail):
            node.tail = strip_verification_markers(node.tail)
        if node.tag not in tags or not node.text:
            continue
        original = strip_verification_markers(node.text)
        def repl(match):
            nonlocal replaced
            alias = match.group(0)
            # A grammatical case on an alias without inflected forms (a firm, a court, a
            # number): the base value, not a failed export.
            if alias not in replacements and "|" in alias:
                base = alias.split("|", 1)[0] + "]"
                if base in replacements:
                    replaced += 1
                    return replacements[base]
            if alias not in replacements:
                raise ValueError("DOCUMENT_ALIAS_UNKNOWN")
            replaced += 1
            return replacements[alias]
        node.text = ALIAS_RE.sub(repl, original)
    return replaced

def read_template_part(data, name):
    """One part of a firm's own template. A Word or LibreOffice template carries theme,
    header, media and other parts the generated package does not, so the strict package
    check (validate_docx) refused every real template and the firm's default template
    failed every generation. Only the styles part is read; size limits stay."""
    if len(data) > MAX_PACKAGE_BYTES:
        raise ValueError("DOCUMENT_PACKAGE_TOO_LARGE")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data), "r")
    except zipfile.BadZipFile:
        raise ValueError("DOCUMENT_PACKAGE_INVALID")
    with zf:
        try:
            info = zf.getinfo(name)
        except KeyError:
            return ""
        if info.file_size > MAX_PACKAGE_BYTES:
            raise ValueError("DOCUMENT_PACKAGE_EXPANSION_LIMIT")
        return zf.read(name).decode("utf-8", errors="ignore")

def extract_style_profile(fmt, data):
    if fmt == "docx":
        styles = read_template_part(data, "word/styles.xml").lower()
    elif fmt == "odt":
        styles = read_template_part(data, "styles.xml").lower()
    else:
        raise ValueError("DOCUMENT_FORMAT_UNSUPPORTED")

    if "times new roman" in styles:
        profile = "lex-classic-tnr-v1"
    elif "arial" in styles:
        profile = "lex-classic-clean-v1"
    else:
        profile = "lex-classic-clean-v1"

    return {
        "styleProfile": profile,
        "sourceFormat": fmt,
        "safe": True
    }

def deanonymize_docx(data, replacements):
    names, entries, _ = validate_docx(data)
    doc_name = "word/document.xml"
    root = ET.fromstring(entries[doc_name])
    tags = {"{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"}
    replaced = replace_text_nodes(root, tags, replacements)
    entries[doc_name] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    result = zip_bytes([(name, entries[name]) for name in names])
    _, _, text = validate_docx(result)
    if ALIAS_RE.search(text):
        raise ValueError("DOCUMENT_ALIAS_REMAINS")
    return result, text, replaced

def deanonymize_odt(data, replacements):
    names, entries, _ = validate_odt(data)
    root = ET.fromstring(entries["content.xml"])
    text_ns = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    tags = {"{%s}p" % text_ns, "{%s}h" % text_ns, "{%s}span" % text_ns}
    replaced = replace_text_nodes(root, tags, replacements)
    entries["content.xml"] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    result = zip_bytes([(name, entries[name]) for name in names], stored_first="mimetype")
    _, _, text = validate_odt(result)
    if ALIAS_RE.search(text):
        raise ValueError("DOCUMENT_ALIAS_REMAINS")
    return result, text, replaced

def main():
    raw = sys.stdin.buffer.read(MAX_PACKAGE_BYTES * 2)
    request = json.loads(raw.decode("utf-8"))
    operation = request.get("operation")
    if operation == "render":
        fmt = request.get("format")
        ast = request.get("ast")
        template = request.get("templateBase64")
        letterhead, template_report = None, None
        if template:
            # The firm's template: its letterhead goes into the file; a template whose parts
            # cannot be copied safely is reported, and the document keeps Lex's own layout.
            if fmt != "docx":
                template_report = {"applied": False, "reason": "TEMPLATE_FORMAT_UNSUPPORTED"}
            else:
                try:
                    letterhead = template_letterhead(base64.b64decode(template, validate=True))
                    template_report = {"applied": True,
                                       "headers": sum(1 for part in letterhead["parts"] if part[0] == "header"),
                                       "footers": sum(1 for part in letterhead["parts"] if part[0] == "footer"),
                                       "images": len(letterhead["media"])}
                except (ValueError, ET.ParseError) as exc:
                    template_report = {"applied": False, "reason": str(exc) or exc.__class__.__name__}
        if fmt == "docx":
            package = render_docx(ast, letterhead)
            _, _, text = validate_docx(package)
        elif fmt == "odt":
            package = render_odt(ast)
            _, _, text = validate_odt(package)
        else:
            raise ValueError("DOCUMENT_FORMAT_UNSUPPORTED")
        response = {"packageBase64": base64.b64encode(package).decode("ascii"), "text": text, "bytes": len(package)}
        if template_report is not None:
            response["template"] = template_report
    elif operation == "deanonymize":
        fmt = request.get("format")
        package = base64.b64decode(request.get("packageBase64", ""), validate=True)
        replacements = request.get("replacements") or {}
        if not isinstance(replacements, dict) or len(replacements) > 20000:
            raise ValueError("DOCUMENT_REPLACEMENTS_INVALID")
        for alias, value in replacements.items():
            if not ALIAS_RE.fullmatch(alias) or not isinstance(value, str) or len(value) > 100000:
                raise ValueError("DOCUMENT_REPLACEMENTS_INVALID")
        if fmt == "docx":
            result, text, replaced = deanonymize_docx(package, replacements)
        elif fmt == "odt":
            result, text, replaced = deanonymize_odt(package, replacements)
        else:
            raise ValueError("DOCUMENT_FORMAT_UNSUPPORTED")
        response = {"packageBase64": base64.b64encode(result).decode("ascii"), "text": text, "bytes": len(result), "replaced": replaced}
    elif operation == "validate":
        fmt = request.get("format")
        package = base64.b64decode(request.get("packageBase64", ""), validate=True)
        if fmt == "docx":
            _, _, text = validate_docx(package)
        elif fmt == "odt":
            _, _, text = validate_odt(package)
        else:
            raise ValueError("DOCUMENT_FORMAT_UNSUPPORTED")
        response = {"text": text, "bytes": len(package), "aliases": len(ALIAS_RE.findall(text))}
    elif operation == "profile":
        fmt = request.get("format")
        package = base64.b64decode(request.get("packageBase64", ""), validate=True)
        response = extract_style_profile(fmt, package)
    else:
        raise ValueError("DOCUMENT_RENDER_OPERATION_INVALID")
    sys.stdout.write(json.dumps(response, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stderr.write((str(exc) or exc.__class__.__name__) + "\n")
        raise SystemExit(2)
