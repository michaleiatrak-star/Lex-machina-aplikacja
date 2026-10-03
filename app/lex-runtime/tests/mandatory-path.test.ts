import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import type { VerificationLedger } from "../src/verification-ledger.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import {
  evaluateMandatoryPath,
  loadMandatoryPathModel,
  pathProfile,
  preloadForTurn,
  type TurnFacts
} from "../src/mandatory-path.js";
import { detectQueryMode, parseModeSignals } from "../src/query-mode.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const read = (resource: string) => {
  try {
    return fs.readFileSync(path.join(CORPUS, resource), "utf8");
  } catch {
    return null;
  }
};
const model = loadMandatoryPathModel(read);
const signals = parseModeSignals(read("prawny-router-v3/references/KROK1-detekcja.md")!);

describe("LAIK / PRAWNIK at the entry (KROK 1 signals)", () => {
  it("decides from the content of the question", () => {
    expect(detectQueryMode("Wykaż różnice pomiędzy 233 kk, 234 kk i 238 kk.", signals, null)).toMatchObject({ mode: "PRAWNIK", decision: "PRAWNIK" });
    expect(detectQueryMode("Proszę o analizę art. 415 KC", signals, null).mode).toBe("PRAWNIK");
    expect(detectQueryMode("Dostałem pismo z sądu i nie rozumiem, co mam zrobić", signals, null)).toMatchObject({ mode: "LAIK", decision: "LAIK" });
    expect(detectQueryMode("Sąsiad uszkodził mi samochód, należy mi się odszkodowanie?", signals, null).mode).toBe("LAIK");
    expect(detectQueryMode("Napisz pozew", signals, null).decision).toBe("NIEROZSTRZYGNIETY");
    expect(detectQueryMode("Napisz pozew", signals, "PRAWNIK")).toMatchObject({ mode: "PRAWNIK", decision: "POPRZEDNI" });
    expect(detectQueryMode("b", signals, "PRAWNIK")).toMatchObject({ mode: "LAIK", decision: "ODPOWIEDZ_NA_PYTANIE" });
    // "SA" is a court, "sa" in a sentence is not.
    expect(detectQueryMode("czy oni sa winni szkody", signals, null).mode).toBe("LAIK");
  });
});

describe("mandatory path model from the corpus", () => {
  it("reads the core R-1…R-5, the trigger table and the router's mandatory gates with their steps", () => {
    expect(model.core.map((item) => item.id)).toEqual(["R-1", "R-2", "R-3", "R-4", "R-5"]);
    expect(model.triggered.some((row) => row.resources.includes("shared/MOD-WYJATEK-GATE.md"))).toBe(true);
    const gates = Object.fromEntries(model.full.filter((item) => item.block).map((item) => [item.block, item.steps]));
    expect(gates["CN-GATE"]).toEqual(expect.arrayContaining(["CN-1", "CN-2", "CN-3"]));
    expect(gates["WYJ-GATE"]).toEqual(["S1", "S2", "S3", "S4"]);
    expect(gates["REM-GATE"]).toEqual(expect.arrayContaining(["REM-1", "REM-4"]));
    expect(model.full.find((item) => item.resource === "shared/MOD-WEJSCIE-DOKUMENTU.md")?.whenDocuments).toBe(true);
  });

  it("uses the full profile for a typical professional or criminal matter and the light one otherwise", () => {
    expect(pathProfile({ mode: "PRAWNIK", simple: false, criminal: false, documentGeneration: false })).toBe("PELNY");
    expect(pathProfile({ mode: "PRAWNIK", simple: true, criminal: false, documentGeneration: false })).toBe("LEKKI");
    expect(pathProfile({ mode: "LAIK", simple: false, criminal: false, documentGeneration: false })).toBe("LEKKI");
    expect(pathProfile({ mode: "LAIK", simple: true, criminal: true, documentGeneration: false })).toBe("PELNY");
    const base = { query: "art. 415 KC", legal: true, criminal: false, documents: false, documentsTruncated: false, documentGeneration: false, foreignJurisdiction: false };
    const full = preloadForTurn(model, { ...base, profile: "PELNY" });
    expect(full).toEqual(expect.arrayContaining(["shared/MOD-CN-GATE.md", "shared/MOD-REM-GATE.md", "shared/MOD-WYJATEK-GATE.md", "prawny-router-v3/references/SELF-CHECK.md"]));
    expect(full).not.toContain("shared/MOD-WEJSCIE-DOKUMENTU.md");
    const light = preloadForTurn(model, { ...base, profile: "LEKKI" });
    expect(light).toContain("prawny-router-v3/references/SELF-CHECK.md");
    expect(light).not.toContain("shared/MOD-CN-GATE.md");
  });

  function facts(answer: string, overrides: Partial<TurnFacts> = {}): TurnFacts {
    return {
      profile: "PELNY",
      contextResources: new Set([
        "prawny-router-v3/SKILL.md",
        "shared/PRAWO-HARDGATE.md",
        "prawny-router-v3/references/KROK0A-anonimizer.md",
        "prawny-router-v3/references/KROK1-detekcja.md",
        ...preloadForTurn(model, { profile: "PELNY", query: "art. 233 KK", legal: true, criminal: true, documents: false, documentsTruncated: false, documentGeneration: false, foreignJurisdiction: false })
      ]),
      query: "Wykaż różnice pomiędzy 233 kk, 234 kk i 238 kk.",
      answer,
      legal: true,
      criminal: true,
      documents: false,
      documentsTruncated: false,
      documentGeneration: false,
      foreignJurisdiction: false,
      federationTools: true,
      records: [{ claim: "art. 233 KK", kind: "statute", status: "VERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf", fetchedAt: "2026-10-03T10:00:00Z", verificationMethod: "web_fetch_pdf" }],
      events: [
        { type: "gate", target: "G39I_CHAT_PRIVACY", status: "OK", detail: { pseudonymized: 0 } },
        { type: "skill_read", target: "dr-03-prawo-karne-wykroczenia-egzekucja", status: "OK" }
      ],
      loadedSkills: ["dr-03-prawo-karne-wykroczenia-egzekucja"],
      primarySkill: "dr-03-prawo-karne-wykroczenia-egzekucja",
      finalization: "PASS",
      ...overrides
    };
  }

  it("marks gate blocks and their steps missing when the answer does not show them", () => {
    const report = evaluateMandatoryPath(model, facts("Art. 233 KK — fałszywe zeznanie. ✅ [VER: https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=54, 2026-10-03]"));
    const byId = Object.fromEntries(report.steps.map((step) => [step.id, step]));
    expect(byId["R-5"]).toMatchObject({ status: "MET", by: "APLIKACJA" });
    expect(byId["KROK-0A-WYKONANIE"]).toMatchObject({ status: "MET", by: "APLIKACJA" });
    expect(byId["CN-GATE-BLOK"]!.status).toBe("MISSING");
    expect(byId["REM-GATE-BLOK"]!.status).toBe("MISSING");
    expect(byId["VER-GRAIN"]).toMatchObject({ status: "MET", by: "APLIKACJA" });
    expect(byId["VER-GRAIN"]!.evidence).toContain("kotwica");
    expect(byId["G8"]!.status).toBe("MET");
    expect(report.complete).toBe(false);
  });

  it("accepts the gate blocks with every step named in the module", () => {
    const answer = [
      "CN-GATE: CN-1 jednostka, CN-2 zakres podmiotowy, CN-3 zakres czasowy.",
      "WYJ-GATE: S1, S2, S3, S4 — brak wyjątków.",
      "Art. 233 KK — fałszywe zeznanie. ✅ [VER: https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=54, 2026-10-03]",
      "REM-GATE: REM-0, REM-1, REM-2, REM-3, REM-4.",
      "To ogólna informacja prawna, nie indywidualna porada prawna."
    ].join("\n");
    const byId = Object.fromEntries(evaluateMandatoryPath(model, facts(answer)).steps.map((step) => [step.id, step.status]));
    expect(byId["CN-GATE-BLOK"]).toBe("MET");
    expect(byId["WYJ-GATE-BLOK"]).toBe("MET");
    expect(byId["REM-GATE-BLOK"]).toBe("MET");
  });

  it("flags a description of querying a source with no call behind it", () => {
    const report = evaluateMandatoryPath(model, facts("📡 Odpytałem bazę SAOS i sprawdziłem w ISAP brzmienie art. 233 KK.", { records: [] }));
    const claims = report.steps.find((step) => step.id === "DEKLARACJE-WYKONANIA")!;
    expect(claims.status).toBe("MISSING");
    expect(claims.evidence).toContain("SAOS");
  });
});

describe("mandatory path in a session", () => {
  it("loads the router's mandatory gates for a criminal matter, states the model and returns the register", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    let params: ProviderStreamParams | undefined;
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "path",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        params = received;
        return { fullText: "Art. 233 KK — fałszywe zeznanie.\n\nTo ogólna informacja prawna, nie indywidualna porada prawna." };
      }
    });
    // The question's "233 kk" is verified before the answer.
    const verified: string[] = [];
    const verification = (ledger: VerificationLedger) =>
      ({
        schemas: () => [],
        systemPromptAppendix: () => "",
        auditEvents: () => [],
        async runTools(calls: Array<{ id: string; input: Record<string, unknown> }>) {
          return calls.map((call) => {
            const claim = String(call.input.claim);
            verified.push(claim);
            ledger.add({ claim, kind: "statute", status: "VERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf", fetchedAt: "2026-10-03T10:00:00Z", verificationMethod: "web_fetch_pdf" });
            return { tool_use_id: call.id, content: JSON.stringify({ status: "VERIFIED", claim }) };
          });
        }
      }) as never;
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
    const decision = detectQueryMode("Wykaż różnice pomiędzy 233 kk, 234 kk i 238 kk.", signals, null);
    const result = await executor.execute({
      query: "Wykaż różnice pomiędzy 233 kk, 234 kk i 238 kk.",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-03-prawo-karne-wykroczenia-egzekucja",
      mode: decision.mode,
      modeDecision: decision
    });
    expect(params?.systemPrompt).toContain("# MANDATORY PATH RESOURCE: shared/MOD-CN-GATE.md");
    expect(params?.systemPrompt).toContain("PROFIL PEŁNY");
    expect(params?.systemPrompt).toContain("identyfikator modelu w aplikacji: account/openai/default");
    expect(params?.systemPrompt).toContain("Tryb: PRAWNIK");
    expect(result.mandatoryPath).toMatchObject({ profile: "PELNY" });
    expect(result.mandatoryPath!.steps.find((step) => step.id === "PELNY:MOD-CN-GATE")).toMatchObject({ status: "MET", by: "APLIKACJA" });
    expect(result.modeDecision?.mode).toBe("PRAWNIK");
    expect(verified).toEqual(expect.arrayContaining(["art. 233 KK", "art. 234 KK", "art. 238 KK"]));
  }, 60_000);
});
