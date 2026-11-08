import { describe, expect, it } from "vitest";
import { checkpointPrompt } from "../src/process-checkpoint-contract.js";

describe("the process pleading checkpoint contract", () => {
  const prompt = checkpointPrompt("CP-1a", { loaded: [], toRead: [] } as never);
  it("missing facts never block a step (C09-026)", () => {
    expect(prompt).toContain("BRAK-FAKT");
    expect(prompt).toContain("Brak danych nie blokuje kroku");
  });
  it("the accepted start information is not shown again (C10-004)", () => {
    expect(prompt).toContain("nie wyświetlaj jej ponownie");
  });
});
