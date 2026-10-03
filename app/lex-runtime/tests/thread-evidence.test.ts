import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderAdapter, ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SESSION_EXECUTION_INTERNAL, SafeSessionExecutor } from "../src/session-executor.js";
import { EncryptedCaseWorkspaceStore } from "../src/case-workspace-store.js";
import type { LegalActDescriptor } from "../src/legal-act-resolver.js";
import type { TemporalFreshnessResult } from "../src/temporal-source-freshness.js";
import type { VerificationRecord } from "../src/verification-ledger.js";
import {
  mergeThreadEvidence,
  revalidateThreadEvidence,
  threadEvidencePrompt,
  type ThreadEvidence
} from "../src/thread-evidence.js";

const DR = "dr-02-prawo-cywilne-rodzinne-gospodarcze";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const KK: LegalActDescriptor = {
  id: "KK",
  title: "Kodeks karny",
  eli: "DU/2025/383",
  baseEli: "DU/1997/553",
  sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.html",
  sourceKind: "consolidated_text",
  registryAsOf: "2026-09-15"
};

function without(record: VerificationRecord, field: "actDescriptor" | "currentEli"): VerificationRecord {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

function verified(claim: string, overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    claim,
    kind: "statute",
    status: "VERIFIED",
    sourceUrl: "https://eli.gov.pl/a233",
    sourceTier: "R1",
    fetchedAt: "2026-10-01T10:00:00Z",
    temporalMode: "CURRENT",
    temporalFreshnessStatus: "CURRENT",
    currentEli: "DU/2025/383",
    actDescriptor: KK,
    ...overrides
  };
}

function freshness(overrides: Partial<TemporalFreshnessResult> = {}): TemporalFreshnessResult {
  return {
    status: "CURRENT",
    mode: "CURRENT",
    checkedAt: "2026-10-03T12:00:00Z",
    baseEli: KK.baseEli,
    pinnedEli: KK.eli,
    currentEli: "DU/2025/383",
    amendmentsAfter: [],
    ...overrides
  };
}

function evidence(records: VerificationRecord[]): ThreadEvidence {
  return mergeThreadEvidence(null, records, ["prawny-router-v3", DR], "2026-10-01T10:05:00Z");
}

describe("thread evidence memory", () => {
  it("keeps only provisions checked against the current consolidated text of a known act", () => {
    const merged = evidence([
      verified("art. 233 § 1 KK"),
      verified("art. 234 KK", { temporalMode: "HISTORICAL", temporalFreshnessStatus: "HISTORICAL" }),
      verified("art. 238 KK", { substituteFor: "R1" }),
      verified("art. 239 KK", { status: "UNVERIFIED" }),
      without(verified("art. 240 KK"), "actDescriptor"),
      { claim: "II KK 1/24", kind: "case", status: "VERIFIED", sourceUrl: "https://www.sn.pl/x", fetchedAt: "2026-10-01T10:00:00Z" }
    ]);
    expect(merged.provisions.map((record) => record.claim)).toEqual(["art. 233 § 1 KK"]);
    expect(merged.sources.map((source) => source.claim)).toEqual(["II KK 1/24"]);
    const next = mergeThreadEvidence(merged, [verified("art. 233 § 1 KK", { fetchedAt: "2026-10-02T09:00:00Z" })], [DR], "x");
    expect(next.provisions).toHaveLength(1);
    expect(next.provisions[0]!.fetchedAt).toBe("2026-10-02T09:00:00Z");
    expect(next.skills).toEqual(["prawny-router-v3", DR]);
  });

  it("reuses a provision only when ELI has the same consolidated text and no amendment after it", async () => {
    const memory = evidence([verified("art. 233 § 1 KK")]);
    const same = await revalidateThreadEvidence(memory, async () => freshness());
    expect(same.reused.map((record) => record.freshnessCheckedAt)).toEqual(["2026-10-03T12:00:00Z"]);
    for (const [result, reason] of [
      [freshness({ currentEli: "DU/2026/100" }), "CONSOLIDATED_TEXT_CHANGED"],
      [freshness({ amendmentsAfter: [{ eli: "DU/2026/5", displayAddress: "Dz.U. 2026 poz. 5", promulgation: "2026-01-05", title: "nowelizacja", provenance: "API" }] }), "POST_TJ_AMENDMENTS"],
      [freshness({ status: "STALE_CONSOLIDATED_TEXT" }), "STALE_CONSOLIDATED_TEXT"]
    ] as const) {
      const changed = await revalidateThreadEvidence(memory, async () => result);
      expect(changed.reused).toEqual([]);
      expect(changed.recheck).toEqual([{ claim: "art. 233 § 1 KK", reason }]);
    }
    const down = await revalidateThreadEvidence(memory, async () => {
      throw new Error("ELI down");
    });
    expect(down.recheck[0]!.reason).toBe("ELI_UNAVAILABLE");
    expect(threadEvidencePrompt(memory, same)).toContain("Nie weryfikuj ich ponownie");
    expect(threadEvidencePrompt(memory, down)).toContain("art. 233 § 1 KK: ELI_UNAVAILABLE");
  });

  it("is stored encrypted in the case workspace and rejects forged records", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-memory-"));
    roots.push(root);
    const store = new EncryptedCaseWorkspaceStore({ rootDir: root });
    const caseId = "case_" + "a".repeat(32);
    const key = { caseId, caseDataKey: randomBytes(32), keyVersion: 1 };
    await store.saveCaseMemory({ ...key, evidence: evidence([verified("art. 233 § 1 KK")]) });
    const loaded = await store.getCaseMemory(key);
    expect(loaded.evidence?.provisions[0]?.claim).toBe("art. 233 § 1 KK");
    const file = fs.readFileSync(path.join(root, "cases", caseId, "secure", "workspace", "index.lmw1"), "utf8");
    expect(file).not.toContain("art. 233");
    // A record without the ELI check data is dropped on read.
    await store.saveCaseMemory({
      ...key,
      evidence: { ...evidence([]), provisions: [without(verified("art. 1 KK"), "currentEli")] }
    });
    expect((await store.getCaseMemory(key)).evidence?.provisions).toEqual([]);
  });
});

function registry(): LexSkillRegistry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-memory-skills-"));
  roots.push(root);
  for (const name of ["prawny-router-v3", "prawo-polskie-v2", DR]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, "SKILL.md"), `---\nname: ${name}\nversion: "1.0"\ndescription: "test"\n---\n# ${name}\n`);
  }
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  fs.writeFileSync(path.join(root, "shared", "PRAWO-HARDGATE.md"), "# hard gate\n");
  fs.mkdirSync(path.join(root, "prawny-router-v3", "references"), { recursive: true });
  fs.writeFileSync(path.join(root, "prawny-router-v3", "references", "KROK0A-anonimizer.md"), "# anon\n");
  fs.writeFileSync(path.join(root, "prawny-router-v3", "references", "KROK1-detekcja.md"), "# detect\n");
  fs.writeFileSync(path.join(root, "prawo-polskie-v2", "ROUTING-MAP.md"), DR + "\n");
  const result = new LexSkillRegistry(root);
  result.scan();
  return result;
}

async function run(memory: ThreadEvidence | undefined, check: (act: LegalActDescriptor) => Promise<TemporalFreshnessResult>) {
  let params: ProviderStreamParams | undefined;
  const adapter: ProviderAdapter = {
    id: "openai",
    label: "memory",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      params = received;
      return { fullText: "Art. 233 § 1 KK — fałszywe zeznania." };
    }
  };
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const executor = new SafeSessionExecutor(
    registry(),
    new ProviderGateway(providers),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    check
  );
  const result = await executor.execute({
    query: "A art. 233 § 1 KK w tym kontekście?",
    ...(memory ? { threadEvidence: memory } : {}),
    provider: "openai",
    model: "test",
    primarySkill: DR,
    mode: "PRAWNIK"
  });
  return { params, result };
}

describe("thread evidence memory in a session", () => {
  it("marks a provision verified in an earlier message, after the ELI check, without verifying it again", async () => {
    const checked: string[] = [];
    const { params, result } = await run(evidence([verified("art. 233 § 1 KK")]), async (act) => {
      checked.push(act.baseEli);
      return freshness();
    });
    expect(checked).toEqual(["DU/1997/553"]);
    expect(params?.systemPrompt).toContain("# JUŻ USTALONE W TEJ SPRAWIE");
    expect(result.answer).toContain("https://eli.gov.pl/a233");
    expect(result.answer).not.toContain("NIEWERYFIKOWANE");
    expect(result[SESSION_EXECUTION_INTERNAL]?.verificationRecords.map((record) => record.claim)).toEqual(["art. 233 § 1 KK"]);
  });

  it("does not reuse a provision whose act changed in ELI: it must be verified again", async () => {
    // No verifier in this test: an unverified provision in the question stops at the Gate I prelude.
    await expect(
      run(evidence([verified("art. 233 § 1 KK")]), async () => freshness({ currentEli: "DU/2026/100" }))
    ).rejects.toThrow("Gate I runtime prelude");
  });
});
