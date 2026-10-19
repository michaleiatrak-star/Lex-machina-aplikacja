import { describe, expect, it } from "vitest";
import { overviewParts } from "./CaseMemoryCard";

describe("case summary sections", () => {
  it("one entry per '## ' section, the document title left out", () => {
    const parts = overviewParts("# PODSUMOWANIE SPRAWY\n## METRYKA SPRAWY — Sprawa, Profil\nSpór o karę.\n## WYKAZ DOKUMENTÓW\n| doc_id | rodzaj |\n|---|---|\n| D01 | pismo |");
    expect(parts.map((part) => part.title)).toEqual(["METRYKA SPRAWY", "WYKAZ DOKUMENTÓW"]);
    expect(parts[1]!.body).toContain("| D01 | pismo |");
  });
});
