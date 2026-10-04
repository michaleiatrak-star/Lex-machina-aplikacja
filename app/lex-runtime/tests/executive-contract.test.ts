import path from "node:path";
import { describe, expect, it } from "vitest";
import { executiveContract, loadContract } from "../src/executive-skill-contract.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";
import type { VerificationLedger } from "../src/verification-ledger.js";

const verification = (ledger: VerificationLedger) =>
  ({
    schemas: () => [],
    systemPromptAppendix: () => "",
    auditEvents: () => [],
    async runTools(calls: Array<{ id: string; input: Record<string, unknown> }>) {
      return calls.map((call) => {
        const claim = String(call.input.claim);
        ledger.add({ claim, kind: "statute", status: "VERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/1071/text.pdf", fetchedAt: "2026-10-04T10:00:00Z", verificationMethod: "web_fetch_pdf" });
        return { tool_use_id: call.id, content: JSON.stringify({ status: "VERIFIED", claim }) };
      });
    }
  }) as never;

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();

// Every executive skill a user can pick in the mechanical mode.
const EXECUTIVE = [
  "pisma-procesowe-v3",
  "pisma-proste-v2",
  "analiza-sadowa-v6",
  "analizator-dowodow-v3",
  "analizator-przepisow-v2",
  "analizator-umow-v1",
  "chronologia-sprawy-v1",
  "orzeczenia-sadowe-v2",
  "przesluchanie-swiadkow-v2-min90",
  "raport-klienta-v1",
  "raport-sytuacyjny-v2",
  "przewodnik-prawny-v2"
];

describe("executive skill contracts from the corpus", () => {
  it.each(EXECUTIVE)("%s: mandatory gates in order, every resource in the corpus", (skill) => {
    const contract = executiveContract(registry, skill)!;
    expect(contract.gates.length).toBeGreaterThan(0);
    for (const resource of contract.resources) {
      expect(registry.resolveResource(skill, resource)).toBeTruthy();
      expect(resource.startsWith("shared/") || resource.startsWith(`${skill}/`)).toBe(true);
    }
    const loaded = loadContract(registry, contract);
    expect(loaded.loaded.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(120_000);
  });

  it("pisma-procesowe-v3 names its own hard gates", () => {
    const titles = executiveContract(registry, "pisma-procesowe-v3")!.gates.map((gate) => gate.title);
    expect(titles.join("\n")).toMatch(/AUTOMAT STANÓW[\s\S]*MANDATORY-REREAD-GATE[\s\S]*PRE-W2-VERIFICATION-GATE/u);
  });
});

describe("mechanical mode: the chosen executive skill's contract and the router's mandatory path", () => {
  it("loads the contract for the chosen skill and registers it", async () => {
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "mechanical",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "RAPORT ANALIZY\n\nArt. 415 KC — odpowiedzialność deliktowa." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
    const result = await executor.execute({
      query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify({ auto: false, manual: ["analizator-przepisow-v2"] })}\nPrzeanalizuj art. 415 KC.`,
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
      mode: "PRAWNIK"
    });
    const prompt = calls[0]!.systemPrompt ?? "";
    expect(prompt).toContain("# KONTRAKT SKILLA WYKONAWCZEGO: analizator-przepisow-v2");
    // Router's mandatory path in the same turn.
    expect(prompt).toContain("ŚCIEŻKA OBOWIĄZKOWA");
    expect(result.mandatoryPath!.steps.find((step) => step.id === "KONTRAKT:analizator-przepisow-v2")).toMatchObject({ layer: "SKILL" });
  }, 60_000);
});
