import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encryptedKind, LocalDocumentDecryptor, passwordFromHeader } from "../src/document-decryption.js";
import { LocalOfficeDocumentTextExtractor } from "../src/office-document-extractor.js";
import { hasStoredDocumentSignature, storedDocumentMediaType } from "../src/stored-document-source.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

describe("pliki chronione hasłem", () => {
  it("rozpoznaje zaszyfrowany DOCX (plik OLE zamiast ZIP) i PDF ze słownikiem /Encrypt", () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(encryptedKind(ole, DOCX)).toBe("office");
    expect(encryptedKind(new Uint8Array([0x50, 0x4b, 3, 4]), DOCX)).toBeNull();
    expect(encryptedKind(new TextEncoder().encode("%PDF-1.7\n1 0 obj\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>"), "application/pdf")).toBe("pdf");
    expect(encryptedKind(new TextEncoder().encode("%PDF-1.7\ntrailer << /Root 1 0 R >>"), "application/pdf")).toBeNull();
    // MuPDF writes the dictionary inline, without a space.
    expect(encryptedKind(new TextEncoder().encode("%PDF-1.7\n<</Type/XRef/Encrypt<</Filter/Standard/V 5>>>>"), "application/pdf")).toBe("pdf");
    expect(encryptedKind(new TextEncoder().encode("%PDF-1.7\n<</EncryptMetadata false>>"), "application/pdf")).toBeNull();
  });

  it("hasło z nagłówka: zakodowane procentowo, puste i za długie odrzucone", () => {
    expect(passwordFromHeader(encodeURIComponent("zażółć 123"))).toBe("zażółć 123");
    expect(passwordFromHeader(undefined)).toBeNull();
    expect(passwordFromHeader("%E0%A4%A")).toBeNull();
    expect(passwordFromHeader("x".repeat(1025))).toBeNull();
  });

  it("worker: plik odszyfrowany zwraca treść; złe hasło i plik bez hasła mają własne kody", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-decrypt-"));
    const worker = path.join(dir, "worker.cjs");
    await writeFile(
      worker,
      `
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const req = JSON.parse(raw);
  if (req.password === "") { process.stderr.write("DOCUMENT_PASSWORD_INVALID\\n"); process.exit(2); }
  if (req.password === "plain") { process.stderr.write("DOCUMENT_NOT_ENCRYPTED\\n"); process.exit(2); }
  if (req.password !== "tajne") { process.stderr.write("DOCUMENT_PASSWORD_INVALID\\n"); process.exit(2); }
  process.stdout.write(JSON.stringify({ dataBase64: Buffer.from("PK" + Buffer.from(req.dataBase64, "base64").toString()).toString("base64") }));
});
`
    );
    const decryptor = new LocalDocumentDecryptor({ python: process.execPath, workerPath: worker });
    expect(Buffer.from(await decryptor.decrypt(new TextEncoder().encode("X"), "office", "tajne")).toString()).toBe("PKX");
    await expect(decryptor.decrypt(new Uint8Array([1]), "office", "zle")).rejects.toThrow("DOCUMENT_PASSWORD_INVALID");
    await expect(decryptor.decrypt(new Uint8Array([1]), "pdf", "")).rejects.toThrow("DOCUMENT_PASSWORD_INVALID");
    await expect(decryptor.decrypt(new Uint8Array([1]), "pdf", "plain")).rejects.toThrow("DOCUMENT_NOT_ENCRYPTED");
  });
});

describe("e-mail (.eml) i RTF jako dokument", () => {
  const extractor = new LocalOfficeDocumentTextExtractor({ timeoutMs: 20_000 });

  it("e-mail: nagłówki po polsku, treść, lista załączników", async () => {
    const eml = [
      "From: Anna Nowak <anna@example.pl>",
      "To: kancelaria@example.pl",
      "Subject: =?utf-8?q?Wezwanie_do_zap=C5=82aty?=",
      "Date: Mon, 2 Nov 2026 10:00:00 +0100",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="B"',
      "",
      "--B",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Dzień dobry,<br>w załączeniu <b>wezwanie</b>.</p>",
      "--B",
      "Content-Type: application/pdf",
      'Content-Disposition: attachment; filename="wezwanie.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjQK",
      "--B--",
      ""
    ].join("\r\n");
    const text = await extractor.extract(new TextEncoder().encode(eml), "message/rfc822");
    expect(text).toContain("Od: Anna Nowak <anna@example.pl>");
    expect(text).toContain("Temat: Wezwanie do zapłaty");
    expect(text).toContain("Dzień dobry,\nw załączeniu wezwanie.");
    expect(text).toContain("Załączniki: wezwanie.pdf");
    expect(storedDocumentMediaType("message/rfc822")).toBe("message/rfc822");
    expect(hasStoredDocumentSignature(new TextEncoder().encode(eml), "message/rfc822")).toBe(true);
  }, 30_000);

  it("RTF: akapity, tabulator, polskie litery ze strony kodowej i z Unicode, bez tablic czcionek", async () => {
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1250\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}" +
      "\\f0 Pozew o zap\\'b3at\\'ea\\par Kwota\\tab 40 000 z\\'b3\\par \\u347?wiadczenie{\\*\\generator Word;}}";
    const text = await extractor.extract(new TextEncoder().encode(rtf), "application/rtf");
    expect(text).toBe("Pozew o zapłatę\nKwota\t40 000 zł\nświadczenie");
    expect(text).not.toContain("Times New Roman");
    expect(hasStoredDocumentSignature(new TextEncoder().encode(rtf), "application/rtf")).toBe(true);
  }, 30_000);
});
