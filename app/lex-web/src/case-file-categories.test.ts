import { describe, expect, it } from "vitest";
import { caseFileCategory, groupCaseFiles } from "./case-file-categories.js";

const file = (filename: string, mediaType: string, extra: Partial<{ kind: string; archive: boolean }> = {}) => ({
  kind: "UPLOAD",
  archive: false,
  filename,
  mediaType,
  ...extra
});

describe("caseFileCategory", () => {
  it.each([
    [file("pozew.pdf", "application/pdf"), "PDF"],
    [file("skan.jpg", "image/jpeg"), "IMAGE"],
    [file("odpowiedz.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "OFFICE"],
    [file("pismo.rtf", "application/rtf"), "OFFICE"],
    [file("rozprawa.m4a", "audio/mp4"), "RECORDING"],
    [file("rozprawa.mkv", "application/octet-stream"), "RECORDING"],
    [file("wiadomosc.eml", "message/rfc822"), "EMAIL"],
    [file("koszty.csv", "text/csv"), "SHEET"],
    [file("koszty.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "SHEET"],
    [file("notatka.txt", "text/plain"), "TEXT"],
    [file("akta.zip", "application/zip", { archive: true }), "ARCHIVE"],
    [file("wzor.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", { kind: "TEMPLATE" }), "TEMPLATE"],
    [file("dane.bin", "application/octet-stream"), "OTHER"]
  ])("%o -> %s", (item, category) => {
    expect(caseFileCategory(item)).toBe(category);
  });
});

describe("groupCaseFiles", () => {
  it("keeps category order and drops empty ones", () => {
    const groups = groupCaseFiles([
      file("a.jpg", "image/jpeg"),
      file("b.pdf", "application/pdf"),
      file("c.jpg", "image/png")
    ]);
    expect(groups.map((group) => [group.category, group.items.map((item) => item.filename)])).toEqual([
      ["PDF", ["b.pdf"]],
      ["IMAGE", ["a.jpg", "c.jpg"]]
    ]);
  });
});
