import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import type { VerificationLedger } from "../src/verification-ledger.js";
import { verificationMarker } from "../src/source-anchor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

function verification(calls: string[]) {
  return (ledger: VerificationLedger) =>
    ({
      schemas: () => [],
      systemPromptAppendix: () => "",
      auditEvents: () => [],
      async runTools(received: Array<{ id: string; input: Record<string, unknown> }>) {
        return received.map((call) => {
          const claim = String(call.input.claim);
          calls.push(`${claim}|${String(call.input.act ?? "")}`);
          const page = /\b233\b/.test(claim) ? 54 : 55;
          const record = { claim, kind: "statute" as const, status: "VERIFIED" as const, sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf", sourceAnchorUrl: `https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=${page}`, fetchedAt: "2026-10-04T10:00:00Z", verificationMethod: "web_fetch_pdf" as const };
          ledger.add(record);
          return { tool_use_id: call.id, content: JSON.stringify({ status: "VERIFIED", claim, marker: verificationMarker(record) }) };
        });
      }
    }) as never;
}

export async function run(answer: string, query = "Wykaż różnice pomiędzy 233 kk, 234 kk i 238 kk.") {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "shared",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream() {
      return { fullText: answer };
    }
  });
  const calls: string[] = [];
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification(calls));
  const result = await executor.execute({ query, provider: "openai", model: "account/openai/default", primarySkill: "dr-03-prawo-karne-wykroczenia-egzekucja", mode: "PRAWNIK" });
  return { result, calls };
}

describe("provisions sharing one act on a line", () => {
  it("are the provisions verified for the question, not separate claims without the act", async () => {
    const { result, calls } = await run(
      [
        "## Porównanie",
        "",
        "Art. 233, art. 234 i art. 238 k.k. chronią wymiar sprawiedliwości.",
        "",
        "| Cecha | Art. 233 | Art. 234 | Art. 238 |",
        "|---|---|---|---|",
        "| Czyn | fałszywe zeznanie | fałszywe oskarżenie | fałszywe zawiadomienie |",
        "",
        "To ogólna informacja prawna, nie indywidualna porada prawna."
      ].join("\n")
    );
    expect(calls.filter((call) => /^art\. 23[348] KK\|KK$/i.test(call))).toHaveLength(3);
    expect(result.finalization, JSON.stringify(result.blockedReferences)).toBe("PASS");
    expect(result.answer).not.toContain("NIEWERYFIKOWANE");
  }, 60_000);
});

describe("sources list", () => {
  it("lists an article once when its paragraph was verified at the same place", async () => {
    const { publicEvidenceBundle } = await import("../src/session-executor.js");
    const base = { kind: "statute" as const, status: "VERIFIED" as const, sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf", fetchedAt: "2026-10-04T10:00:00Z", verificationMethod: "web_fetch_pdf" as const };
    const page = (n: number) => ({ sourceAnchorUrl: `https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=${n}` });
    const claims = publicEvidenceBundle([
      { ...base, ...page(54), claim: "art. 233 KK" },
      { ...base, ...page(55), claim: "art. 234 KK" },
      { ...base, ...page(54), claim: "art. 233 § 1 KK" },
      { ...base, ...page(55), claim: "art. 234 KK" },
      { ...base, ...page(56), claim: "art. 238 § 2 KK" }
    ]).map((item) => item.claim);
    expect(claims).toEqual(["art. 233 KK", "art. 234 KK", "art. 238 § 2 KK"]);
  });
});
