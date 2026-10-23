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
