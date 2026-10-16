// Live check (Sejm ELI) of amendments, pending wording and historical dates through the whole
// verify_legal_reference path: freshness check -> verifier -> the result the model reads.
// Run: npx tsx src/validate-temporal-live.ts
import { OfficialLegalSourceVerifier } from "./legal-source-verifier.js";
import { TemporalSourceFreshnessChecker } from "./temporal-source-freshness.js";
import { LegalVerificationToolRuntime } from "./verification-tool-runtime.js";
import { VerificationLedger } from "./verification-ledger.js";
import { CoreLawIndex } from "./core-law-index.js";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

type Case = { claim: string; act: string; asOf?: string; expect: (payload: Record<string, any>) => string | null };

const CASES: Case[] = [
  {
    // t.j. KP 2026/1245 prints art. 94 pkt 2b (new) and 2c, in force from 5.11.2026.
    claim: "art. 94 KP",
    act: "KP",
    expect: (p) =>
      p.status !== "VERIFIED"
        ? `status ${p.status} ${p.error ?? ""} ${p.freshness?.reason ?? ""}`
        : !p.pendingWording?.some((item: { from: string }) => item.from === "2026-11-05")
          ? "brak pendingWording od 2026-11-05"
          : /godności/u.test(p.evidence ?? "")
            ? "przyszły pkt 2c w dowodzie"
            : p.pendingWording.some((item: { text: string }) => /\d \)/u.test(item.text))
              ? "znacznik odnośnika w przyszłym brzmieniu"
              : null
  },
  {
    // DU/2026/507 changes art. 860 KC only from 1.11.2028.
    claim: "art. 860 KC",
    act: "KC",
    expect: (p) =>
      p.status !== "VERIFIED"
        ? `status ${p.status} ${p.error ?? ""} ${p.freshness?.reason ?? ""}`
        : !p.pendingWording?.some((item: { from: string }) => item.from === "2028-11-01")
          ? "brak pendingWording od 2028-11-01"
          : /§ 3\./u.test(p.evidence ?? "")
            ? "przyszły § 3 w dowodzie"
            : null
  },
  {
    // KK: amendments after its t.j. are listed by Dz.U., date and status, not counted.
    claim: "art. 148 KK",
    act: "KK",
    expect: (p) =>
      (p.freshness?.amendmentsAfter ?? 0) > 0 &&
      !(p.freshness?.amendments ?? []).every((item: { dzU?: string; status?: string }) => item.dzU && item.status)
        ? "nowelizacje bez Dz.U. lub statusu"
        : null
  },
  { claim: "art. 385^1 KC", act: "KC", expect: (p) => (p.status === "VERIFIED" ? null : `status ${p.status} ${p.error ?? ""} ${p.freshness?.reason ?? ""}`) },
  { claim: "art. 5 KC", act: "KC", asOf: "2021-06-01", expect: (p) => (p.status === "VERIFIED" || p.status === "DENIED" ? null : `status ${p.status}`) }
];

const ledger = new VerificationLedger();
// An act outside the built-in list (KP) is found by its Dz.U. reference, as in the app.
const coreLaw = new CoreLawIndex(mkdtempSync(path.join(os.tmpdir(), "lex-temporal-live-")));
const runtime = new LegalVerificationToolRuntime(
  ledger,
  new OfficialLegalSourceVerifier(),
  undefined,
  new TemporalSourceFreshnessChecker(),
  undefined,
  undefined,
  coreLaw
);
let failures = 0;
for (const item of CASES) {
  const started = Date.now();
  const [result] = await runtime.runTools([
    { id: `live-${item.claim}`, name: "verify_legal_reference", input: { claim: item.claim, kind: "statute", act: item.act, ...(item.asOf ? { asOf: item.asOf } : {}) } }
  ]);
  let payload: Record<string, any> = {};
  try {
    payload = JSON.parse(String(result?.content ?? "{}"));
  } catch {
    payload = { status: "NOT_JSON", raw: String(result?.content ?? "").slice(0, 300) };
  }
  const problem = item.expect(payload);
  failures += problem ? 1 : 0;
  console.log(
    JSON.stringify({
      claim: item.claim,
      asOf: item.asOf ?? null,
      ok: !problem,
      problem,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      status: payload.status,
      error: payload.error ?? null,
      reason: payload.freshness?.reason ?? null,
      currentEli: payload.freshness?.currentEli ?? null,
      amendments: payload.freshness?.amendments ?? null,
      pendingWordingAmendments: payload.freshness?.pendingWordingAmendments ?? null,
      transitional: (payload.freshness?.transitionalProvisions ?? []).length,
      pendingWording: (payload.pendingWording ?? []).map((p: { from: string; text: string }) => `${p.from}: ${p.text.slice(0, 70)}`),
      evidence: String(payload.evidence ?? "").slice(0, 160)
    })
  );
}
console.log(failures ? `TEMPORAL_LIVE_FAIL ${failures}` : "TEMPORAL_LIVE_PASS");
process.exitCode = failures ? 1 : 0;
