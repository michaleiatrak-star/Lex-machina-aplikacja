import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeDownloadFilename, saveToDownloads } from "../src/download-save.js";

const temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-downloads-"));
  temporary.push(dir);
  return dir;
}

describe("zapis pisma w folderze Pobrane (desktop)", () => {
  it("zapisuje pod bezpieczną nazwą i nie nadpisuje istniejącego pliku", async () => {
    const dir = tempDir();
    const first = await saveToDownloads("LexMachina-dokument.docx", Buffer.from("A"), dir);
    const second = await saveToDownloads("LexMachina-dokument.docx", Buffer.from("B"), dir);
    expect(first.filename).toBe("LexMachina-dokument.docx");
    expect(second.filename).toBe("LexMachina-dokument (2).docx");
    expect(fs.readFileSync(first.path, "utf8")).toBe("A");
    expect(fs.readFileSync(second.path, "utf8")).toBe("B");
  });

  it("nie wychodzi poza folder i przyjmuje tylko dokumenty", () => {
    expect(safeDownloadFilename("../../Windows/evil.docx")).toBe("evil.docx");
    expect(safeDownloadFilename("..\\..\\a:b.odt")).toBe("a_b.odt");
    expect(safeDownloadFilename("CON.pdf")).toBe("_CON.pdf");
    expect(() => safeDownloadFilename("skrypt.exe")).toThrow("DOWNLOAD_FILE_TYPE_NOT_ALLOWED");
    expect(() => safeDownloadFilename("bez-rozszerzenia")).toThrow("DOWNLOAD_FILE_TYPE_NOT_ALLOWED");
  });
});
