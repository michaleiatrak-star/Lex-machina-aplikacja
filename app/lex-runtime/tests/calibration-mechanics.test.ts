import { describe, expect, it } from "vitest";
import { citedDocuments } from "../src/case-content-grounding.js";
import { passageRoles, semanticJudgePrompt } from "../src/case-semantic-check.js";
import { generateCases } from "./fixtures/calibration/generate.js";

// Mechanical part of the 1000-case calibration: the judge sees the authority's holding,
// and a party's argument or a dissent is never labelled as the authority's assessment.
const cases = generateCases(1000, 20261013);
const flat = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").toLowerCase();

describe("calibration mechanics (1000 generated cases)", () => {
  it("is deterministic", () => {
    expect(generateCases(5, 20261013)).toEqual(cases.slice(0, 5));
  });

  it("finds the cited document in every encoding", () => {
    const missing = cases.filter((item) => citedDocuments(item.answer, item.sources).length === 0).map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it("puts the decisive passage in the role-labelled judge prompt", () => {
    const missed = cases.filter((item) => {
      const prompt = flat(semanticJudgePrompt(item.question, citedDocuments(item.answer, item.sources), { roles: true }));
      return !prompt.includes(flat(item.decisive).slice(0, 60));
    });
    expect(missed.length).toBeLessThanOrEqual(10);
  }, 15_000);

  it("labels party arguments as such and never as the authority's assessment", () => {
    const party = /(?:skarżąc|wnioskodawc|apelując|zdanie odrębne)\p{L}* (?:podn|wnosi|uważa|twierdzi)/iu;
    const roles = cases.filter((item) => item.trap).flatMap((item) =>
      citedDocuments(item.answer, item.sources).flatMap((doc) => passageRoles(doc.text))
        .filter((passage) => party.test(passage.text)).map((passage) => passage.role));
    expect(roles.length).toBeGreaterThan(50);
    expect(new Set(roles)).toEqual(new Set(["STANOWISKO STRONY"]));
  });
});
