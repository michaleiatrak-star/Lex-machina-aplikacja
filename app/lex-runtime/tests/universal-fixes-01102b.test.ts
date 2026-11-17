import { describe, expect, it } from "vitest";
import { recordParties, subjectGoal, targetRecord } from "../src/record-parties.js";
import { processDocumentCitationMarkers } from "../src/document-citations.js";
import { questionTimeline, questionTimelinePrompt } from "../src/question-goals.js";

const HEADER = (signature: string, date: string, subject: string) =>
  `Sygn. akt: ${signature}\n\nPROTOKÓŁ\n\nDnia ${date} r.\n\nSąd Okręgowy w Katowicach\n\nna rozprawie rozpoznał sprawę\nz powództwa Jan Nowak\nprzeciwko Firma sp. z o.o.\no ${subject}\n\nRozprawę rozpoczęto o godz. 12:53`;

describe("the case subject from the record heading", () => {
  const xi = recordParties("a", HEADER("XI P 27/26", "13 listopada 2026", "wynagrodzenie za pracę, ekwiwalent za urlop,\nsprostowanie świadectwa pracy"))!;
  const vii = recordParties("b", HEADER("VII P 94/25", "17 marca 2026", "odszkodowanie"))!;
  it("reads the claims after 'o' up to the hearing notes", () => {
    expect(xi.subject).toBe("wynagrodzenie za pracę, ekwiwalent za urlop, sprostowanie świadectwa pracy");
  });
  it("targets the case the question names, else the newest record", () => {
    expect(targetRecord([vii, xi], "pismo w sprawie VII P 94/25")!.signature).toBe("VII P 94/25");
    expect(targetRecord([vii, xi], "pismo do sądu")!.signature).toBe("XI P 27/26");
  });
  it("the goal names only the heading's claims", () => {
    expect(subjectGoal(xi)).toMatch(/o wynagrodzenie za pracę.*nie dopisywać żądań spoza przedmiotu sprawy/u);
    expect(subjectGoal(null)).toBeNull();
  });
});

describe("dates in a sentence the model already linked get no second link", () => {
  const attachments = [{ documentId: "d1", title: "protokół", sourceScope: "MANUAL", chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: "Dnia 17 marca 2026 r. świadek zeznał: Było zarządzenie wewnętrzne u pozwanej." }] }] as any;
  it("skips the date next to the model's own marker, links a bare one", () => {
    const linked = processDocumentCitationMarkers("Świadek 17 marca 2026 r. zeznał: „Było zarządzenie wewnętrzne u pozwanej” [[LEXDOC:d1:0]].", attachments);
    expect(linked.citations).toHaveLength(1);
    const bare = processDocumentCitationMarkers("Rozprawa odbyła się 17 marca 2026 r. w Katowicach.", attachments);
    expect(bare.citations).toHaveLength(1);
  });
});

describe("the timeline names the event date for the wording", () => {
  it("asks for the wording on the earliest event", () => {
    const timeline = questionTimeline("Wykaż, że od 09.09.2024 do 07.10.2024 byłem na L4.", [{ documentId: "l4", text: "2024-09-09 … 2024-10-07" }])!;
    expect(questionTimelinePrompt(timeline)).toContain("asOf=2024-09-09");
  });
});
