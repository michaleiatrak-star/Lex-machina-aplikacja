import { describe, expect, it } from "vitest";
import { compareWithTextLayer, numberKeys } from "./ocr-layer-check.js";
import { LAYER_MARK, markOcrReview } from "./ocr-review.js";
describe("scan vs foreign text layer (Gauntlet G68, T06)", () => {
    it("compares numbers by digits, whatever the separators", () => {
        expect(numberKeys("kwota 12 000,00 zł z dnia 08.10.2024 r., sygn. I C 123/24")).toEqual(["1200000", "8102024", "12324"]);
        expect(compareWithTextLayer([{ text: "Kwota: 12.000,00 zł, dnia 8.10.2024" }], "Kwota: 12 000,00 zł, dnia 08.10.2024")).toBeNull();
    });
    it("flags the line whose digit differs and lists both readings", () => {
        const lines = [{ text: "Wezwanie do zapłaty" }, { text: "kwota 12 845,00 zł" }, { text: "termin 14 dni" }];
        const result = compareWithTextLayer(lines, "Wezwanie do zapłaty\nkwota 12 345,00 zł\ntermin 14 dni");
        expect(result).toEqual({ lines: [1], scanOnly: ["1284500"], layerOnly: ["1234500"] });
    });
    it("says nothing when the layer has no numbers or only one side differs", () => {
        expect(compareWithTextLayer([{ text: "kwota 100 zł" }], "tekst bez liczb")).toBeNull();
        expect(compareWithTextLayer([{ text: "kwota 100 zł" }, { text: "str. 22" }], "kwota 100 zł")).toBeNull();
    });
    it("marks the line for checking against the scan with its own reason", async () => {
        const page = {
            page: 1,
            text: "kwota 12 845,00 zł",
            source: "OCR",
            lines: [{ text: "Wezwanie", score: 0.99 }, { text: "kwota 12 845,00 zł", score: 0.99 }],
            layerMismatch: { lines: [1], scanOnly: ["1284500"], layerOnly: ["1234500"] }
        };
        const marked = await markOcrReview(page, async (words) => words.map(() => true));
        expect(marked.review).toEqual([{ line: 1, text: "kwota 12 845,00 zł", score: 0.99, reason: "LAYER_MISMATCH" }]);
        expect(marked.text).toContain(`${LAYER_MARK} kwota 12 845,00 zł`);
    });
});
