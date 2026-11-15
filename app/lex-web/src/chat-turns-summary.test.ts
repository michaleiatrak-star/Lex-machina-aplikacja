import { describe, expect, it } from "vitest";
import { chatPathLine, slowTurnLine } from "./LocalAiSetupPanel.js";

describe("czas czatu: wiersz ścieżki", () => {
  it("mediana, 95%, błędy i najdłuższe etapy", () => {
    expect(
      chatPathLine({ path: "pisma-procesowe-v3", modelKind: "local", turns: 12, errors: 1, blocked: 0, p50Ms: 41_000, p95Ms: 78_000, maxMs: 80_000, phasesP50Ms: { MODEL: 36_000, PREPARE: 3_200, ROUTING: 120 } })
    ).toBe("lokalny · pisma-procesowe-v3: 12 tur, mediana 41 s, 95% do 78 s, błędy 1 (model 36 s, anonimizacja 3,2 s)");
  });
  it("długa tura z najdłuższymi krokami (bez nazwy etapu)", () => {
    const line = slowTurnLine({ at: "2026-11-15T09:42:00.000Z", path: "pisma-procesowe-v3", modelKind: "api", totalMs: 870_400, status: "OK", steps: [{ step: "MODEL · kontrola zgodności powołanych tekstów", ms: 400_000 }, { step: "MODEL · narzędzie verify_legal_sources", ms: 290_000 }] });
    expect(line).toMatch(/· pisma-procesowe-v3: 870 s \(kontrola zgodności powołanych tekstów 400 s, narzędzie verify_legal_sources 290 s\)$/u);
  });
});
