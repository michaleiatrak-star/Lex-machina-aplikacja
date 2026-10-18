import { describe, expect, it, vi } from "vitest";
import { OfficialLegalSourceVerifier } from "../src/legal-source-verifier.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { LegalVerificationToolRuntime } from "../src/verification-tool-runtime.js";
import type { TemporalSourceFreshnessChecker } from "../src/temporal-source-freshness.js";

// A regulation effective from a future date: the model passed that date as asOf and every
// call was DENIED (AS_OF_MUST_BE_A_PAST_ISO_DATE), leaving the answer blocked (live test 2026-10-17).
describe("asOf dziś albo w przyszłości", () => {
  it("sprawdza brzmienie aktualne zamiast odmowy; przeszła data zostaje historyczna", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const check = vi.fn(async (_act: unknown, options: Record<string, unknown>) => {
      seen.push(options);
      throw new Error("TEST_STOP");
    });
    const runtime = new LegalVerificationToolRuntime(
      new VerificationLedger(),
      new OfficialLegalSourceVerifier(async () => new Response("", { status: 500 })),
      undefined,
      { check } as unknown as TemporalSourceFreshnessChecker
    );
    await runtime.runTools([{ id: "f", name: "verify_legal_reference", input: { claim: "art. 556 KC", kind: "statute", act: "k.c.", asOf: "2099-01-01" } }]).catch(() => undefined);
    await runtime.runTools([{ id: "p", name: "verify_legal_reference", input: { claim: "art. 5 KC", kind: "statute", act: "k.c.", asOf: "2020-01-01" } }]).catch(() => undefined);
    expect(seen[0]).not.toHaveProperty("asOf");
    expect(seen[1]).toMatchObject({ asOf: "2020-01-01" });
  });
});
