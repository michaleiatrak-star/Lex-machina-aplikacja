import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { citedDocuments } from "../src/case-content-grounding.js";
import { parseSemanticVerdicts, semanticProblems } from "../src/case-semantic-check.js";
import { SCENARIOS } from "./fixtures/semantic-scenarios.js";

// Verdicts recorded from real models (2026-10-13, two runs of a small model and one of a
// medium one) on the prompts this application sends for the 16 scenarios. The parser keeps
// each (its quote is in the document) and the correction decision matches a careful reader.
const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/semantic-judge-recorded.json"), "utf8")) as Record<string, Array<{ id: string; output: string }>>;

describe.each(Object.keys(recorded))("recorded judge %s", (judge) => {
  it.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))("%s", (_id, scenario) => {
    const output = recorded[judge]!.find((item) => item.id === scenario.id)!.output;
    const check = parseSemanticVerdicts(typeof output === "string" ? output : JSON.stringify(output), citedDocuments(scenario.answer, scenario.sources));
    expect(check.rejected).toEqual([]);
    const verdict = check.verdicts[0]!;
    expect(verdict.topic).toBe(scenario.expected.topic);
    expect([scenario.expected.claim, scenario.alsoAcceptable]).toContain(verdict.claim);
    // Correction policy: off-topic or a misstated claim; a faithful partial match needs none.
    const shouldCorrect = scenario.expected.topic === "NO_MATCH" || verdict.claim !== "SUPPORTED";
    expect(semanticProblems(check).length > 0).toBe(shouldCorrect);
  });
});
