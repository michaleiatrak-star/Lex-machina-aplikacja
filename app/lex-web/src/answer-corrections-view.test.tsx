import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CorrectionsDetails } from "./answer-corrections-view.js";
import { conversationForProvider } from "./conversation-context.js";

const corrections = [{ round: "CASE_GROUNDING" as const, findings: ["art. 6 KC: teza nie wynika z tekstu"], removed: ["Wezwanie jest nieważne."] }];

describe("correcting round of the application", () => {
  it("shows the findings and the removed sentences", () => {
    const html = renderToStaticMarkup(<CorrectionsDetails corrections={corrections} />);
    expect(html).toContain("usunięte zdania: 1");
    expect(html).toContain("Zarzut: art. 6 KC: teza nie wynika z tekstu");
    expect(html).toContain("<del>Wezwanie jest nieważne.</del>");
  });

  it("goes to the model with the answer, so it quotes what was removed", () => {
    const text = conversationForProvider(
      [{ id: "a1", role: "assistant", content: "Poprawiona odpowiedź.", corrections }],
      "Jakie twierdzenia usunąłeś?",
      10_000
    );
    expect(text).toContain("[Runda poprawcza aplikacji (zgodność z tekstem dokumentów): zarzuty: art. 6 KC: teza nie wynika z tekstu; usunięte zdania pierwszej wersji: „Wezwanie jest nieważne.”]");
  });
});
