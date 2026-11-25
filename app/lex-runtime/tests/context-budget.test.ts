import path from "node:path";
import { describe, expect, it } from "vitest";
import { LexSkillRegistry } from "../src/registry.js";
import { loadModules, MODULE_BUDGET_CHARS, skillModules, windowModuleBudget } from "../src/skill-module-map.js";

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();

// The conditional modules take a share of the model's window (task 02).
describe("module budget from the model's window", () => {
  it("20% of the window; a local model keeps the fixed budget", () => {
    expect(windowModuleBudget("local/bielik-11b", 32_000)).toBe(MODULE_BUDGET_CHARS);
    expect(windowModuleBudget("account/anthropic/default", 200_000, 3.5)).toBe(140_000);
    expect(windowModuleBudget("claude-x", 1_000_000, 3.5)).toBe(700_000);
    expect(windowModuleBudget("gpt-x", 8_000, 3.5)).toBe(MODULE_BUDGET_CHARS);
  });

  it("a pleading's triggered modules: the fixed budget leaves some to the model, Claude's window none", () => {
    const entries = skillModules(registry, "pisma-procesowe-v3", {
      text: "Pozew o zapłatę wynagrodzenia za nadgodziny; umowa, ewidencja czasu pracy, maile; świadkowie; brak części dokumentów, uzupełnię później",
      stage: "W1"
    });
    const fixed = loadModules(registry, "pisma-procesowe-v3", entries, new Set(), MODULE_BUDGET_CHARS);
    const windowed = loadModules(registry, "pisma-procesowe-v3", entries, new Set(), windowModuleBudget("account/anthropic/default", 200_000, 3.5));
    expect(windowed.toRead.length).toBeLessThanOrEqual(fixed.toRead.length);
    expect(windowed.toRead).toEqual([]);
  });
});
