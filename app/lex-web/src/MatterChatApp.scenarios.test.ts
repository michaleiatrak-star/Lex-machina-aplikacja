import { describe, expect, it } from "vitest";
import scenariosJson from "../../lex-runtime/tests/fixtures/scenarios-5000.json";
import { directDocumentRequest } from "./MatterChatApp.js";

// lex-runtime/tests/fixtures/scenarios-5000.json: the chat's own check for a file asked as
// the result. A contract is written in the contract workflow (analizator-umow), so it is
// not a direct file here.
type Scenario = { q: string; frame: string; outcome: string; skill?: string; variant: string };
const scenarios = scenariosJson as unknown as Scenario[];

describe("prośba o plik w 5000 scenariuszach czatu", () => {
  it("pismo zamówione wprost (też bez polskich znaków) idzie do generowania pliku", () => {
    const asked = scenarios.filter((item) => item.outcome === "DOKUMENT" && item.skill !== "analizator-umow-v1");
    const missed = asked.filter((item) => directDocumentRequest(item.q) === null).map((item) => item.q);
    expect(missed.length / asked.length).toBeLessThanOrEqual(0.06);
  });

  it("pytanie nieprawne ani rozmowa nie uruchamia generowania pliku", () => {
    const general = scenarios.filter((item) => item.outcome === "OGOLNA");
    expect(general.filter((item) => directDocumentRequest(item.q) !== null).map((item) => item.q)).toEqual([]);
  });

  it("pytanie o program nie jest prośbą o plik", () => {
    expect(directDocumentRequest("Jak zrobić tabelkę w Wordzie?")).toBeNull();
    expect(directDocumentRequest("sporzadz zawiadomienie o podejrzeniu popelnienia przestepstwa")).toEqual({ format: "docx", documentType: "letter" });
  });
});
