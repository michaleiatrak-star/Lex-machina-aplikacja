import { describe, expect, it } from "vitest";
import { OVERVIEW_TEMPLATE, overviewBlock, overviewFromAnswer, overviewRequested, queryWithOverviewTemplate } from "../src/case-overview.js";

describe("podsumowanie sprawy w pamięci sprawy", () => {
  it("prośba z przycisku dostaje szablon sekcji; inna wiadomość nie", () => {
    const asked = "Użytkownik: Co dalej?\n\nAsystent: …\n\nUżytkownik: Utwórz podsumowanie sprawy (metryka, dokumenty, podmioty).";
    expect(overviewRequested(asked)).toBe(true);
    expect(overviewRequested("Użytkownik: Utwórz podsumowanie sprawy\n\nAsystent: x\n\nUżytkownik: a teraz pismo")).toBe(false);
    const query = queryWithOverviewTemplate(asked);
    for (const section of ["METRYKA SPRAWY", "WYKAZ DOKUMENTÓW", "PODMIOTY", "OŚ CZASU", "FINANSE", "FAKTY KLUCZOWE", "CZYNNIKI KRYTYCZNE", "SPORY I BRAKI", "SYNTEZA"]) {
      expect(query).toContain(section);
    }
    expect(OVERVIEW_TEMPLATE).toContain("nie wynika z materiału");
  });

  it("zapisuje odpowiedź na prośbę bez zastrzeżenia; kolejna tura dostaje ją raz", () => {
    const answer = "# PODSUMOWANIE SPRAWY\n## METRYKA SPRAWY\nSpór o karę umowną.\n\n⚖️ Ważna informacja: …";
    const kept = overviewFromAnswer({ answer, status: "DRAFT_PRESENTABLE", requested: true, now: "2026-10-19T10:00:00.000Z" })!;
    expect(kept.text).toBe("# PODSUMOWANIE SPRAWY\n## METRYKA SPRAWY\nSpór o karę umowną.");
    expect(overviewFromAnswer({ answer, status: "DRAFT_PRESENTABLE", requested: false })).toBeNull();
    expect(overviewFromAnswer({ answer, status: "BLOCKED", requested: true })).toBeNull();
    expect(overviewBlock(kept, "Użytkownik: pytanie")).toContain("Podsumowanie sprawy zapisane 2026-10-19");
    expect(overviewBlock(kept, kept.text)).toBeNull();
  });
});
