import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { citedAsCaseLaw } from "../src/court-of-signature.js";
import { detectQueryMode, parseModeSignals } from "../src/query-mode.js";
import { hybridWarningTexts, validateLocalHybridDocument } from "../src/document-generation-validation.js";

const signals = parseModeSignals(
  fs.readFileSync(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana/prawny-router-v3/references/KROK1-detekcja.md"), "utf8")
);

describe("answer mode follows the account (2026-11-20)", () => {
  it("a law office account answers as a lawyer by default, also for a lay description", () => {
    expect(detectQueryMode("Dostałem pismo z sądu i nie rozumiem, co mam zrobić", signals, null, "PROFESSIONAL")).toMatchObject({ mode: "PRAWNIK", decision: "KONTO_KANCELARII" });
    expect(detectQueryMode("Napisz pozew", signals, null, "PROFESSIONAL")).toMatchObject({ mode: "PRAWNIK" });
    expect(detectQueryMode("Proszę o analizę art. 415 KC", signals, null, "PROFESSIONAL")).toMatchObject({ mode: "PRAWNIK", decision: "PRAWNIK" });
  });

  it("a law office account switches to plain words only when asked", () => {
    expect(detectQueryMode("Wyjaśnij to prostymi słowami, dla klienta", signals, null, "PROFESSIONAL")).toMatchObject({ mode: "LAIK" });
    expect(detectQueryMode("b", signals, null, "PROFESSIONAL")).toMatchObject({ mode: "LAIK", decision: "ODPOWIEDZ_NA_PYTANIE" });
    expect(detectQueryMode("A co dalej?", signals, "LAIK", "PROFESSIONAL")).toMatchObject({ mode: "LAIK", decision: "POPRZEDNI" });
  });

  it("an individual account keeps the KROK 1 detection", () => {
    expect(detectQueryMode("Dostałem pismo z sądu i nie rozumiem, co mam zrobić", signals, null, "INDIVIDUAL")).toMatchObject({ mode: "LAIK" });
    expect(detectQueryMode("Napisz pozew", signals, null, "INDIVIDUAL").decision).toBe("NIEROZSTRZYGNIETY");
  });
});

describe("signatures in the case files: own proceedings are not case law to verify", () => {
  const files = [
    "Sygn. akt II C 501/26",
    "PROTOKÓŁ rozprawy w sprawie o zapłatę.",
    "Wezwanie na rozprawę w sprawie IV P 77/25 przed Sądem Rejonowym.",
    "Postanowienie w sprawie o wykroczenie, sygn. akt IX W 310/25, doręczono obwinionemu.",
    "Powód powołuje wyrok Sądu Apelacyjnego w Krakowie z dnia 12 maja 2023 r., sygn. akt I ACa 812/22, oraz uchwałę SN z dnia 3 marca 2021 r., III CZP 19/20."
  ].join("\n");

  it("a ruling cited with its kind, court or date is case law", () => {
    expect(citedAsCaseLaw(files, "I ACa 812/22")).toBe(true);
    expect(citedAsCaseLaw(files, "III CZP 19/20")).toBe(true);
  });

  it("the party's own proceedings named in a summons, protocol or decision issued to the party are not", () => {
    expect(citedAsCaseLaw(files, "IV P 77/25")).toBe(false);
    expect(citedAsCaseLaw(files, "IX W 310/25")).toBe(false);
    expect(citedAsCaseLaw(files, "II C 501/26")).toBe(false);
  });
});

describe("HYBRID-VAL before the file warns instead of refusing (2026-11-20)", () => {
  const context = (blocked: boolean) => ({
    schemaVersion: 1 as const,
    sourceSessionId: "s",
    primarySkill: "pisma-procesowe-v3",
    provider: "openai" as const,
    model: "test",
    usedDocumentContext: true,
    verificationRecords: [],
    auditEvents: blocked ? [{ type: "gate", target: "G39I_TURN_STATE", status: "BLOCKED" } as never] : []
  });

  it("a blocked step of the conversation, a DRAFT mark or a missing source read: the file is saved with warnings", () => {
    const report = validateLocalHybridDocument("DRAFT — NIEWERYFIKOWANY\nWnoszę o zasądzenie.", context(true));
    expect(report.result).toBe("PASS");
    expect(report.reasons).toEqual([]);
    expect(report.warnings).toEqual(["DRAFT_UNVERIFIED", "SOURCE_SESSION_BLOCKED_EVENT", "SOURCE_DOCUMENT_AUDIT_MISSING"]);
    expect(hybridWarningTexts(report.warnings)[1]).toContain("sprawdź powołania");
  });

  it("only an empty document is refused", () => {
    expect(validateLocalHybridDocument("  ", context(false))).toMatchObject({ result: "BLOCKED", reasons: ["EMPTY_DOCUMENT"] });
  });
});

describe("the export trail keeps a stopped step as degraded", () => {
  it("no blocked_event_present in the rebuilt audit, the original status kept in the detail", async () => {
    const { rebuildGenerationExportState } = await import("../src/document-generation-validation.js");
    const { audit } = rebuildGenerationExportState({
      schemaVersion: 1,
      sourceSessionId: "s",
      primarySkill: "pisma-procesowe-v3",
      provider: "openai",
      model: "test",
      usedDocumentContext: false,
      verificationRecords: [],
      auditEvents: [{ type: "gate", target: "G39I_TURN_STATE", status: "BLOCKED", sequence: 3 } as never]
    });
    expect(audit.validateCompletion({ requireVerification: false }).violations).not.toContain("blocked_event_present");
  });
});
