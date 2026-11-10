import { describe, expect, it } from "vitest";
import { answerLanguageInstruction, currentAnswerLanguage, enterAnswerLanguage, parseAnswerLanguage } from "./answer-language.js";
describe("język odpowiedzi modelu", () => {
    it("przyjmuje tylko znane języki interfejsu; polski nic nie dodaje", () => {
        expect(parseAnswerLanguage("DE")).toBe("de");
        expect(parseAnswerLanguage("pl")).toBeNull();
        expect(parseAnswerLanguage("xx")).toBeNull();
        expect(parseAnswerLanguage(undefined)).toBeNull();
        expect(answerLanguageInstruction(null)).toBe("");
    });
    it("instrukcja zachowuje nazwy, akty i brzmienie przepisów w oryginale", () => {
        const text = answerLanguageInstruction("de");
        expect(text).toContain("German (de)");
        expect(text).toContain("w oryginale");
        expect(text).toContain("ELI");
    });
    it("język obowiązuje w dalszej pracy tego samego żądania", async () => {
        await new Promise((resolve) => {
            setImmediate(async () => {
                enterAnswerLanguage("fr");
                await Promise.resolve();
                expect(currentAnswerLanguage()).toBe("fr");
                resolve();
            });
        });
    });
});
