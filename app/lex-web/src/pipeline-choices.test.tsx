import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PipelineChoices, directDocumentRequest, documentChoiceLabel, pipelineChoiceMessage, stepSummaryText } from "./MatterChatApp.js";

const next = {
  skill: "pisma-proste-v2",
  reason: "macierz aktywacji (wejście → następny etap)",
  choices: [
    { skill: "pisma-proste-v2", kind: "DOCUMENT" as const, reason: "macierz aktywacji (wejście → następny etap)" },
    { skill: "analiza-sadowa-v6", kind: "ANALYSIS" as const, reason: "kombinacja skilli: Dokument + wezwanie" }
  ]
};

describe("co dalej po wyniku: wybór użytkownika", () => {
  it("proponuje dokument albo dalszą analizę, bez automatycznego przejścia", () => {
    const html = renderToStaticMarkup(<PipelineChoices next={next} auto disabled={false} onChoose={() => undefined} />);
    expect(html).toContain("Generuj dokument");
    expect(html).toContain("Dalsza analiza: analiza-sadowa-v6");
    expect(html).toContain("nic nie uruchomi się bez Twojej decyzji");
    expect(html).toContain("HYBRID-VAL");
  });

  it("starą wiadomość z jednym etapem pokazuje jako jedną opcję", () => {
    const html = renderToStaticMarkup(
      <PipelineChoices next={{ skill: "analiza-sadowa-v6", reason: "kombinacja skilli" }} auto disabled={false} onChoose={() => undefined} />
    );
    expect(html).toContain("Dalsza analiza: analiza-sadowa-v6");
    expect(html).not.toContain("Generuj dokument");
  });

  it("dokument powstaje z wyniku, bez ponownej analizy; etap analizy tylko w swoim zakresie", () => {
    expect(pipelineChoiceMessage({ skill: "pisma-proste-v2", kind: "DOCUMENT" })).toBe(
      "Następny etap pipeline'u: pisma-proste-v2. Wynik powyżej jest zadowalający: przygotuj dokument na jego podstawie, bez ponownej analizy i bez nowych wątków."
    );
    expect(pipelineChoiceMessage({ skill: "analiza-sadowa-v6", kind: "ANALYSIS" })).toContain("tylko w zakresie tego etapu");
  });

  it("plik z wyniku pisma procesowego i z redakcji umowy: prośba o plik tego rodzaju", () => {
    const pleading = pipelineChoiceMessage({ skill: "pisma-procesowe-v3", kind: "DOCUMENT", own: true });
    expect(directDocumentRequest(pleading)).toMatchObject({ format: "docx", documentType: "pleading" });
    const contract = pipelineChoiceMessage({ skill: "analizator-umow-v1", kind: "DOCUMENT", own: true });
    expect(directDocumentRequest(contract)).toMatchObject({ format: "docx", documentType: "contract" });
  });

  it("wątek mechaniczny: „Generuj dokument” dla własnego wyniku, bez zmiany skilla", () => {
    const own = { skill: "pisma-procesowe-v3", reason: "plik z tego wyniku", choices: [{ skill: "pisma-procesowe-v3", kind: "DOCUMENT" as const, reason: "plik z tego wyniku", own: true as const }] };
    const html = renderToStaticMarkup(<PipelineChoices next={own} auto={false} disabled={false} onChoose={() => undefined} />);
    expect(html).toContain("Generuj dokument");
    expect(html).not.toContain("Wątek mechaniczny jest przypięty");
  });

  it("pismo procesowe: przed plikiem stan kroków; otwarte lub pominięte bez powodu dają projekt", () => {
    const steps = {
      done: 13,
      total: 16,
      skipped: [{ checkpoint: "CP-FSL-D", reason: "brak dokumentów finansowych w sprawie" }, { checkpoint: "CP-PD" }],
      open: ["CP-PEER"]
    };
    expect(stepSummaryText(steps)).toBe(
      "Kroki pisma: wykonane 13 z 16 · pominięte: CP-FSL-D (brak dokumentów finansowych w sprawie); CP-PD (bez podanego powodu) · otwarte: CP-PEER"
    );
    expect(documentChoiceLabel(steps)).toBe("Generuj projekt (DRAFT)");
    expect(documentChoiceLabel({ done: 15, total: 16, skipped: [{ checkpoint: "CP-FSL-D", reason: "nie dotyczy" }], open: [] })).toBe("Generuj dokument");
    const html = renderToStaticMarkup(
      <PipelineChoices
        next={{ skill: "pisma-procesowe-v3", reason: "plik z tego wyniku", choices: [{ skill: "pisma-procesowe-v3", kind: "DOCUMENT", reason: "plik z tego wyniku", own: true, steps }] }}
        auto
        disabled={false}
        onChoose={() => undefined}
      />
    );
    expect(html).toContain("Generuj projekt (DRAFT)");
    expect(html).toContain("CP-PD (bez podanego powodu)");
  });

  it("an answer that only announced a step: a visible Kontynuuj that runs it, in AUTO and in a mechanical thread", () => {
    const next = {
      skill: "analizator-umow-v1",
      reason: "odpowiedź zapowiada krok",
      choices: [{ skill: "analizator-umow-v1", kind: "CONTINUE" as const, reason: "odpowiedź zapowiada krok, którego nie wykonała" }]
    };
    for (const auto of [true, false]) {
      const html = renderToStaticMarkup(<PipelineChoices next={next} auto={auto} disabled={false} onChoose={() => undefined} />);
      expect(html).toContain(">Kontynuuj</button>");
    }
    expect(pipelineChoiceMessage(next.choices[0]!)).toMatch(/^Kontynuuj: wykonaj teraz zapowiedzianą weryfikację/u);
  });
});
