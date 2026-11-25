import { describe, expect, it } from "vitest";
import { joinStepCitations, withSingleStepFooter, processDocumentCitationMarkers, QUOTE_UNSOURCED_MARKER, type PublicDocumentCitation } from "./document-citations.js";
import { tidyMarkerLayout } from "./finalization-gate.js";
import { classifyDocument } from "./document-kind.js";
import { strengthGaps } from "./answer-strength.js";

function citation(id: string, documentId: string): PublicDocumentCitation {
  return { citationId: id, marker: `[[LEXDOCREF:${id}]]`, label: documentId, documentId, chunkIndex: 0, pageStart: 1, pageEnd: 1, contextText: "x" };
}

describe("AUTO steps joined (real11, 2026-11-25)", () => {
  it("numbers the links once over all steps and keeps every step's citations", () => {
    const joined = joinStepCitations([
      { text: "a [[LEXDOCREF:docref_1]] b [[LEXDOCREF:docref_2]]", citations: [citation("docref_1", "d1"), citation("docref_2", "d2")] },
      { text: "c [[LEXDOCREF:docref_1]] d [[LEXDOCREF:docref_9]]", citations: [citation("docref_1", "d3")] }
    ]);
    expect(joined.texts).toEqual(["a [[LEXDOCREF:docref_1]] b [[LEXDOCREF:docref_2]]", "c [[LEXDOCREF:docref_3]] d "]);
    expect(joined.citations.map((item) => [item.citationId, item.documentId, item.marker])).toEqual([
      ["docref_1", "d1", "[[LEXDOCREF:docref_1]]"],
      ["docref_2", "d2", "[[LEXDOCREF:docref_2]]"],
      ["docref_3", "d3", "[[LEXDOCREF:docref_3]]"]
    ]);
  });

  it("puts the register and the disclaimers once after the last step", () => {
    const footer = "REJESTR DOKUMENTÓW (prowadzony przez aplikację): przeczytano 5/5\n\n| Nr |\n\n---\n⚖️ **Zastrzeżenie:** tekst";
    const parts = withSingleStepFooter([`Treść CP-1a\n\n---\n\n${footer}`, "Pytania\n\n---\n⚖️ **Zastrzeżenie:** tekst"]);
    expect(parts.bodies).toEqual(["Treść CP-1a", "Pytania"]);
    expect(parts.footer.match(/REJESTR DOKUMENTÓW/gu)).toHaveLength(1);
    expect(parts.footer.match(/Zastrzeżenie/gu)).toHaveLength(1);
  });
});

describe("marker layout", () => {
  it("moves a marker after a table row's last bar into the last cell", () => {
    expect(tidyMarkerLayout("| a | art. 233 § 1 KPC | ✅ zatwierdzone | ✅ [VER: x, 2026-11-19]")).toBe("| a | art. 233 § 1 KPC | ✅ zatwierdzone ✅ [VER: x, 2026-11-19] |");
  });
  it("takes markers out of a checkpoint box only", () => {
    const text = "```\n│ forma (art. 205³ § 5 KPC)  │ ✅ [VER: x, 2026-11-25]\n│ pisma z 4.08.2026 [[LEXDOCREF:docref_3]]; │\n```\nart. 205³ § 5 KPC ✅ [VER: x, 2026-11-25]";
    expect(tidyMarkerLayout(text)).toBe("```\n│ forma (art. 205³ § 5 KPC)  │\n│ pisma z 4.08.2026; │\n```\nart. 205³ § 5 KPC ✅ [VER: x, 2026-11-25]");
  });
});

describe("document kinds from the app's PDF text (one line per page)", () => {
  it("reads an e-protokół as a hearing record", () => {
    const page = "Sygn. akt:   XI P 27/26 PROTOKÓŁ Dnia 13 listopada 2026 r. Sąd Okręgowy w Katowicach, XI Wydział Pracy - w składzie: Przewodniczący: sędzia X Protokolant: Y na rozprawie rozpoznał sprawę Świadek zeznaje";
    expect(classifyDocument({ text: page }).kind).toBe("PROTOKOL_PRZESLUCHANIA");
  });
  it("reads a ZUS sick-leave printout as a certificate", () => {
    expect(classifyDocument({ text: "Ubezpieczony: X PESEL: Y Wystawione zaświadczenia lekarskie Data wystawienia" }).kind).toBe("ZASWIADCZENIE");
  });
});

describe("anticipated arguments are not quotes from the files", () => {
  it("does not flag the other side's expected argument", () => {
    const text = "F-A: wniosek dowodowy ze stanowiskiem\nAtak pozwanej: „to w istocie pismo przygotowawcze, a nie wniosek dowodowy”. Ocena: 🟡.";
    expect(processDocumentCitationMarkers(text, []).text).not.toContain(QUOTE_UNSOURCED_MARKER);
  });
  it("still flags a quote attributed to a pleading and found nowhere", () => {
    const text = "Pozwana w piśmie z 23.07.2026 r. twierdzi: „powód nigdy nie pracował po godzinach pracy spółki”.";
    expect(processDocumentCitationMarkers(text, []).text).toContain(QUOTE_UNSOURCED_MARKER);
  });
});

describe("conceded theses label", () => {
  it("agrees in number", () => {
    expect(strengthGaps("x — teza trafna, bez odpowiedzi", [], []).find((gap) => gap.kind === "CONCEDED")?.label).toBe("1 teza rozstrzygnięcia oddana bez odpowiedzi");
  });
});
