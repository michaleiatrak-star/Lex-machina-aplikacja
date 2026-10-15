import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PipelineChoices, directDocumentRequest, pipelineChoiceMessage } from "./MatterChatApp.js";

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
});
