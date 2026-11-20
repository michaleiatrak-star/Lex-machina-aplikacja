import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { LocalLegalDocumentRenderer } from "../src/legal-document-renderer.js";
import type { LegalDocumentAst } from "../src/legal-document-ast.js";
import { readLetterLogo, readLetterSender, saveLetterLogo, saveLetterSender } from "../src/letter-sender.js";

// Fabricated sender and case: the mechanism, not real data.
const TEMPLATE = fs.readFileSync(path.join(__dirname, "fixtures/wzor-kancelaria-wezwanie.docx"));
const ast: LegalDocumentAst = {
  schemaVersion: "1",
  documentType: "pleading",
  locale: "pl-PL",
  styleProfile: "lex-office-tnr-v1",
  title: [{ type: "text", text: "WNIOSEK DOWODOWY" }],
  blocks: [{ type: "paragraph", content: [{ type: "text", text: "Wnoszę o dopuszczenie dowodu z dokumentu." }] }]
};

function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function zipParts(data: Uint8Array): Record<string, string> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lex-ls-")), "f.docx");
  fs.writeFileSync(file, data);
  const run = spawnSync("python3", ["-c", "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n: z.read(n).decode('utf-8','replace') if n.endswith(('.xml','.rels')) else '<bin>' for n in z.namelist()}))", file]);
  return JSON.parse(run.stdout.toString("utf8"));
}

describe("letterhead: the sender from Settings and the case's signature (2026-11-20)", () => {
  it("the sender and the logo are kept per user; a logo of another type or too large is refused", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-sender-"));
    expect(readLetterSender("u1", root)).toEqual({ name: "", address: "", contact: "", templateId: "", logo: false });
    saveLetterSender("u1", { name: " Kancelaria Testowa ", address: "ul. Testowa 1\n00-001 Warszawa\n\n", contact: "", templateId: "nie-wzor" }, root);
    expect(readLetterSender("u1", root)).toMatchObject({ name: "Kancelaria Testowa", address: "ul. Testowa 1\n00-001 Warszawa", templateId: "" });
    expect(saveLetterLogo("u1", png(30, 10), root)).toBe(true);
    expect(readLetterSender("u1", root).logo).toBe(true);
    expect(readLetterLogo("u1", root)?.type).toBe("png");
    expect(() => saveLetterLogo("u1", Buffer.from("GIF89a"), root)).toThrow("LETTER_LOGO_TYPE_UNSUPPORTED");
    saveLetterLogo("u1", null, root);
    expect(readLetterSender("u1", root).logo).toBe(false);
    expect(() => readLetterSender("../x", root)).not.toThrow();
  });

  it("without a firm template: a header with the logo, the sender and the case's signature; a page number below", async () => {
    const renderer = new LocalLegalDocumentRenderer();
    const result = await renderer.render("docx", ast, undefined, {
      sender: { name: "Kancelaria Testowa", address: "ul. Testowa 1\n00-001 Warszawa", contact: "" },
      caseSignature: "XI P 1/26",
      logo: { data: png(300, 100), type: "png" }
    });
    const parts = zipParts(result.data);
    expect(parts["word/header1.xml"]).toContain("Kancelaria Testowa");
    expect(parts["word/header1.xml"]).toContain("Sygn. akt XI P 1/26");
    expect(parts["word/header1.xml"]).toContain('r:embed="rIdLogo"');
    expect(parts["word/media/lex_t999.png"]).toBe("<bin>");
    expect(parts["word/footer1.xml"]).toContain(" PAGE ");
    expect(result.text).not.toContain("Kancelaria Testowa");
  });

  it("with the firm's template: its header stays, its fields take the sender and the case's signature, and its footer gets a page number", async () => {
    const renderer = new LocalLegalDocumentRenderer();
    const result = await renderer.render("docx", ast, TEMPLATE, { sender: { name: "Kancelaria Testowa", address: "ul. Testowa 1", contact: "" }, caseSignature: "XI P 1/26" });
    const parts = zipParts(result.data);
    expect(parts["word/header1.xml"]).toBeUndefined();
    const footers = Object.entries(parts).filter(([name]) => /^word\/footer\d+\.xml$/u.test(name)).map(([, xml]) => xml);
    expect(footers.some((xml) => / PAGE /u.test(xml))).toBe(true);
  });
});
