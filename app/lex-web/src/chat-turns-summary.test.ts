import { describe, expect, it } from "vitest";
import { chatPathLine } from "./LocalAiSetupPanel.js";

describe("czas czatu: wiersz ścieżki", () => {
  it("mediana, 95%, błędy i najdłuższe etapy", () => {
    expect(
      chatPathLine({ path: "pisma-procesowe-v3", modelKind: "local", turns: 12, errors: 1, blocked: 0, p50Ms: 41_000, p95Ms: 78_000, maxMs: 80_000, phasesP50Ms: { MODEL: 36_000, PREPARE: 3_200, ROUTING: 120 } })
    ).toBe("lokalny · pisma-procesowe-v3: 12 tur, mediana 41 s, 95% do 78 s, błędy 1 (model 36 s, anonimizacja 3,2 s)");
  });
});
