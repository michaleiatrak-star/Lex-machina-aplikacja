import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecureCaseDocumentStore } from "../src/case-document-store.js";
import type { DocumentIngestionResult, IngestedPage } from "../src/document-ingestion.js";

const caseId = `case_${"a".repeat(32)}`;
const documentId = `doc_${"b".repeat(24)}`;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup(keyVersion = 1): { root: string; store: SecureCaseDocumentStore; docDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-page-images-"));
  roots.push(root);
  const caseDir = path.join(root, "cases", caseId);
  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(path.join(caseDir, "case.json"), JSON.stringify({ caseId, keyVersion, createdByUserId: "user_1" }));
  return { root, store: new SecureCaseDocumentStore({ rootDir: root }), docDir: path.join(caseDir, "secure", "documents", documentId) };
}

function setKeyVersion(root: string, keyVersion: number): void {
  fs.writeFileSync(path.join(root, "cases", caseId, "case.json"), JSON.stringify({ caseId, keyVersion, createdByUserId: "user_1" }));
}

function source(count: number): DocumentIngestionResult {
  const pages: IngestedPage[] = Array.from({ length: count }, (_, index) => ({
    page: index + 1,
    text: `strona ${index + 1}`,
    source: "OCR",
    lines: [{ text: `strona ${index + 1}`, box: [0, 0, 10, 10] }],
    image: { jpeg: randomBytes(200_000).toString("base64"), width: 100, height: 140, unread: [[1, 1, 2, 2]] }
  }));
  return {
    sha256: "c".repeat(64),
    totalPages: count,
    complete: true,
    pages,
    chunks: [],
    sourceChars: 0
  } as unknown as DocumentIngestionResult;
}

describe("SecureCaseDocumentStore: page images outside source.lme", () => {
  it("writes each image once, keeps source small across text edits and restores images on load", async () => {
    const { store, docDir } = setup();
    const key = randomBytes(32);
    const original = source(40);
    await store.saveSource({ caseId, documentId, mediaType: "application/pdf", source: original, caseDataKey: key, keyVersion: 1 });

    const sourceFile = path.join(docDir, "source.lme");
    expect(fs.readdirSync(path.join(docDir, "images"))).toHaveLength(40);
    expect(fs.statSync(sourceFile).size).toBeLessThan(100_000);
    const imageTimes = fs.readdirSync(path.join(docDir, "images")).map((name) => fs.statSync(path.join(docDir, "images", name)).mtimeMs);

    // Text edit of page 3: the page loses its image (as in editPage); other blobs stay untouched.
    const { image: _dropped, lines: _lines, ...edited } = original.pages[2]!;
    const next = { ...original, pages: original.pages.map((page, index) => (index === 2 ? { ...edited, text: "poprawione", editedByUser: true } : page)) };
    await store.saveSource({ caseId, documentId, mediaType: "application/pdf", source: next, caseDataKey: key, keyVersion: 1 });
    const names = fs.readdirSync(path.join(docDir, "images"));
    expect(names).toHaveLength(39);
    expect(names.map((name) => fs.statSync(path.join(docDir, "images", name)).mtimeMs).every((time) => imageTimes.includes(time))).toBe(true);

    const loaded = await store.loadSource({ caseId, documentId, caseDataKey: key, keyVersion: 1 });
    expect(loaded.source.pages[2]!.image).toBeUndefined();
    expect(loaded.source.pages[2]!.text).toBe("poprawione");
    expect(loaded.source.pages[0]!.image).toEqual(original.pages[0]!.image);
    expect(loaded.source.pages[39]!.image?.jpeg).toBe(original.pages[39]!.image!.jpeg);
  });

  it("rekeys image blobs with the case key", async () => {
    const { root, store } = setup();
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const original = source(3);
    await store.saveSource({ caseId, documentId, mediaType: "application/pdf", source: original, caseDataKey: oldKey, keyVersion: 1 });
    await store.rekeyCaseDocuments({ caseId, oldCaseDataKey: oldKey, oldKeyVersion: 1, newCaseDataKey: newKey, newKeyVersion: 2 });
    setKeyVersion(root, 2);
    const loaded = await store.loadSource({ caseId, documentId, caseDataKey: newKey, keyVersion: 2 });
    expect(loaded.source.pages.map((page) => page.image?.jpeg)).toEqual(original.pages.map((page) => page.image!.jpeg));
  });

  it("a missing image blob leaves the page text-only instead of failing the document", async () => {
    const { store, docDir } = setup();
    const key = randomBytes(32);
    await store.saveSource({ caseId, documentId, mediaType: "application/pdf", source: source(2), caseDataKey: key, keyVersion: 1 });
    const [first] = fs.readdirSync(path.join(docDir, "images"));
    fs.rmSync(path.join(docDir, "images", first!));
    const loaded = await store.loadSource({ caseId, documentId, caseDataKey: key, keyVersion: 1 });
    expect(loaded.source.pages.filter((page) => page.image)).toHaveLength(1);
    expect(loaded.source.pages.map((page) => page.text)).toEqual(["strona 1", "strona 2"]);
  });
});
