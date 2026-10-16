// Live check (Cellar/EUR-Lex) of EU-law references through verify_legal_reference.
// Run: npx tsx src/validate-eu-live.ts
import { OfficialLegalSourceVerifier } from "./legal-source-verifier.js";
import { TemporalSourceFreshnessChecker } from "./temporal-source-freshness.js";
import { LegalVerificationToolRuntime } from "./verification-tool-runtime.js";
import { VerificationLedger } from "./verification-ledger.js";
const CASES = [
    { claim: "art. 6 ust. 1 lit. f RODO", act: "RODO", status: "VERIFIED", evidence: /Zgodność przetwarzania z prawem/u },
    { claim: "art. 5 AI Act", act: "rozporządzenie (UE) 2024/1689", status: "VERIFIED", evidence: /Zakazane praktyki/u, staged: true },
    { claim: "art. 10 ust. 2 dyrektywy 2008/48/WE", act: "dyrektywa 2008/48/WE", status: "VERIFIED", evidence: /umowach o kredyt/u },
    { claim: "art. 25 ust. 1 Bruksela I bis", act: "rozporządzenie (UE) nr 1215/2012", status: "VERIFIED", evidence: /uzgodniły/u },
    { claim: "art. 4 rozporządzenia Rzym I", act: "Rzym I", status: "VERIFIED", evidence: /braku wyboru prawa/u, staged: true },
    { claim: "art. 6 ust. 9 RODO", act: "RODO", status: "UNVERIFIED", evidence: /nie ma powołanej jednostki/u },
    { claim: "art. 999 RODO", act: "RODO", status: "UNVERIFIED", evidence: /nie ma artykułu 999/u },
    { claim: "art. 1 dyrektywy 95/46/WE", act: "dyrektywa 95/46/WE", status: "UNVERIFIED", evidence: /nie obowiązuje/u }
];
const runtime = new LegalVerificationToolRuntime(new VerificationLedger(), new OfficialLegalSourceVerifier(), undefined, new TemporalSourceFreshnessChecker());
let failures = 0;
for (const item of CASES) {
    const [result] = await runtime.runTools([{ id: item.claim, name: "verify_legal_reference", input: { claim: item.claim, kind: "statute", act: item.act } }]);
    const payload = JSON.parse(String(result?.content ?? "{}"));
    const problem = payload.status !== item.status
        ? `status ${String(payload.status)} ${String(payload.error ?? "")}`
        : item.evidence && !item.evidence.test(String(payload.evidence ?? ""))
            ? "dowód bez oczekiwanej treści"
            : item.staged && !payload.applicationRule
                ? "brak reguły stosowania"
                : null;
    failures += problem ? 1 : 0;
    console.log(JSON.stringify({ claim: item.claim, ok: !problem, problem, status: payload.status, version: payload.act?.version ?? null }));
}
console.log(failures ? `EU_LIVE_FAIL ${failures}` : "EU_LIVE_PASS");
process.exitCode = failures ? 1 : 0;
