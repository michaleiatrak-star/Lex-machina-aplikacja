import { describe, expect, it } from "vitest";
import { caseContentFindings, citedDocuments, readableSource } from "../src/case-content-grounding.js";
import { relevantExcerpt, semanticJudgePrompt } from "../src/case-semantic-check.js";
import { SCENARIOS } from "./fixtures/semantic-scenarios.js";

// What reaches the judge in each scenario: the cited document is found in the tool results
// (whatever their encoding), and the passage a reader needs to decide is in the prompt.
const squeeze = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pl").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

describe("semantic check scenarios: what the judge receives", () => {
  it.each(SCENARIOS.map((scenario) => [scenario.id, scenario.what, scenario] as const))("%s %s", (_id, _what, scenario) => {
    const documents = citedDocuments(scenario.answer, scenario.sources);
    const document = documents.find((candidate) => squeeze(candidate.signature) === squeeze(scenario.signature));
    expect(document, "cited document found").toBeTruthy();
    const prompt = semanticJudgePrompt(scenario.question, [document!]);
    expect(squeeze(prompt)).toContain(squeeze(scenario.decisive));
    expect(relevantExcerpt(document!.text, scenario.question, document!.claim).length).toBeLessThanOrEqual(8_000);
    expect(prompt).not.toMatch(/\\u0[0-9a-f]{3}|\\n/u);
    if (scenario.excluded) expect(prompt).not.toContain(scenario.excluded);
    const lexical = caseContentFindings(scenario.answer, scenario.sources, scenario.question);
    expect(lexical.length > 0 ? "flag" : "pass").toBe(scenario.lexical);
  });

  it("decodes nested and ensure_ascii JSON into plain text", () => {
    const nested = JSON.stringify({ result: JSON.stringify({ tresc: "Zdanie pierwsze.\nZdanie „drugie”." }) });
    expect(readableSource(nested)).toBe("Zdanie pierwsze.\nZdanie „drugie”.");
    expect(readableSource('{"t":"\\u0142\\u0105ka"}')).toBe("łąka");
    expect(readableSource('nie JSON: \\"cytat\\"\\nkolejna')).toBe('nie JSON: "cytat"\nkolejna');
  });
});
