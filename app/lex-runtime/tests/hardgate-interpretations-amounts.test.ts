import { describe, expect, it } from "vitest";
import { amountMatches, evidenceHasAmount } from "../src/amount-references.js";
import { FinalizationGate, addMissingVerificationMarkers, detectLegalReferences, markUnverifiedReferences } from "../src/finalization-gate.js";
import { planAutomaticLegalVerification } from "../src/gate-i-auto-verification.js";
import { interpretationSignaturesInLine, verifyInterpretation } from "../src/interpretation-verifier.js";
import { evaluateStatusConsistency, reconcileStatusMarkers } from "../src/status-consistency-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { LegalVerificationToolRuntime } from "../src/verification-tool-runtime.js";

const SIGNATURE = "0114-KDIP1-2.4012.345.2024.1.RD";

function eureka(options: { status?: number; text?: string; signature?: string } = {}): typeof fetch {
  const signature = options.signature ?? SIGNATURE;
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/wyszukiwarka/informacje/")) {
      return json({ results: [{ ID_INFORMACJI: 555, SYG: signature, DT_WYD: "2024-05-10T00:00:00", STATUS_INFORMACJI: ["Aktualna"] }, { ID_INFORMACJI: 556, SYG: `${signature}X` }] });
    }
    if (url.endsWith("/informacje/555")) {
      return json({
        dokument: {
          fields: [
            { key: "ID_INFORMACJI", value: "555" },
            { key: "SYG", value: signature },
            { key: "TEZA", value: "Prawo do odliczenia podatku naliczonego." },
            { key: "DT_WYD", value: "2024-05-10" },
            { key: "STATUS_INFORMACJI", value: options.status ?? 27 },
            { key: "TRESC_INTERESARIUSZ", value: `<p>${options.text ?? "Wnioskodawcy przysługuje prawo do odliczenia."}</p>` }
          ]
        }
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function finalize(text: string, ledger: VerificationLedger) {
  const gate = new FinalizationGate();
  const before = gate.evaluate(text, ledger);
  const repaired = reconcileStatusMarkers(addMissingVerificationMarkers(markUnverifiedReferences(text, before), before), ledger).text;
  return { before, text: repaired, after: gate.evaluate(repaired, ledger), consistency: evaluateStatusConsistency(repaired, ledger) };
}

describe("HARD GATE: tax interpretations", () => {
  it("detects KIS, pre-2017 and general interpretation signatures", () => {
    expect(interpretationSignaturesInLine(`Interpretacja z 10 maja 2024 r., ${SIGNATURE}, oraz IPPP1/4512-123/15-2/AW i DD10.8201.1.2020.`)).toEqual([
      SIGNATURE,
      "IPPP1/4512-123/15-2/AW",
      "DD10.8201.1.2020"
    ]);
    expect(interpretationSignaturesInLine("art. 86 ust. 1 ustawy o VAT, Dz.U. 2025 poz. 775, sygn. I FSK 12/20")).toEqual([]);
    expect(detectLegalReferences(`Zob. ${SIGNATURE}.`).map((reference) => reference.kind)).toEqual(["interpretation"]);
  });

  it("verifies an exact signature in EUREKA; a prefix match or other signature is not proof", async () => {
    const found = await verifyInterpretation({ signature: SIGNATURE, toolCallId: "i1", fetcher: eureka() });
    expect(found).toMatchObject({ status: "VERIFIED", current: true, eurekaStatus: "Aktualna" });
    expect(found.record).toMatchObject({ kind: "interpretation", sourceTier: "R2A", sourceUrl: "https://eureka.mf.gov.pl/informacje/podglad/555" });
    const other = await verifyInterpretation({ signature: "0114-KDIP1-2.4012.346.2024.1.RD", toolCallId: "i2", fetcher: eureka() });
    expect(other.status).toBe("NOT_FOUND");
    const quote = await verifyInterpretation({ signature: SIGNATURE, quote: "nie przysługuje", toolCallId: "i3", fetcher: eureka() });
    expect(quote.status).toBe("QUOTE_MISMATCH");
  });

  it("puts a non-current EUREKA status into the VER marker", async () => {
    const ledger = new VerificationLedger();
    const runtime = new LegalVerificationToolRuntime(ledger);
    runtime.interpretationFetcher = eureka({ status: 30 });
    const [result] = await runtime.runTools([{ id: "c1", name: "verify_interpretation", input: { signature: SIGNATURE } }]);
    const payload = JSON.parse(result!.content);
    expect(payload).toMatchObject({ status: "VERIFIED", current: false, eurekaStatus: "Nieaktualna" });
    expect(payload.marker).toMatch(/^✅ \[VER: https:\/\/eureka\.mf\.gov\.pl\/informacje\/podglad\/555, \d{4}-\d{2}-\d{2}, EUREKA: NIEAKTUALNA\]$/u);
    expect(runtime.schemas().map((schema) => schema.function.name)).toContain("verify_interpretation");
  });

  it("G8: an unverified interpretation is marked, a verified one needs its own marker", async () => {
    const ledger = new VerificationLedger();
    const runtime = new LegalVerificationToolRuntime(ledger);
    runtime.interpretationFetcher = eureka();
    const plan = planAutomaticLegalVerification(`Organ uznał tak w ${SIGNATURE}.`, ledger);
    expect(plan.calls).toEqual([expect.objectContaining({ name: "verify_interpretation", input: { signature: SIGNATURE } })]);

    const unknown = finalize("Organ uznał tak w 0111-KDIB1-3.4010.123.2024.2.BK.", ledger);
    expect(unknown.before.result).toBe("BLOCKED");
    expect(unknown.text).toContain("0111-KDIB1-3.4010.123.2024.2.BK ⚠️ [NIEWERYFIKOWANE]");
    expect(unknown.after.result).toBe("DEGRADED");

    await runtime.runTools([{ id: "c2", name: "verify_interpretation", input: { signature: SIGNATURE } }]);
    const marker = `✅ [VER: https://eureka.mf.gov.pl/informacje/podglad/555, ${ledger.latest(SIGNATURE)!.fetchedAt.slice(0, 10)}]`;
    const bare = finalize(`Organ uznał tak w ${SIGNATURE}.`, ledger);
    expect(bare.text).toContain(marker);
    expect(bare.after.result).toBe("PASS");
  });

  it("an interpretation's ⚠️ next to a verified provision does not conflict or vanish", () => {
    const ledger = new VerificationLedger();
    ledger.add({ claim: "art. 86 ust. 1 VAT", kind: "statute", status: "VERIFIED", sourceUrl: "https://eli.gov.pl/a86", sourceTier: "R1", fetchedAt: "2026-10-03T00:00:00Z" });
    const text = "Art. 86 ust. 1 VAT ✅ [VER: https://eli.gov.pl/a86, 2026-10-03] stosuje 0111-KDIB1-3.4010.123.2024.2.BK.";
    const result = finalize(text, ledger);
    expect(result.text).toContain("0111-KDIB1-3.4010.123.2024.2.BK ⚠️ [NIEWERYFIKOWANE]");
    expect(result.after.result).toBe("DEGRADED");
    expect(result.consistency.result).toBe("PASS");
  });
});

describe("HARD GATE: rates, deadlines and penalties", () => {
  const evidence = "Art. 233. § 1. Kto, składając zeznanie mające służyć za dowód w postępowaniu sądowym, zeznaje nieprawdę lub zataja prawdę, podlega karze pozbawienia wolności od 6 miesięcy do lat 8.";

  it("reads only normative values, with number and unit", () => {
    expect(amountMatches("Powód pożyczył 5000 zł w 2021 r.")).toEqual([]);
    expect(amountMatches("czyn zagrożony karą pozbawienia wolności do 8 lat").map((amount) => amount.key)).toEqual(["8Y"]);
    expect(evidenceHasAmount(evidence, "8Y")).toBe(true);
    expect(evidenceHasAmount(evidence, "6M")).toBe(true);
    expect(evidenceHasAmount(evidence, "5Y")).toBe(false);
    // Statutes often spell periods out.
    const kc = "Art. 118. ... termin przedawnienia wynosi sześć lat, a dla roszczeń o świadczenia okresowe ... trzy lata. Zażalenie wnosi się w terminie tygodnia.";
    expect(["6Y", "3Y", "1W"].map((key) => evidenceHasAmount(kc, key))).toEqual([true, true, true]);
    expect(evidenceHasAmount(kc, "10Y")).toBe(false);
  });

  it("a value from the verified provision passes; a value not in it gets ⚠️ without a status conflict", () => {
    const ledger = new VerificationLedger();
    ledger.add({ claim: "art. 233 § 1 KK", kind: "statute", status: "VERIFIED", sourceUrl: "https://eli.gov.pl/a233", sourceTier: "R1", fetchedAt: "2026-10-03T00:00:00Z", evidence });
    const marker = "✅ [VER: https://eli.gov.pl/a233, 2026-10-03]";
    const right = finalize(`Art. 233 § 1 KK ${marker} — czyn zagrożony karą pozbawienia wolności do 8 lat.`, ledger);
    expect(right.before.result).toBe("PASS");

    const wrong = finalize(`Art. 233 § 1 KK ${marker} — czyn zagrożony karą pozbawienia wolności do 5 lat.`, ledger);
    expect(wrong.before.result).toBe("BLOCKED");
    expect(wrong.text).toContain("do 5 lat ⚠️ [NIEWERYFIKOWANE]");
    expect(wrong.text).toContain(marker);
    expect(wrong.after.result).toBe("DEGRADED");
    expect(wrong.consistency.result).toBe("PASS");

    const alone = finalize("Termin na wniesienie apelacji wynosi 14 dni.", ledger);
    expect(alone.text).toContain("14 dni ⚠️ [NIEWERYFIKOWANE]");
    expect(alone.after.result).toBe("DEGRADED");
  });
});
