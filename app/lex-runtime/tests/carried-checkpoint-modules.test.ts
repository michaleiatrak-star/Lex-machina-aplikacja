import path from "node:path";
import { describe, expect, it } from "vitest";
import { carriedCheckpointResources, loadCheckpointResources } from "../src/process-checkpoint-contract.js";
import { LexSkillRegistry } from "../src/registry.js";

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();

// A module read in an earlier step and applied in a later one (task 04): SW-TARCZKA at CP-ATAK
// needs the rules of MOD-ATAK-NA-SWIADKA read in W1 (W1.2c-SW).
describe("modules carried to a later step, read from AUTOMAT-STANOW", () => {
  it("CP-ATAK names the witness module with its condition", () => {
    const carried = carriedCheckpointResources(registry, "CP-ATAK");
    expect(carried.find((item) => item.resource === "shared/MOD-ATAK-NA-SWIADKA.md")?.condition).toMatch(/zeznanie/u);
  });

  it("with testimony in the files the module is in CP-ATAK's prompt; without, it is not", () => {
    const withTestimony = loadCheckpointResources(registry, "CP-ATAK", new Set(), undefined, { witnessTestimony: true, documents: true });
    const witness = withTestimony.loaded.find((item) => item.resource === "shared/MOD-ATAK-NA-SWIADKA.md");
    expect(witness?.carriedFrom).toBeTruthy();
    const without = loadCheckpointResources(registry, "CP-ATAK", new Set(), undefined, { witnessTestimony: false, documents: true });
    expect(without.loaded.map((item) => item.resource)).not.toContain("shared/MOD-ATAK-NA-SWIADKA.md");
    // The step's own files stay first.
    expect(without.loaded[0]?.resource).toBe("shared/MOD-ATAK-NA-DRAFT.md");
  });
});
