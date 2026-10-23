import { describe, expect, it } from "vitest";
import { visibleContent, withoutQualityGateLines } from "./developer-mode.js";

// Test 500: bloki bramek (CN/WYJ/REM) i "TRYB ZDEGRADOWANY" trafiały do odpowiedzi dla laika.
const answer = [
  "**Krótko:** termin minął, ale możesz złożyć wniosek o przywrócenie terminu.",
  "",
  "- CN-1 czasowy: TAK — art. 70c potwierdzony na stan 2024-06-01.",
  "- **S1 (sąsiedztwo):** art. 299¹ i art. 299² KSH, bez wpływu na obronę.",
  "- **S2 – krawędzie jednostki:** dotyczą reguł wymiaru kary.",
  "- S3 akty powiązane: brak.",
  "WYJ-GATE: art. 1100 KC (Dz.U. 2026 poz. 795)",
  "REM-0 próby: 1 powołanie",
  "- → WYNIK: stosuje się warunkowo.",
  "TRYB ZDEGRADOWANY: brak modułu.",
  "",
  "Sąd Najwyższy (S1/2020) nie dotyczy sprawy. Krok 1: złóż wniosek."
].join("\n");

describe("quality gate lines in the lawyer's view", () => {
  it("hides the modules' control lines and keeps the legal text", () => {
    const plain = withoutQualityGateLines(answer);
    expect(plain).toContain("**Krótko:** termin minął");
    expect(plain).toContain("Krok 1: złóż wniosek.");
    expect(plain).not.toMatch(/CN-1|S1 \(|S2 –|S3 akty|WYJ-GATE|REM-0|WYNIK:|ZDEGRADOWANY/u);
    expect(plain).toContain("Kontrola jakości odpowiedzi");
  });

  it("shows everything in developer mode and leaves an answer without gates untouched", () => {
    expect(visibleContent({ role: "assistant", content: answer }, true)).toBe(answer);
    expect(withoutQualityGateLines("Zwykła odpowiedź.\n- punkt")).toBe("Zwykła odpowiedź.\n- punkt");
  });
});

// Test 500, C12 na żywo: sekcje kontrolne modelu w odpowiedzi dla laika (forma 0 w 3 z 3 przypadków).
describe("control sections written by the model", () => {
  const body = [
    "**Ślad routingu (KROK 3A)**",
    "```",
    "TRYB: LAIK (ustalony przez aplikację)",
    "PRIMARY: analizator-umow-v1",
    "```",
    "",
    "**Krótko:** możesz kwestionować zapłatę, bo nie było odbioru.",
    "",
    "**OŚ-GATE.** Doręczenie 5.10.2026, termin mija 26.10.2026.",
    "**CN-GATE (czy przepis dotyczy tej sytuacji):**",
    "- art. 30 § 4 KP: przyczyna musi być konkretna.",
    "",
    "**Czego nie wiem:** czy faktura dotyczy jednej umowy.",
    "1. Odpowiedz na wezwanie w 7 dni.",
    "",
    "**Kontrole przy tej odpowiedzi**",
    "",
    "- **Czy przepis pasuje do sprawy.** Oś sporu to rekompensata.",
    "- Czas: przepis obowiązuje.",
    "**Ścieżka:** tryb LAIK. Skill wiodący to analizator-umow-v1.",
    "",
    "⚖️ Ważna informacja: analiza ma charakter informacyjny."
  ].join("\n");

  it("removes the routing trace, gate blocks and the checks section with their content", () => {
    const plain = withoutQualityGateLines(body);
    expect(plain).not.toMatch(/Ślad routingu|PRIMARY|OŚ-GATE|CN-GATE|art\. 30 § 4|Kontrole przy|Oś sporu|Czas: przepis|Ścieżka/u);
    expect(plain).toContain("**Krótko:** możesz kwestionować zapłatę");
    expect(plain).toContain("**Czego nie wiem:** czy faktura");
    expect(plain).toContain("1. Odpowiedz na wezwanie w 7 dni.");
    expect(plain).toContain("⚖️ Ważna informacja");
  });

  it("keeps a list of the answer after a blank line that follows a gate block", () => {
    const plain = withoutQualityGateLines("**WYJ-GATE.** Brak wyjątków.\n\n1. Złóż odwołanie do sądu pracy.\n2. Zachowaj dowód nadania.");
    expect(plain).toContain("1. Złóż odwołanie do sądu pracy.");
    expect(plain).toContain("2. Zachowaj dowód nadania.");
    expect(plain).not.toContain("WYJ-GATE");
  });
});
