import { describe, expect, it } from "vitest";
import { LocalOfficeEditor, editableMediaType, type EditableDocument, type EditableSheets } from "../src/office-edit.js";

const editor = new LocalOfficeEditor();

const document: EditableDocument = {
  kind: "document",
  blocks: [
    { type: "heading", level: 1, runs: [{ text: "POZEW O ZAPŁATĘ", b: false, i: false, u: false }] },
    {
      type: "paragraph",
      runs: [
        { text: "Powód ", b: false, i: false, u: false },
        { text: "wnosi", b: true, i: false, u: false },
        { text: " o zasądzenie", b: false, i: true, u: true }
      ]
    },
    { type: "list", ordered: true, items: [[{ text: "pierwszy", b: false, i: false, u: false }]] },
    { type: "list", ordered: false, items: [[{ text: "punkt", b: false, i: false, u: false }]] },
    { type: "table", rows: [["Kwota", "1000,00 zł"], ["Odsetki", "ustawowe"]] }
  ]
};

describe("office editor worker", () => {
  it.each(["docx", "odt"] as const)("round-trips a document through %s", async (format) => {
    const bytes = await editor.write(format, document);
    const mediaType = editableMediaType("", `pismo.${format}`)!;
    expect(await editor.read(bytes, mediaType)).toEqual(document);
  });

  it("round-trips sheets through xlsx keeping formulas and identifiers as text", async () => {
    const model: EditableSheets = {
      kind: "sheet",
      truncated: false,
      sheets: [
        { name: "Roszczenia", rows: [["Pozycja", "Kwota"], ["Czynsz", "1200.5"], ["Suma", "=SUM(B2:B2)"]] },
        { name: "Strony", rows: [["PESEL", "00000000000"], ["NIP", "0123456789"]] }
      ]
    };
    const bytes = await editor.write("xlsx", model);
    const read = await editor.read(bytes, editableMediaType("application/octet-stream", "a.xlsx")!);
    expect(read).toMatchObject({ kind: "sheet", truncated: false, sheets: model.sheets });
  });

  it("writes CSV with the requested delimiter and reads it back", async () => {
    const model: EditableSheets = {
      kind: "sheet",
      truncated: false,
      sheets: [{ name: "Arkusz1", rows: [["Imię", "Kwota"], ["Zażółć; gęślą", "10"]] }]
    };
    const bytes = await editor.write("csv", model, ";");
    const read = (await editor.read(bytes, "text/csv")) as EditableSheets;
    expect(read.sheets[0]!.rows).toEqual(model.sheets[0]!.rows);
  });

  it("rejects files that are not what they claim", async () => {
    await expect(editor.read(Buffer.from("not a zip"), editableMediaType("", "a.docx")!)).rejects.toThrow(
      /OFFICE_EDIT_|SPREADSHEET_/
    );
    await expect(editor.read(Buffer.from("x"), "application/msword")).rejects.toThrow(
      "OFFICE_EDIT_MEDIA_TYPE_UNSUPPORTED"
    );
  });

  it("DOCX ze śledzonymi zmianami: autor i data na każdej zmianie, odczyt daje tekst po zmianach", async () => {
    const edited: EditableDocument = {
      kind: "document",
      blocks: [
        { type: "heading", level: 1, runs: [{ text: "POZEW O ZAPŁATĘ", b: false, i: false, u: false }] },
        {
          type: "paragraph",
          runs: [
            { text: "Powód ", b: false, i: false, u: false },
            { text: "wnosi", b: true, i: false, u: false },
            { text: " o zasądzenie 2000 zł", b: false, i: true, u: true }
          ]
        },
        { type: "paragraph", runs: [{ text: "Nowy akapit o kosztach.", b: false, i: false, u: false }] },
        { type: "list", ordered: true, items: [[{ text: "pierwszy", b: false, i: false, u: false }]] },
        { type: "list", ordered: false, items: [[{ text: "punkt", b: false, i: false, u: false }]] },
        { type: "table", rows: [["Kwota", "2000,00 zł"], ["Odsetki", "ustawowe"]] }
      ]
    };
    const bytes = await editor.write("docx", edited, undefined, { baseline: document, author: "Anna <Nowak>", date: "2026-11-03T10:00:00Z" });
    const { inflateRawSync } = await import("node:zlib");
    // word/document.xml from the ZIP (local header: name length at 26, extra at 28, data after).
    const name = Buffer.from("word/document.xml");
    const at = bytes.indexOf(name) - 30;
    const size = bytes.readUInt32LE(at + 18);
    const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
    const raw = bytes.subarray(start, start + size);
    const xml = (bytes.readUInt16LE(at + 8) === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    expect(xml).toContain('w:author="Anna &lt;Nowak&gt;" w:date="2026-11-03T10:00:00Z"');
    expect(xml).toContain('<w:t xml:space="preserve">POZEW O ZAPŁATĘ</w:t>');
    expect(xml).toMatch(/<w:ins [^>]*><w:r><w:rPr><w:i\/><w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve"> 2000 zł<\/w:t>/u);
    expect(xml).toMatch(/<w:pPr><w:rPr><w:ins [^>]*\/><\/w:rPr><\/w:pPr>/u);
    expect(xml).toContain("<w:delText xml:space=\"preserve\">1000,00</w:delText>");
    expect(xml).toMatch(/<w:ins [^>]*><w:r><w:t xml:space="preserve">Nowy akapit o kosztach.<\/w:t>/u);
    expect(xml).toContain("<w:tblGrid>");
    // Read back: the text with the changes accepted.
    expect(await editor.read(bytes, editableMediaType("", "a.docx")!)).toEqual(edited);
  });

  it("PDF z modelu dokumentu: polskie litery, wiele stron; arkusz odrzucony", async () => {
    const long: EditableDocument = {
      kind: "document",
      blocks: [
        ...document.blocks,
        ...Array.from({ length: 80 }, (_, i) => ({ type: "paragraph" as const, runs: [{ text: `Akapit ${i + 1}: zażółć gęślą jaźń.`, b: false, i: false, u: false }] }))
      ]
    };
    const python = process.env.LEX_STORAGE_PYTHON ?? "python3";
    const { spawnSync } = await import("node:child_process");
    if (spawnSync(python, ["-c", "import pymupdf"]).status !== 0) return;
    const bytes = await editor.write("pdf", long);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = spawnSync(python, ["-c", "import sys, pymupdf; d = pymupdf.open(stream=sys.stdin.buffer.read(), filetype='pdf'); print(d.page_count); print(d[0].get_text())"], { input: bytes }).stdout.toString("utf8");
    expect(Number(text.split("\n")[0])).toBeGreaterThan(1);
    expect(text).toContain("POZEW O ZAPŁATĘ");
    expect(text).toContain("1000,00 zł");
    await expect(editor.write("pdf", { kind: "sheet", truncated: false, sheets: [] })).rejects.toThrow("OFFICE_EDIT_FORMAT_UNSUPPORTED");
  });

  it("resolves editable media types from type or extension", () => {
    expect(editableMediaType("text/csv; charset=utf-8", "a.txt")).toBe("text/csv");
    expect(editableMediaType("application/octet-stream", "Umowa.ODT")).toBe("application/vnd.oasis.opendocument.text");
    expect(editableMediaType("application/pdf", "a.pdf")).toBeNull();
  });
});
