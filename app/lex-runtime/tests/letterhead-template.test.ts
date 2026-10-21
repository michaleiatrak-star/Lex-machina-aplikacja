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
