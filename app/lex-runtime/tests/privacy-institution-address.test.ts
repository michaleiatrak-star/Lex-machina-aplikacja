import { describe, expect, it } from "vitest";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";

const down = { recognize: async () => [] };
const pseudonymize = (text: string) => new LocalPolishPseudonymizer(new PseudonymizationVault(), down).pseudonymize(text);

// The court's letter of the user report (2026-11-06), as the OCR reads it.
const letter = [
  "Sąd Rejonowy w Zielonej Górze",
  "Zielona Góra, dnia 03.11.2026 r.",
  "I Wydział Cywilny",
  "Pl. Słowiański 2",
  "65-069 Zielona Góra",
  "tel. Biuro Obsługi Interesanta (68) 32-20-310 lub 378",
  "Sygnatura akt I C 793/26",
  "",
  "Tylda spółka z ograniczoną",
  "odpowiedzialnością z siedzibą",
  "w Zielonej Górze",
  "ul. Sobkowiaka 26",
  "65-119 ZIELONA GÓRA"
].join("\n");

describe("a court's or an office's address", () => {
  it("stays in clear; the party's address below it is masked", async () => {
    const result = await pseudonymize(letter);
    expect(result.text).toContain("Pl. Słowiański 2");
    expect(result.text).toContain("65-069 Zielona Góra");
    expect(result.text).not.toContain("Sobkowiaka");
    expect(result.text).not.toContain("65-119");
  });

  it("on the institution's own line too; a person's address after a blank line is masked", async () => {
    const result = await pseudonymize("Komornik Sądowy przy Sądzie Rejonowym w Toruniu, ul. Grudziądzka 45, 87-100 Toruń\n\nDłużnik: zam. ul. Polna 2, 87-100 Toruń");
    expect(result.text).toContain("ul. Grudziądzka 45");
    expect(result.text).not.toContain("Polna 2");
  });

  it("a firm named like an office keeps its address masked", async () => {
    const result = await pseudonymize("Urządzenia Biurowe spółka z o.o.\nul. Lipowa 7\n40-001 Katowice");
    expect(result.text).not.toContain("Lipowa 7");
  });
});

describe("a housing community's name", () => {
  const surnameRecognizer = {
    recognize: async (text: string) =>
      [...text.matchAll(/Piłsudskiego|Lipowej 7/gu)].map((match) => ({
        start: match.index!,
        end: match.index! + match[0].length,
        kind: (match[0].includes("7") ? "ADDRESS" : "PERSON") as "ADDRESS" | "PERSON",
        value: match[0],
        confidence: 0.9,
        source: "AUTO" as const
      }))
  };
  it("stays in clear when a recognizer takes its street for a surname or an address (user report 2026-11-06)", async () => {
    const pseudonymizer = new LocalPolishPseudonymizer(new PseudonymizationVault(), surnameRecognizer);
    const result = await pseudonymizer.pseudonymize(
      "w sprawie z powództwa Wspólnoty\nMieszkaniowej Piłsudskiego 45 z siedzibą w Nowej Soli przeciwko pozwanemu; Wspólnota Mieszkaniowa Nieruchomości przy ul. Lipowej 7"
    );
    expect(result.text).toContain("Mieszkaniowej Piłsudskiego 45");
    expect(result.text).toContain("przy ul. Lipowej 7");
  });

  it("a person named Piłsudski elsewhere is still masked", async () => {
    const pseudonymizer = new LocalPolishPseudonymizer(new PseudonymizationVault(), surnameRecognizer);
    const result = await pseudonymizer.pseudonymize("Pozwany Jan Piłsudskiego nie stawił się. Wspólnota Mieszkaniowa Piłsudskiego 45 wniosła pozew.");
    expect(result.text).toContain("Wspólnota Mieszkaniowa Piłsudskiego 45");
    expect(result.text).not.toMatch(/Jan Piłsudskiego/u);
  });
});

describe("a housing cooperative's name", () => {
  const surnameRecognizer = {
    recognize: async (text: string) =>
      [...text.matchAll(/Piłsudskiego/gu)].map((match) => ({
        start: match.index!, end: match.index! + match[0].length, kind: "PERSON" as const, value: match[0], confidence: 0.9, source: "AUTO" as const
      }))
  };
  it("with a number, across a line break, in any case form (user report 2026-11-06)", async () => {
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), surnameRecognizer).pseudonymize(
      "z powództwa Spółdzielni\nMieszkaniowej Piłsudskiego 45 z siedzibą w Nowej Soli"
    );
    expect(result.text).toContain("Mieszkaniowej Piłsudskiego 45 z siedzibą");
  });
});
