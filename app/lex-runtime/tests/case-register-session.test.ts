import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderAdapter, ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import type { CaseRegister } from "../src/case-register.js";
import { PseudonymizationVault } from "../src/privacy/pseudonymizer.js";
import { writeJurisdictionManifest } from "./jurisdiction-fixture.js";

// User 2026-11-27: the case register in a turn of the case, for a hosted and for a local model.
const DR = "dr-02-prawo-cywilne-rodzinne-gospodarcze";
const CASE = "case_0123456789abcdef0123456789abcdef";
const DOC = "doc_dddddddddddddddddddddddd";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function registry(): LexSkillRegistry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-register-session-"));
  roots.push(root);
  for (const name of ["prawny-router-v3", "prawo-polskie-v2", DR]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, "SKILL.md"), `---\nname: ${name}\nversion: "1.0"\ndescription: "test"\n---\n# ${name}\n`);
  }
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  fs.writeFileSync(path.join(root, "shared", "PRAWO-HARDGATE.md"), "# hard gate\n");
  writeJurisdictionManifest(root);
  fs.mkdirSync(path.join(root, "prawny-router-v3", "references"), { recursive: true });
  fs.writeFileSync(path.join(root, "prawny-router-v3", "references", "KROK0A-anonimizer.md"), "# anon\n");
  fs.writeFileSync(path.join(root, "prawny-router-v3", "references", "KROK1-detekcja.md"), "# detect\n");
  fs.writeFileSync(path.join(root, "prawo-polskie-v2", "ROUTING-MAP.md"), DR + "\n");
  const result = new LexSkillRegistry(root);
  result.scan();
  return result;
}

const TEXT = "[STRONA 1 · DIGITAL]\nPozwany: [PII:PERSON:0002]\nODPOWIEDŹ NA POZEW\nPozwany przyznaje zawarcie umowy z 10 stycznia 2025 r., ale zaprzecza, aby roboty wykonano należycie. Pozwany złożył oświadczenie o obniżeniu wynagrodzenia o 30 000 zł z tytułu rękojmi.";

async function turn(model: string, shared: boolean) {
  let params: ProviderStreamParams | undefined;
  const adapter: ProviderAdapter = {
    id: "openai",
    label: "register",
    capabilities: { streaming: true, tools: true, reasoning: false, modelDiscovery: false },
    async stream(received) {
      params = received;
      return { fullText: "Gotowe." };
    }
  };
  const providers = new ProviderRegistry();
  providers.register(adapter);
  let saved: CaseRegister | null = null;
  const executor = new SafeSessionExecutor(registry(), new ProviderGateway(providers));
  // The case's shared key: its placeholders are known to the vault of every turn.
  const seed = new PseudonymizationVault();
  seed.getOrCreate("PERSON", "Osoba Pierwsza");
  seed.getOrCreate("PERSON", "Osoba Druga");
  await executor.execute({
    privacySeed: seed.snapshot(),
    query: "Czy pozwany skutecznie obniżył wynagrodzenie?",
    documentAttachments: [{ documentId: DOC, caseId: CASE, sourceScope: "CASE_KNOWLEDGE", sharedKey: shared, chunks: [{ index: 1, pageStart: 1, pageEnd: 1, text: TEXT }] }],
    caseRegisterStore: { read: async () => saved, write: async (register) => { saved = register; } },
    provider: "openai",
    model,
    primarySkill: DR,
    mode: "PRAWNIK"
  });
  return { prompt: params?.systemPrompt ?? "", saved: saved as CaseRegister | null };
}

describe("the case register in a turn", () => {
  it("is built from the case's documents, kept, and given to the question", async () => {
    const { prompt, saved } = await turn("test", true);
    expect(saved?.participants.map((item) => item.symbol)).toEqual(["[PII:PERSON:0002]"]);
    expect(prompt).toContain("# REJESTR SPRAWY");
    expect(prompt).toMatch(/\[twierdzenie — pozwany\][^\n]*obniżeniu wynagrodzenia/u);
  });

  it("works for a local model too, in a shorter block", async () => {
    const { prompt, saved } = await turn("local/bielik", true);
    expect(saved?.facts.length).toBeGreaterThan(0);
    expect(prompt).toContain("# REJESTR SPRAWY");
  });

  it("takes no document outside the case's shared key (its placeholders change between turns)", async () => {
    const { saved, prompt } = await turn("test", false);
    expect(saved).toBeNull();
    expect(prompt).not.toContain("# REJESTR SPRAWY");
  });
});
