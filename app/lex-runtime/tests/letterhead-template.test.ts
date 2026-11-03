import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalLegalDocumentRenderer } from "../src/legal-document-renderer.js";
import type { LegalDocumentAst } from "../src/legal-document-ast.js";

// A letter rendered into the firm's template: the body is Lex's (the AST, checked against the
// file's text), the letterhead is the firm's — its header with the logo, its footer and page
// setup. A template whose parts cannot be copied safely is named and the file keeps Lex's layout.
const TEMPLATE = fs.readFileSync(path.join(__dirname, "fixtures/wzor-kancelaria-wezwanie.docx"));
const ast: LegalDocumentAst = {
  schemaVersion: "1",
  documentType: "letter",
  locale: "pl-PL",
  styleProfile: "lex-office-tnr-v1",
  title: [{ type: "text", text: "Wezwanie do zapłaty" }],
  blocks: [
    { type: "paragraph", role: "place_date", content: [{ type: "text", text: "Warszawa, 20 października 2026 r." }] },
    { type: "paragraph", role: "addressee", content: [{ type: "pii_ref", alias: "[LMPII:D01:PERSON:0001]" }] },
    { type: "paragraph", content: [{ type: "text", text: "Wzywam do zapłaty kwoty 40 000 zł w terminie 7 dni od doręczenia wezwania." }] },
    { type: "signature", content: [{ type: "text", text: "adw. [podpis]" }] }
  ]
};

function zipParts(data: Uint8Array): Record<string, string> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lex-lh-")), "f.docx");
  fs.writeFileSync(file, data);
  const run = spawnSync("python3", ["-c", "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n: z.read(n).decode('utf-8','replace') if n.endswith(('.xml','.rels')) else '<bin>' for n in z.namelist()}))", file]);
  return JSON.parse(run.stdout.toString("utf8"));
}

function withExternalLink(data: Buffer): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-lh-"));
  const src = path.join(dir, "in.docx");
  const out = path.join(dir, "out.docx");
  fs.writeFileSync(src, data);
  spawnSync("python3", ["-c", [
    "import sys,zipfile",
    "zi=zipfile.ZipFile(sys.argv[1]); zo=zipfile.ZipFile(sys.argv[2],'w')",
    "for n in zi.namelist():",
    "  d=zi.read(n)",
    "  if n=='word/_rels/header1.xml.rels': d=d.replace(b'</Relationships>', b'<Relationship Id=\"rIdX\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"https://example.invalid/\" TargetMode=\"External\"/></Relationships>')",
    "  zo.writestr(n,d)",
    "zo.close()"
  ].join("\n"), src, out]);
  return fs.readFileSync(out);
}

describe("pismo we wzorze kancelarii (nagłówek, stopka, układ strony)", () => {
  const renderer = new LocalLegalDocumentRenderer({ timeoutMs: 20_000 });

  it("treść z aplikacji, nagłówek z logo, stopka i marginesy ze wzoru", async () => {
    const plain = await renderer.render("docx", ast);
    const framed = await renderer.render("docx", ast, TEMPLATE);
    expect(framed.template).toEqual({ applied: true, headers: 1, footers: 1, images: 1 });
    // The body is the same text; the letterhead is not part of it.
    expect(framed.text).toBe(plain.text);
    expect(framed.text).not.toContain("KANCELARIA ADWOKACKA PRZYKŁADOWA");
    const parts = zipParts(framed.data);
    expect(parts["word/header100.xml"]).toContain("KANCELARIA ADWOKACKA PRZYKŁADOWA");
    expect(parts["word/footer101.xml"]).toContain("NIP 000-000-00-00");
    expect(parts["word/_rels/header100.xml.rels"]).toContain('Target="media/lex_t1.png"');
    expect(parts["word/media/lex_t1.png"]).toBe("<bin>");
    // The template's own footer replaces Lex's page-number footer.
    expect(parts["word/footer1.xml"]).toBeUndefined();
    expect(parts["word/document.xml"]).toContain('<w:headerReference w:type="default" r:id="rIdT1"/>');
    expect(parts["word/document.xml"]).toContain('w:top="1814"');
    expect(parts["[Content_Types].xml"]).toContain('<Default Extension="png" ContentType="image/png"/>');
    // Nothing of the template body (its sample text) is copied.
    expect(parts["word/document.xml"]).not.toContain("[kwota]");
    // The file passes the strict package check and deanonymization keeps the letterhead.
    expect((await renderer.validate("docx", framed.data)).aliases).toBe(1);
    const final = await renderer.deanonymize("docx", framed.data, new Map([["[LMPII:D01:PERSON:0001]", "Jan Kowalski"]]));
    expect(final.text).toContain("Jan Kowalski");
    expect(zipParts(final.data)["word/header100.xml"]).toContain("KANCELARIA ADWOKACKA PRZYKŁADOWA");
  }, 60_000);

  it("wzór z odnośnikiem zewnętrznym w nagłówku: nie jest kopiowany, plik w układzie Lex", async () => {
    const framed = await renderer.render("docx", ast, withExternalLink(TEMPLATE));
    expect(framed.template).toEqual({ applied: false, reason: "DOCUMENT_PACKAGE_EXTERNAL_RELATIONSHIP" });
    const parts = zipParts(framed.data);
    expect(parts["word/footer1.xml"]).toBeDefined();
    expect(Object.keys(parts).some((name) => name.startsWith("word/header"))).toBe(false);
  }, 60_000);

  it("ODT ze wzorem DOCX: wzór nazwany jako niezastosowany", async () => {
    const framed = await renderer.render("odt", ast, TEMPLATE);
    expect(framed.template).toEqual({ applied: false, reason: "TEMPLATE_FORMAT_UNSUPPORTED" });
  }, 60_000);

  it("plik bez wzoru: bez raportu wzoru (dotychczasowe zachowanie)", async () => {
    expect((await renderer.render("docx", ast)).template).toBeUndefined();
  }, 60_000);
});

// A Word template (.dotx) with fields: {{data}} split by Word over two runs, {{adresat}} in the
// body before {{treść}}, {{sygnatura}} and {{tytuł}} in the footer and header.
function fieldTemplate(): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-lh-f-"));
  const out = path.join(dir, "wzor.dotx");
  spawnSync("python3", ["-c", [
    "import sys,zipfile",
    "W='xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" mc:Ignorable=\"w14\"'",
    "doc='<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:document '+W+'><w:body><w:p><w:pPr><w:jc w:val=\"right\"/></w:pPr><w:r><w:t>Katowice, {{da</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ta}}</w:t></w:r></w:p><w:p><w:r><w:t>{{adresat}}</w:t></w:r></w:p><w:p><w:r><w:t>{{treść}}</w:t></w:r></w:p><w:p><w:r><w:t>Z poważaniem</w:t></w:r></w:p><w:sectPr><w:headerReference w:type=\"default\" r:id=\"rIdH\"/><w:footerReference w:type=\"default\" r:id=\"rIdF\"/><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1800\" w:right=\"1417\" w:bottom=\"1417\" w:left=\"1417\" w:header=\"700\" w:footer=\"500\"/></w:sectPr></w:body></w:document>'",
    "hdr='<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:hdr '+W+'><w:p w14:paraId=\"1\"><w:r><w:t>Kancelaria · {{tytuł}}</w:t></w:r></w:p></w:hdr>'",
    "ftr='<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:ftr '+W+'><w:p><w:r><w:t>Sygn. {{syg</w:t></w:r><w:r><w:t>natura}} · {{adresat}}</w:t></w:r></w:p></w:ftr>'",
    "rels='<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rIdH\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/header\" Target=\"header1.xml\"/><Relationship Id=\"rIdF\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer\" Target=\"footer1.xml\"/></Relationships>'",
    "z=zipfile.ZipFile(sys.argv[1],'w')",
    "z.writestr('[Content_Types].xml','<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml\"/></Types>')",
    "z.writestr('word/document.xml',doc); z.writestr('word/header1.xml',hdr); z.writestr('word/footer1.xml',ftr); z.writestr('word/_rels/document.xml.rels',rels); z.close()"
  ].join("\n"), out]);
  return fs.readFileSync(out);
}

describe("papier firmowy z polami ({{data}}, {{adresat}}, {{treść}} ...)", () => {
  const renderer = new LocalLegalDocumentRenderer({ timeoutMs: 20_000 });

  it("pola wypełnione z pisma, treść w miejscu {{treść}}, adresat z symbolem danych zostaje w treści", async () => {
    const framed = await renderer.render("docx", ast, fieldTemplate());
    expect(framed.template).toMatchObject({ applied: true, headers: 1, footers: 1, body: true });
    expect((framed.template as { fields?: string[] }).fields).toEqual(expect.arrayContaining(["data", "adresat", "tytul"]));
    const parts = zipParts(framed.data);
    const doc = parts["word/document.xml"]!;
    // Template paragraphs around the content, with their alignment and bold kept.
    expect(doc).toMatch(/<w:jc w:val="right"\/>.*Katowice, .*<w:b\/>/su);
    expect(doc.indexOf("Katowice")).toBeLessThan(doc.indexOf("Wzywam do zapłaty"));
    expect(doc.indexOf("Wzywam do zapłaty")).toBeLessThan(doc.indexOf("Z poważaniem"));
    expect(doc).not.toContain("{{");
    // The addressee names a person (a privacy symbol): in the body it is restored later; the
    // document's own addressee block stays (no symbol may be lost); the footer gets no symbol.
    expect(doc).toContain("[LMPII:D01:PERSON:0001]");
    expect(parts["word/footer101.xml"]).toContain("[UZUPEŁNIJ: adresat]");
    expect(parts["word/footer101.xml"]).not.toContain("LMPII");
    expect(parts["word/header100.xml"]).toContain("Kancelaria · Wezwanie do zapłaty");
    // The document's own place and date give way to the template's (no privacy symbol in it).
    expect(doc).not.toContain("Warszawa, 20 października 2026 r.");
    // Nothing of the template package beyond plain formatting reaches the body.
    expect(doc).not.toContain("w14:");
    const final = await renderer.deanonymize("docx", framed.data, new Map([["[LMPII:D01:PERSON:0001]", "Jan Kowalski"]]));
    expect(final.text).toContain("Jan Kowalski");
  }, 60_000);
});
