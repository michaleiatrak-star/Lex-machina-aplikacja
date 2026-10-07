import { describe, expect, it } from "vitest";
import { endsWithDisclaimer, parseDisclaimer, splitTrailingDisclaimer, withDisclaimer } from "./legal-disclaimer.js";
const CORPUS = [
    "### TRYB LAIK",
    "```",
    "⚖️ Informacja ogólna — nie stanowi porady prawnej.",
    "```",
    "### TRYB PRAWNIK",
    "```",
    "⚖️ Analiza robocza — nie stanowi porady prawnej.",
    "```",
    "### WARIANT PISMO SĄDOWE",
    "```",
    "⚠️ Przed podpisaniem i wniesieniem sprawdź pismo.",
    "```"
].join("\n");
describe("disclaimer dokładany programistycznie (KROK 7)", () => {
    const texts = parseDisclaimer(CORPUS);
    it("parsuje trzy warianty z pliku kanonicznego", () => {
        expect(texts.laik).toMatch(/Informacja ogólna/);
        expect(texts.prawnik).toMatch(/Analiza robocza/);
        expect(texts.pismo).toMatch(/Przed podpisaniem/);
        expect(parseDisclaimer("### TRYB LAIK\n```\nx\n```")).toBeNull();
    });
    it("dokłada wariant LAIK albo PRAWNIK, gdy model nie zakończył disclaimerem", () => {
        const laik = withDisclaimer("Odpowiedź.", texts, { mode: "LAIK", pleading: false });
        expect(laik.appended).toBe(true);
        expect(laik.text.endsWith(texts.laik)).toBe(true);
        const prawnik = withDisclaimer("Analiza.", texts, { mode: "PRAWNIK", pleading: false });
        expect(prawnik.appended).toBe(true);
        expect(prawnik.text).toContain(texts.prawnik);
        expect(prawnik.text).not.toContain(texts.laik);
    });
    it("przy piśmie w trybie PRAWNIK dokłada też wariant pisma", () => {
        const pismo = withDisclaimer("Projekt pisma.", texts, { mode: "PRAWNIK", pleading: true });
        expect(pismo.text).toContain(texts.prawnik);
        expect(pismo.text).toContain(texts.pismo);
        // w trybie LAIK dodatek pisma nie jest dokładany
        expect(withDisclaimer("x", texts, { mode: "LAIK", pleading: true }).text).not.toContain(texts.pismo);
    });
    it("nie dubluje disclaimera, gdy już jest ostatnim akapitem (idempotencja)", () => {
        const once = withDisclaimer("Odpowiedź.", texts, { mode: "PRAWNIK", pleading: false });
        expect(endsWithDisclaimer(once.text)).toBe(true);
        const twice = withDisclaimer(once.text, texts, { mode: "PRAWNIK", pleading: false });
        expect(twice.appended).toBe(false);
        expect(twice.text).toBe(once.text);
    });
    it("odcina disclaimer modelu, zostawiając samą analizę do bramek", () => {
        const body = "Zasadniczy wywód prawny.";
        const full = `${body}\n\n⚖️ Zastrzeżenie: nie stanowi porady prawnej.`;
        const split = splitTrailingDisclaimer(full);
        expect(split.body).toBe(body);
        expect(split.disclaimer).toMatch(/nie stanowi porady prawnej/);
        expect(splitTrailingDisclaimer(body).disclaimer).toBeNull();
    });
});
