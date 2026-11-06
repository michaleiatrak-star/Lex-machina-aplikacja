import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { markdownSection } from "../src/checkpoint-skill-sections.js";
import { classifyDocument, recognisedDocumentsPrompt } from "../src/document-kind.js";

const CORPUS = join(import.meta.dirname, "../../../Wersja rozwojowa rozpakowana");

// The agreement of the user report (2026-11-06), as its text layer reads.
const agreement = [
  "Porozumienie stron o rozwiązaniu umowy o pracę",
  "zawarte w dniu 9 października 2024 roku r. w Katowicach pomiędzy:",
  "Niniejszym Pracodawca i Pracownik zgodnie postanawiają, co następuje:",
  "5. Za każde nieuprawnione naruszenie każda ze stron zobowiązana będzie do zapłaty kary w kwocie 5.000,00 zł",
  "10. Na mocy niniejszego porozumienia Pracownik, zrzeka się wszystkich roszczeń przeszłych i przyszłych względem Pracodawcy."
].join("\n");

describe("a delivered contract-like document is assessed as a whole", () => {
  it("an agreement headed in mixed case is recognised (it was \"nierozpoznany\")", () => {
    expect(classifyDocument({ text: agreement }).kind).toBe("POROZUMIENIE");
  });

  it("the model is told to run the contract analyser's whole-document check", () => {
    const prompt = recognisedDocumentsPrompt([{ documentId: "doc_1", ...classifyDocument({ text: agreement }) }]);
    expect(prompt).toContain("CAL-GATE");
    expect(recognisedDocumentsPrompt([{ documentId: "doc_2", ...classifyDocument({ text: "WEZWANIE do zapłaty" }) }])).not.toContain("CAL-GATE");
  });

  it("the section the runtime loads exists in analizator-umow-v1 and names every pattern", () => {
    const section = markdownSection(readFileSync(join(CORPUS, "analizator-umow-v1/SKILL.md"), "utf8"), "## KONTROLA CAŁOŚCIOWA DOKUMENTU (CAL-GATE)");
    expect(section).toContain("CAL-2");
    for (const pattern of ["a) ZRZECZENIE", "ZNOSI PRAWO", "PODWÓJNA SANKCJA", "ASYMETRIA", "h) regulamin", "bilans", "GRAF RELACJI"]) expect(section).toContain(pattern);
    expect(section).toContain("Relacje między postanowieniami");
    expect(section.length).toBeLessThan(6000);
  });
});
