import { describe, expect, it } from "vitest";
import { INVOICE_REQUIREMENTS, findLegalText, splitPoints, verifyRequirements } from "./invoice-requirements.js";
// Syntetyczny tekst do testu parsera, NIE brzmienie ustawy.
const SYNTHETIC = [
    "Art. 106e. 1. Faktura powinna zawierać:",
    "1) alfa datę wystawienia;",
    "2) beta kolejny numer;",
    "3) gamma (bez słowa kluczowego);",
    "18a) delta mechanizm podzielonej płatności;",
    "25) omega nowy punkt;",
    "2. Ustęp drugi 1) nie jest punktem ust. 1."
].join("\n");
describe("invoice requirements verification", () => {
    it("splits ust. 1 into points and stops before ust. 2", () => {
        const points = splitPoints(SYNTHETIC);
        expect([...points.keys()]).toEqual(["1", "2", "3", "18a", "25"]);
    });
    it("marks matches, mismatches, missing and uncovered points", () => {
        const report = verifyRequirements(SYNTHETIC, { sourceUrl: "https://example.test/t.pdf" });
        const status = Object.fromEntries(report.requirements.map((entry) => [entry.point, entry.status]));
        expect(status["1"]).toBe("VERIFIED");
        expect(status["2"]).toBe("VERIFIED");
        expect(status["3"]).toBe("MISMATCH");
        expect(status["18a"]).toBe("VERIFIED");
        expect(status["19"]).toBe("NOT_FOUND");
        expect(report.uncoveredPoints.map((entry) => entry.point)).toEqual(["25"]);
        expect(report.requirements).toHaveLength(INVOICE_REQUIREMENTS.length);
    });
    it("finds the article text inside nested or JSON-encoded connector results", () => {
        const nested = { content: [{ type: "text", text: JSON.stringify({ status: "FOUND", result: { tresc: "Art. 106e.", url_zrodlowy: "u", stan_prawny_na: "2026-01-01" } }) }] };
        expect(findLegalText(nested)).toEqual({ text: "Art. 106e.", sourceUrl: "u", statusDate: "2026-01-01" });
        expect(findLegalText({ status: "ERROR" })).toBeNull();
    });
});
