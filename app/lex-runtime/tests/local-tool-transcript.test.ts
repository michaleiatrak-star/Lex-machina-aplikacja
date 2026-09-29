import { describe, expect, it } from "vitest";
import {
  fitLocalToolTranscript,
  type LocalToolTranscriptEntry
} from "../src/providers/ai-sdk-adapter.js";

function entry(id: string, content: string, input: Record<string, unknown> = { path: "dr-02/SKILL.md" }): LocalToolTranscriptEntry {
  return { id, name: "read_legal_resource", input, content };
}

describe("fitLocalToolTranscript", () => {
  it("keeps everything that fits in the local window", () => {
    const fitted = fitLocalToolTranscript([entry("c1", "A".repeat(100)), entry("c2", "B".repeat(100))], 10_000);
    expect(fitted).toHaveLength(2);
    expect(fitted[1]).toContain("B".repeat(100));
  });

  it("pages an oversized skill read: truncated with the next offset", () => {
    const [fitted] = fitLocalToolTranscript([entry("c1", "S".repeat(40_000), { path: "dr-02/SKILL.md", offset: 1000 })], 5_000);
    expect(fitted!.length).toBeLessThanOrEqual(5_000);
    expect(fitted).toContain("wynik obcięty do okna modelu lokalnego");
    const shown = /pokazano (\d+) z 40000/.exec(fitted!)?.[1];
    expect(Number(shown)).toBeGreaterThan(3_000);
    expect(fitted).toContain(`offset=${1000 + Number(shown)}`);
  });

  it("replaces older used results with a one-line stub so the newest part fits", () => {
    const fitted = fitLocalToolTranscript(
      [entry("c1", "O".repeat(20_000)), entry("c2", "N".repeat(3_000))],
      5_000
    );
    expect(fitted).toHaveLength(2);
    expect(fitted[0]).toContain("TOOL_RESULT c1 [LEX_RUNTIME: wynik 20000 znaków wykorzystany i usunięty");
    expect(fitted[0]).not.toContain("OOOO");
    expect(fitted[1]).toContain("N".repeat(3_000));
    expect(fitted.join("\n\n").length).toBeLessThanOrEqual(5_000);
  });

  it("still points to the next offset when the base prompt fills the window", () => {
    expect(fitLocalToolTranscript([entry("c1", "X".repeat(10))], 0)).toEqual([
      expect.stringContaining("pokazano 0 z 10")
    ]);
  });
});
