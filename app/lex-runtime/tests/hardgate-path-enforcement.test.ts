import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkProvisionsAtEventDates, eventDates } from "../src/event-date-check.js";
import { endsWithDisclaimer, parseDisclaimer, splitTrailingDisclaimer, withDisclaimer } from "../src/legal-disclaimer.js";
import { evaluateMandatoryPath, gateCorrectionPrompt, loadMandatoryPathModel, missingGateBlocks, routingTrace, type TurnFacts } from "../src/mandatory-path.js";
import type { NormalizedToolCall } from "../src/providers/types.js";
import type { VerificationRecord } from "../src/verification-ledger.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const read = (resource: string) => {
  try {
    return fs.readFileSync(path.join(CORPUS, resource), "utf8");
  } catch {
    return null;
  }
};
const model = loadMandatoryPathModel(read);

const record = (claim: string, evidence: string): VerificationRecord => ({
  claim,
  kind: "statute",
  status: "VERIFIED",
  sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.html",
  sourceTier: "R1",
  fetchedAt: "2026-10-03T00:00:00Z",
  evidence,
  actDescriptor: {
    id: "KK",
    title: "Kodeks karny",
    eli: "DU/2025/383",
    baseEli: "DU/1997/553",
    sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.html",
    sourceKind: "consolidated_text",
    registryAsOf: "2026-09-15"
  }
});

describe("KROK 4: wording on the event date", () => {
  it("reads past event dates, not act dates or deadlines", () => {
    expect(
      eventDates(
        "Zdarzenie miało miejsce 12 marca 2021 r. (ustawa z dnia 6 czerwca 1997 r. Kodeks karny), rozprawa 03.02.2022, termin do dnia 30.12.2026.",
        "2026-10-03"
      )
    ).toEqual(["2021-03-12", "2022-02-03"]);
    expect(eventDates("Pytanie ogólne o art. 233 KK", "2026-10-03")).toEqual([]);
  });

  it("verifies on the event date in a separate run and compares the wording", async () => {
    const calls: NormalizedToolCall[] = [];
    const check = await checkProvisionsAtEventDates({
      records: [record("art. 233 § 1 KK", "Art. 233. § 1. ... od 6 miesięcy do lat 8."), record("art. 234 KK", "Art. 234. Kto ...")],
      dates: ["2021-03-12"],
      runTools: async (batch) => {
        calls.push(...batch);
        return batch.map((call) => ({
          tool_use_id: call.id,
          content: JSON.stringify(
            call.input.claim === "art. 233 § 1 KK"
              ? { status: "VERIFIED", evidence: "Art. 233. § 1. ... od 6 miesięcy do lat 8." }
              : { status: "VERIFIED", evidence: "Art. 234. Kto (brzmienie sprzed nowelizacji) ..." }
          )
        }));
      }
    });
    expect(calls.map((call) => call.input)).toEqual([
      { claim: "art. 233 § 1 KK", kind: "statute", act: "KK", asOf: "2021-03-12" },
      { claim: "art. 234 KK", kind: "statute", act: "KK", asOf: "2021-03-12" }
    ]);
    expect(check.items.map((item) => item.result)).toEqual(["SAME", "DIFFERENT"]);
  });
});

describe("KROK 7: disclaimer as the last element", () => {
  const texts = parseDisclaimer(read("shared/DISCLAIMER.md")!)!;

  it("takes the variants from the canonical file", () => {
    expect(texts.laik).toMatch(/nie stanowi porady prawnej/iu);
    expect(texts.prawnik).toMatch(/Zastrzeżenie/u);
    expect(texts.pismo).toMatch(/Przed podpisaniem/u);
  });

  it("adds the mode variant only when the answer does not end with one", () => {
    const added = withDisclaimer("Analiza.", texts, { mode: "LAIK", pleading: false });
    expect(added.appended).toBe(true);
    expect(endsWithDisclaimer(added.text)).toBe(true);
    expect(withDisclaimer(added.text, texts, { mode: "LAIK", pleading: false }).appended).toBe(false);
    const pleading = withDisclaimer("Projekt pozwu.", texts, { mode: "PRAWNIK", pleading: true }).text;
    expect(pleading.indexOf("Zastrzeżenie")).toBeLessThan(pleading.indexOf("Przed podpisaniem"));
  });

  it("cuts the model's own disclaimer off before the gates; the canonical one goes back after them", () => {
    const answer = [
      "Art. 233 KK ✅ [VER: x, 2026-10-04] — fałszywe zeznania.",
      "REM-GATE\n\nREM-0: brak.",
      "⚖️ Zastrzeżenie: Niniejsza analiza ma charakter informacyjny. Nie stanowi porady prawnej ani opinii prawnej w rozumieniu art. 4 ust. 1 Prawa o adwokaturze (t.j. Dz.U. z 2024 r. poz. 1564, ze zm.)."
    ].join("\n\n");
    const split = splitTrailingDisclaimer(answer);
    expect(split.disclaimer).toMatch(/^⚖️ Zastrzeżenie/u);
    expect(split.body).not.toMatch(/Dz\.U\./u);
    expect(split.body.endsWith("REM-0: brak.")).toBe(true);
    const restored = withDisclaimer(split.body, texts, { mode: "PRAWNIK", pleading: false });
    expect(restored.text.endsWith(texts.prawnik)).toBe(true);
    // With a rule above it and the pleading variant below.
    const ruled = splitTrailingDisclaimer(`Analiza.\n\n${texts.prawnik}\n\n${texts.pismo}`);
    expect(ruled.body).toBe("Analiza.");
    // An analysis that only quotes the closing words keeps them.
    expect(splitTrailingDisclaimer("Opinia nie stanowi porady prawnej, gdy brak stosunku pełnomocnictwa.").disclaimer).toBeNull();
  });
});

describe("mandatory gates and KROK 3A", () => {
  it("names the gate blocks missing in PEŁNY and asks for them", () => {
    const missing = missingGateBlocks(model, "PELNY", "Art. 233 § 1 KK ✅ [VER: x, 2026-10-03] — analiza bez bramek.");
    expect(missing.map((item) => item.block)).toEqual(expect.arrayContaining(["CN-GATE", "REM-GATE", "WYJ-GATE"]));
    expect(missingGateBlocks(model, "LEKKI", "cokolwiek")).toEqual([]);
    expect(gateCorrectionPrompt(missing)).toContain("PEŁNĄ poprawioną odpowiedź");
  });

  it("writes the routing trace from the audit, not from the model", () => {
    const facts: TurnFacts = {
      profile: "LEKKI",
      contextResources: new Set(model.core.map((item) => item.resource)),
      query: "Wykaż różnice pomiędzy 233 kk i 234 kk.",
      answer: "Odpowiedź.",
      legal: true,
      criminal: true,
      documents: false,
      documentsTruncated: false,
      documentGeneration: false,
      foreignJurisdiction: false,
      federationTools: false,
      records: [],
      events: [{ type: "skill_read", target: "dr-03-prawo-karne-wykroczenia-egzekucja", status: "OK" }],
      loadedSkills: ["prawny-router-v3", "dr-03-prawo-karne-wykroczenia-egzekucja"],
      primarySkill: "AUTO",
      finalization: "PASS",
      disclaimerBy: "APLIKACJA"
    };
    const report = evaluateMandatoryPath(model, facts);
    expect(report.steps.find((step) => step.id === "DISCLAIMER-OSTATNI")).toMatchObject({ status: "MET", by: "APLIKACJA" });
    const trace = routingTrace({
      mode: "PRAWNIK",
      report,
      primarySkill: "AUTO",
      loadedSkills: facts.loadedSkills,
      events: facts.events,
      routerVersion: "3.58",
      sharedRoot: "Wersja rozwojowa rozpakowana/shared",
      duplicates: []
    });
    expect(trace.primaryRead).toBe(true);
    expect(trace.text).toContain("PRIMARY: dr-03-prawo-karne-wykroczenia-egzekucja — ROUTER-WCZYTANY: TAK");
    expect(trace.text).toContain("WERSJA ROUTERA: 3.58");
    expect(trace.text).toMatch(/PROFIL: LEKKI — rdzeń R-1…R-5: TAK/u);
    expect(routingTrace({ ...{ mode: "LAIK" as const, report, primarySkill: "AUTO", loadedSkills: [], events: [], routerVersion: null, sharedRoot: "s", duplicates: [] } }).primaryRead).toBe(false);
  });
});
