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

describe("ślad routingu jako sam blok kodu (test 500, C12-008)", () => {
  it("usuwa blok z kluczami routera, zostawia zwykły blok kodu", () => {
    const text = "# Pozew z nakazem zapłaty\n\n```\nTRYB: LAIK\nPRIMARY: analiza-sadowa-v6 — ROUTER-WCZYTANY: TAK\nODRZUCONE: dr-12\nWERSJA ROUTERA: 3.73\n```\n\n**Co przeczytałem:** 1 dokument.\n\n```\nSĄD REJONOWY\nSprzeciw od nakazu zapłaty\n```";
    const plain = withoutQualityGateLines(text);
    expect(plain).not.toMatch(/PRIMARY|WERSJA ROUTERA|TRYB: LAIK/u);
    expect(plain).toContain("**Co przeczytałem:** 1 dokument.");
    expect(plain).toContain("Sprzeciw od nakazu zapłaty");
  });
});

describe("ślad w zwiniętym bloku „Dane techniczne” (C12-008 na żywo)", () => {
  it("usuwa blok poza trybem deweloperskim, zostawia go deweloperowi", () => {
    const content = [
      "Ostatni dzień na sprzeciw to 26.10.2026.",
      "",
      "<details><summary>Dane techniczne (dla prawnika)</summary>",
      "",
      "PRIMARY: pisma-proste-v2, schemat SPA. LAIK. CN-GATE: art. 480² § 2 pkt 1 TAK/TAK/TAK.",
      "</details>",
      "",
      "⚖️ Ważna informacja: analiza ma charakter informacyjny."
    ].join("\n");
    const plain = visibleContent({ role: "assistant", content }, false);
    expect(plain).not.toMatch(/Dane techniczne|PRIMARY|CN-GATE|<\/details>/u);
    expect(plain).toContain("Ostatni dzień na sprzeciw to 26.10.2026.");
    expect(plain).toContain("⚖️ Ważna informacja");
    expect(visibleContent({ role: "assistant", content }, true)).toContain("PRIMARY");
  });

  it("usuwa też „Ślad routingu” z <summary> w osobnej linii (C13-013 na żywo)", () => {
    const content = [
      "Warto zapytać w niemieckiej Agentur für Arbeit.",
      "",
      "<details>",
      "<summary>Ślad routingu (techniczny)</summary>",
      "",
      "TRYB: LAIK",
      "PRIMARY: dr-04-prawo-pracy-zus-swiadczenia",
      "</details>",
      "",
      "<details><summary>Pełny tekst umowy</summary>Treść dla użytkownika.</details>"
    ].join("\n");
    const plain = visibleContent({ role: "assistant", content }, false);
    expect(plain).not.toMatch(/Ślad routingu|PRIMARY|TRYB: LAIK/u);
    expect(plain).toContain("Agentur für Arbeit");
    expect(plain).toContain("Pełny tekst umowy");
  });
});

describe("the model's work trace is not part of the answer (live test 2026-11-15)", () => {
  it("drops lines naming skill files or several tool names, keeps the answer", async () => {
    const { withoutQualityGateLines, isWorkTraceLine } = await import("./developer-mode");
    const text = [
      "Nie mogę potwierdzić treści tego orzeczenia.",
      "",
      "Wykonane: V-SYG-0, verify_case_reference → OUT_OF_SCOPE (captcha sn.pl), search_case_law (SAOS, SN, BAZA) → brak trafienia, web_search → trop R2B.",
      "Status wg prawny-router-v3/references/HARD-GATES-ORZECZNICTWO.md: ⚠️ NIEPOTWIERDZONE.",
      "Aplikacja skierowała tę sprawę do `orzeczenia-sadowe-v2`; dociągnąłem `dr-04-prawo-pracy-zus-swiadczenia/SKILL.md`.",
      "Art. 484 § 2 KC pozwala zmniejszyć karę umowną."
    ].join("\n");
    const out = withoutQualityGateLines(text);
    expect(out).toContain("Nie mogę potwierdzić");
    expect(out).toContain("Art. 484 § 2 KC");
    expect(out).not.toMatch(/verify_case_reference|HARD-GATES|dr-04-prawo/u);
    expect(isWorkTraceLine("Sąd pracy (art. 476 § 1 KPC) jest właściwy; DR-04 to dziedzina.")).toBe(false);
  });
  it("ślad pracy z testu SDI 8/12: linia „Ślad: PRIMARY …”, „Faza 1-Z”, „Oś sporu”, nazwy narzędzi w tabeli", () => {
    const answer = [
      "Nie mogę teraz powiedzieć, o czym jest orzeczenie SN o sygn. SDI 8/12.",
      "",
      "| Źródło | Wynik |",
      "|---|---|",
      "| sn.pl (`verify_case_reference`) | HTTP 403 |",
      "| SAOS (`search_case_law`, courtType=SUPREME) | brak odpowiedzi |",
      "",
      "2. Porównam brzmienie (`verify_legal_reference` z datą z 2012 r.) z dzisiejszym.",
      "Faza 1-Z: brak trafienia, nic nie dopasowywałem na siłę.",
      "CN-GATE",
      "Oś sporu 1: brak → norma centralna: brak",
      "Ślad: PRIMARY orzeczenia-sadowe-v2, Faza 1-0 A (sygnatura znana).",
      "Aplikacja skierowała tę sprawę do `orzeczenia-sadowe-v2`."
    ].join("\n");
    const plain = withoutQualityGateLines(answer);
    expect(plain).toContain("| sn.pl (sprawdzenie sygnatury) | HTTP 403 |");
    expect(plain).toContain("| SAOS (wyszukiwarka orzeczeń, courtType=SUPREME) | brak odpowiedzi |");
    expect(plain).toContain("Porównam brzmienie (sprawdzenie przepisu w ELI z datą z 2012 r.) z dzisiejszym.");
    expect(plain).not.toMatch(/verify_|search_|orzeczenia-sadowe-v2|Faza 1|Oś sporu|CN-GATE|PRIMARY/u);
    expect(plain).toContain("Nie mogę teraz powiedzieć");
  });
  it("REM-GATE z wierszami REM-0…REM-4 i ich wciętymi listami: znika cały blok (SDI 8/12, 2026-11-15)", () => {
    const answer = [
      "Albo wklej lub wgraj tekst orzeczenia.",
      "",
      "REM-GATE",
      "REM-0 próby: 1 powołanie ⚠️. Odzyskano 0.",
      "  - sn.pl (`verify_case_reference`, konektor `sn`): HTTP 403",
      "  → ⚠️ [NIEWERYFIKOWANE], status OUT_OF_SCOPE",
      "REM-2 braki: 1 pozycja ⬛ (treść orzeczenia).",
      "  → ⬛ BLOKADA. Dokument zamykający lukę to tekst urzędowy z sn.pl.",
      "REM-4 pokrycie:",
      "  - ślad prób i ścieżki odblokowania: PEŁNA",
      "",
      "---",
      "⚖️ **Zastrzeżenie:** Niniejsza analiza ma charakter informacyjny."
    ].join("\n");
    const plain = withoutQualityGateLines(answer);
    expect(plain).not.toMatch(/REM-|BLOKADA|PEŁNA|sn\.pl \(/u);
    expect(plain).toContain("Albo wklej lub wgraj tekst orzeczenia.");
    expect(plain).toContain("⚖️ **Zastrzeżenie:**");
  });
});
