import { describe, expect, it } from "vitest";
import { questionGoals, questionTimeline, questionTimelinePrompt } from "../src/question-goals.js";
import { factRows, witnessVersusDocuments, factMatrixGoalEvidence, type DescribedFact } from "../src/fact-matrix.js";
import { statementPairs, type WitnessStatement } from "../src/witness-statements.js";

const QUESTION =
  "Przygotuj pismo procesowe powoda (XI P 27/26). Wykaż wzajemne sprzeczności jego zeznań (13.11.2026 i 17.03.2026) oraz to, że byłem na zwolnieniu lekarskim (L4) od 09.09.2024 do 07.10.2024, a wiadomość o zakazie kontaktu ze mną (29.09.2024) przyszła pod koniec tego okresu; odnieś to do jego zeznań na ten temat.";

describe("the question's demands are goals", () => {
  it("splits 'wykaż X oraz to, że Y; odnieś to' into goals, the back-reference joined to its demand", () => {
    const goals = questionGoals(QUESTION);
    expect(goals[0]).toMatch(/^Wykaż wzajemne sprzeczności/u);
    expect(goals[1]).toMatch(/^Wykazać, że byłem na zwolnieniu lekarskim .* pod koniec tego okresu; odnieś to do jego zeznań/u);
    expect(goals).toHaveLength(2);
  });

  it("a question without a demand to prove has no goals", () => {
    expect(questionGoals("Przygotuj odpowiedź na pozew.")).toEqual([]);
  });
});

describe("the question's dates against the documents", () => {
  const documents = [
    { documentId: "l4", text: "Wystawione 2024-09-09 ZH1 2024-09-09 2024-09-16 … 2024-10-04 ZH2 2024-10-04 2024-10-07" },
    { documentId: "wa", text: "Data otrzymania według powoda: 29 września 2024 r." }
  ];
  it("confirms the period by both ends in one document and places the date inside it", () => {
    const timeline = questionTimeline(QUESTION, documents)!;
    expect(timeline.periods).toEqual([{ from: "2024-09-09", to: "2024-10-07", documents: ["l4"] }]);
    const message = timeline.dates.find((item) => item.date === "2024-09-29")!;
    expect(message.documents).toEqual(["wa"]);
    expect(message.within).toEqual(["09.09.2024–07.10.2024"]);
    expect(questionTimelinePrompt(timeline)).toContain("8 dni przed jego końcem");
  });

  it("a date absent from the documents is the party's assertion", () => {
    const timeline = questionTimeline("Wykaż, że wiadomość przyszła 30.09.2024 r.", documents)!;
    expect(timeline).toBeNull();
    const withPeriod = questionTimeline("Wykaż, że od 01.01.2024 do 31.01.2024 byłem w szpitalu.", documents)!;
    expect(questionTimelinePrompt(withPeriod)).toContain("BRAK w dokumentach");
  });
});

const fact = (topic: string, attribute: string, value: string, record: string, documentId: string, quote = value): DescribedFact => ({ topic, attribute, value, record, quote, documentId, chunkIndex: 0 });

describe("the witness matrix meets the documents", () => {
  const witness = factRows([
    fact("zakaz kontaktu z powodem", "czas wydania", "po ustaniu stosunku pracy", "VII P", "p1"),
    fact("zakaz kontaktu z powodem", "istnienie", "nie słyszał o ograniczeniu kontaktu", "XI P", "p2"),
    fact("zakaz kontaktu z powodem", "istnienie", "było zarządzenie wewnętrzne", "VII P", "p1")
  ]);
  const documents = factRows([fact("zakaz kontaktu z powodem", "czas wydania", "29 września 2024", "D05", "wa", "Data otrzymania: 29 września 2024")]);

  it("sets the testimony and the documents on one topic side by side", () => {
    const text = witnessVersusDocuments("kast", witness, documents, new Map([["wa", "D05 SMS"]]));
    expect(text).toContain("## zakaz kontaktu z powodem");
    expect(text).toContain("świadek [VII P] czas wydania: po ustaniu stosunku pracy");
    expect(text).toContain("dokument [D05 SMS] czas wydania: 29 września 2024");
  });

  it("a matrix goal carries the rows' own quotes as its passages", () => {
    const [first] = factMatrixGoalEvidence("kast", witness);
    expect(first!.goal).toMatch(/zakaz kontaktu z powodem/u);
    expect(first!.evidence.map((item) => item.text)).toEqual(expect.arrayContaining(["nie słyszał o ograniczeniu kontaktu", "było zarządzenie wewnętrzne"]));
  });
});

describe("statement pairs need a real shared topic", () => {
  const statement = (documentId: string, text: string): WitnessStatement => ({ documentId, chunkIndex: 0, heading: documentId, text });
  it("two shared common words and a lone negation make no pair; a differing quantity does", () => {
    const pairs = statementPairs(
      new Map([
        [
          "kast",
          [
            statement("a", "Ze spółką jestem związany jako koordynator pracowników."),
            statement("b", "Nie miałem kontaktu z dokumentami pracowniczymi związanymi z wynagrodzeniem."),
            statement("a", "Ostatnią wiadomość od powoda dostałem na Whatsapp w marcu 2026r."),
            statement("b", "Ostatnią wiadomość otrzymałem w zeszłym roku.")
          ]
        ]
      ])
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.differences[0]).toMatch(/liczby i czas/u);
  });
});

import { argumentSchemaGaps } from "../src/pleading-standard.js";
describe("a 'gdyby sąd uznał …, i tak' block closes the gap", () => {
  it("is an alternative basis", () => {
    const answer = "UZASADNIENIE\nŚwiadek może twierdzić inaczej. Gdyby sąd uznał, że zakaz miał uzasadnienie, i tak pozostaje sprzeczność wersji [[LEXDOC:a:0]].";
    expect(argumentSchemaGaps(answer).map((gap) => gap.element)).not.toContain("ZAMKNIĘCIE FURTKI");
  });
});
