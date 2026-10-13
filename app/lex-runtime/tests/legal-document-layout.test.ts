import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legalDocumentPlainText, type LegalDocumentAst } from "../src/legal-document-ast.js";
import { LocalLegalDocumentRenderer } from "../src/legal-document-renderer.js";

// Layout of generated letters and pleadings (pisma-proste-v2 M4-struktura, pisma-procesowe-v3
// MOD-SZABLONY), tables and lists that LibreOffice/Word render as written, and the text the
// export gate compares with the AST.

const renderer = new LocalLegalDocumentRenderer({ timeoutMs: 20_000 });
const text = (value: string) => [{ type: "text" as const, text: value }];

const pleading: LegalDocumentAst = {
  schemaVersion: "1",
  documentType: "pleading",
  locale: "pl-PL",
  styleProfile: "lex-classic-clean-v1",
  blocks: [
    { type: "paragraph", content: text("Kraków, dnia 13 października 2026 r.") },
    { type: "paragraph", content: text("Sąd Rejonowy dla Krakowa-Śródmieścia w Krakowie\nI Wydział Cywilny\nul. Przy Rondzie 7, 31-547 Kraków") },
    { type: "paragraph", content: [...text("Powód: "), { type: "pii_ref", alias: "[LMPII:D01:PERSON:0001]", case: "NOM" }, ...text("\nul. Długa 1, 30-001 Kraków")] },
    { type: "paragraph", content: [...text("Pozwany: "), { type: "pii_ref", alias: "[LMPII:D01:ORGANIZATION:0002]", case: "NOM" }] },
    { type: "heading", level: 1, content: text("Pozew o zapłatę") },
    { type: "list", ordered: true, items: [text("zasądzenie kwoty 48 000 zł;"), text("zasądzenie kosztów procesu.")] },
    { type: "heading", level: 2, content: text("Uzasadnienie") },
    { type: "paragraph", content: text("Pozwany nie zapłacił faktury końcowej.") },
    {
      type: "table",
      rows: [
        [{ blocks: [{ type: "paragraph", content: text("Dowód") }] }, { blocks: [{ type: "paragraph", content: text("Teza") }] }],
        [{ blocks: [{ type: "paragraph", content: text("Protokół odbioru") }] }],
        [{ blocks: [] }, { blocks: [{ type: "paragraph", content: text("odbiór bez zastrzeżeń") }] }]
      ]
    },
    { type: "signature", content: text("Jan Kowalski") }
  ]
};

function unzip(data: Uint8Array, part: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-layout-"));
  const file = path.join(dir, "package.zip");
  fs.writeFileSync(file, data);
  try {
    return execFileSync("python3", ["-I", "-c", "import sys,zipfile;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())", file, part], { encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const normalized = (value: string) => value.replace(/\s+/g, " ").trim();

describe("generated letter and pleading layout", () => {
  for (const format of ["docx", "odt"] as const) {
    it(`${format}: the text the export gate compares equals the AST text (line breaks included)`, async () => {
      const rendered = await renderer.render(format, pleading);
      const checked = await renderer.validate(format, rendered.data);
      // document-authoring-service compares the file's text with the render's text.
      expect(normalized(checked.text)).toBe(normalized(rendered.text));
      // Line breaks keep the words apart; list numbers and cell separators are the only differences from the AST text.
      const ast = normalized(legalDocumentPlainText(pleading)).replace(/ \| /gu, " ");
      expect(normalized(checked.text).replace(/(?<= )\d+\. /gu, "")).toBe(ast);
    });
  }

  it("docx: place and date right, court in the right half, centred title in capitals, page number, table grid", async () => {
    const xml = unzip((await renderer.render("docx", pleading)).data, "word/document.xml");
    const paragraphs = xml.split("<w:p>").slice(1);
    expect(paragraphs.find((item) => item.includes("Kraków, dnia"))).toContain('<w:jc w:val="right"/>');
    expect(paragraphs.find((item) => item.includes("Sąd Rejonowy"))).toMatch(/<w:ind w:left="\d+"\/>/u);
    expect(paragraphs.find((item) => item.includes("Sąd Rejonowy"))).toContain("<w:br/>");
    const title = paragraphs.find((item) => item.includes("Pozew o zapłatę"))!;
    expect(title).toContain('<w:jc w:val="center"/>');
    expect(title).toContain("<w:caps/>");
    expect(xml).toContain('<w:footerReference w:type="default" r:id="rId5"/>');
    expect(xml.match(/<w:gridCol /gu)).toHaveLength(2);
    // Every row has two cells and no cell is empty of paragraphs.
    for (const row of xml.split("<w:tr>").slice(1)) expect(row.split("<w:tc>").length - 1).toBe(2);
    expect(xml).not.toMatch(/<w:tc><w:tcPr>[^]*?<\/w:tcPr><\/w:tc>/u);
    const styles = unzip((await renderer.render("docx", pleading)).data, "word/styles.xml");
    expect(styles).toMatch(/w:styleId="Heading1"><w:name w:val="heading 1"\/><w:basedOn w:val="Normal"\/>/u);
  });

  it("odt: ordered list numbered, table columns declared, signature and header styles defined", async () => {
    const rendered = await renderer.render("odt", pleading);
    const content = unzip(rendered.data, "content.xml");
    const styles = unzip(rendered.data, "styles.xml");
    expect(content).toContain('<text:list text:style-name="Numbered">');
    expect(content).toContain('table:number-columns-repeated="2"');
    expect(content).toMatch(/text:style-name="P_right">Kraków, dnia/u);
    expect(content).toContain('text:style-name="H1_center"');
    for (const name of ["Signature", "Quote", "PageBreak", "Numbered", "Heading_20_1"]) expect(styles).toContain(`style:name="${name}"`);
    expect(styles).toContain("<text:page-number");
  });

  for (const format of ["docx", "odt"] as const) {
    it(`${format}: a case on an alias without inflected forms restores the base value; names after a line break are restored`, async () => {
      const rendered = await renderer.render(format, pleading);
      const restored = await renderer.deanonymize(
        format,
        rendered.data,
        new Map([
          ["[LMPII:D01:PERSON:0001|NOM]", "Jan Kowalski"],
          ["[LMPII:D01:ORGANIZATION:0002]", "Budex sp. z o.o."]
        ])
      );
      expect(normalized(restored.text)).toContain("Powód: Jan Kowalski ul. Długa 1");
      expect(normalized(restored.text)).toContain("Pozwany: Budex sp. z o.o.");
    });
  }

  it("a firm's own Word template (theme, settings, header parts) gives a style profile instead of an error", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-template-"));
    const file = path.join(dir, "szablon.docx");
    const styles = '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>';
    execFileSync("python3", [
      "-I",
      "-c",
      "import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],'w')\nfor n,d in [('[Content_Types].xml','<Types/>'),('word/document.xml','<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>'),('word/styles.xml',sys.argv[2]),('word/theme/theme1.xml','<a:theme xmlns:a=\"x\"/>'),('word/webSettings.xml','<w:webSettings xmlns:w=\"x\"/>'),('word/header1.xml','<w:hdr xmlns:w=\"x\"/>'),('word/media/logo.png','png')]: z.writestr(n,d)\nz.close()",
      file,
      styles
    ]);
    try {
      const profile = await renderer.extractStyleProfile("docx", fs.readFileSync(file));
      expect(profile.styleProfile).toBe("lex-classic-tnr-v1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
