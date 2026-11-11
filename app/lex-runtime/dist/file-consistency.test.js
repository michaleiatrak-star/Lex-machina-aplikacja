import { describe, expect, it } from "vitest";
import { astLines, compareFileWithDraft, draftLines, fileCheckReason, wrongSums } from "./file-consistency.js";
const DRAFT = [
    "Wnoszę o zasądzenie 12 000,00 zł ✅ [VER: isap.sejm.gov.pl, 2026-05-25].",
    "Należność 10 000 zł + odsetki 2 000 zł; 10 000 + 2 000 = 12 000.",
    "Umowa z 12 marca 2026 r. (zał. nr 1), wezwanie z 01.04.2026 (zał. nr 2).",
    "",
    "**Załączniki:**",
    "1. umowa z 12.03.2026",
    "2. wezwanie do zapłaty",
    "",
    "CZĘŚĆ ROBOCZA",
    "metryka: 999 zł, 2020-01-01"
].join("\n");
const text = (value) => [{ type: "text", text: value }];
function ast(overrides = {}) {
    return {
        schemaVersion: "1",
        blocks: [
            { type: "paragraph", content: [...text("Powód wnosi o zasądzenie "), { type: "text", text: "12 000 zł" }, ...text(".")] },
            { type: "paragraph", content: text(`Należność 10 000 zł + odsetki ${overrides.amount ?? "2 000"} zł; ${overrides.sum ?? "10 000 + 2 000 = 12 000"}.`) },
            { type: "paragraph", content: text("Umowa z 12 marca 2026 r. (zał. nr 1), wezwanie z 01.04.2026 (zał. nr 2).") },
            { type: "heading", level: 2, content: text("Załączniki") },
            {
                type: "list",
                ordered: true,
                ...(overrides.start ? { start: overrides.start } : {}),
                items: (overrides.items ?? ["umowa z 12.03.2026", "wezwanie do zapłaty"]).map(text)
            },
            { type: "table", rows: [[{ blocks: [{ type: "signature", content: text("radca prawny") }] }]] }
        ]
    };
}
const check = (file) => compareFileWithDraft(draftLines(DRAFT), astLines(file));
const codes = (file) => check(file).map((finding) => finding.code).sort();
describe("FILE CHECK: file built from the stored draft (G99, T33)", () => {
    it("passes a faithful file: wording, amount notation, markers and the working part do not count", () => {
        expect(check(ast())).toEqual([]);
    });
    it("names a changed amount both ways", () => {
        expect(check(ast({ amount: "2 500" }))).toEqual([
            { code: "P1", value: "2 000,00" },
            { code: "P2", value: "2 500,00" }
        ]);
    });
    it("names a sum that does not add up", () => {
        expect(check(ast({ sum: "10 000 + 2 000 = 12 400" }))).toEqual([{ code: "P4", value: "12 400,00/12 000,00" }]);
        expect(wrongSums("15 000 zł − 3 000 zł = 12 000 zł")).toEqual([]);
    });
    it("names a dropped attachment and a reference outside the list", () => {
        expect(codes(ast({ items: ["umowa z 12.03.2026"] }))).toEqual(["P5", "P7", "P8"]);
    });
    it("names attachment numbering that does not start at 1", () => {
        expect(codes(ast({ start: 2 }))).toEqual(["P6", "P7"]);
    });
    it("names a date only in the file", () => {
        const file = ast();
        file.blocks.unshift({ type: "paragraph", content: text("Warszawa, dnia 11 listopada 2026 r.") });
        expect(check(file)).toEqual([{ code: "P3", value: "2026-11-11" }]);
    });
    it("writes a compact reason for the web", () => {
        expect(fileCheckReason(check(ast({ amount: "2 500" })))).toBe("P1=2 000,00;P2=2 500,00");
    });
});
