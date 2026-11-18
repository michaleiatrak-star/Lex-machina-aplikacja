import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { fitInstructions } from "../src/instruction-budget.js";
import { checkpointModuleNames } from "../src/process-checkpoint-contract.js";
import { DOC_MEDIA_TYPE, LocalOfficeDocumentTextExtractor } from "../src/office-document-extractor.js";
import { runBoundedProcessAutoSequence } from "../src/process-pleading-auto-runner.js";
import { acceptProcessPleadingStart, createProcessPleadingState } from "../src/process-pleading-state.js";
import { argumentSchemaGaps, motionProvisionsWithoutPremises } from "../src/pleading-standard.js";

// A Word 97 file (made with LibreOffice from neutral text), gzip + base64.
const DOC_GZ = "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";

describe("0.1.100 (user's app transcripts, 2026-11-17)", () => {
  it("reads a Word 97-2003 .doc with Polish characters", async () => {
    const text = await new LocalOfficeDocumentTextExtractor({ timeoutMs: 10_000 }).extract(gunzipSync(Buffer.from(DOC_GZ, "base64")), DOC_MEDIA_TYPE);
    expect(text).toContain("Zażółć gęślą jaźń");
    expect(text).toContain("ĄĆĘŁŃÓŚŹŻ");
  });

  it("fits the instructions to the model's window: the application's sections stay, other skill text gives way", () => {
    const module = (name: string, size: number) => `# ${name}\n${"x ".repeat(size / 2)}`;
    const prompt = [
      "wstęp",
      module("MOD-SKAN-DOWODOW-KOMPLETNY — inwentaryzacja", 200_000),
      module("Pisma Procesowe v3 — Model Trzech Wiadomości", 60_000),
      module("WIDGETS (show_widget)", 100_000),
      "# MACIERZ FAKTÓW Z DOKUMENTÓW SPRAWY (ustalona przez aplikację)\nfakt A",
      "# CELE DO WYKAZANIA (ustalone przez aplikację)\ncel 1"
    ].join("\n");
    expect(fitInstructions(prompt, 1_000_000).trimmed).toBe(false);
    expect(fitInstructions(prompt, undefined).trimmed).toBe(false);
    const fit = fitInstructions(prompt, 128_000, 1);
    expect(fit.trimmed).toBe(true);
    expect(fit.text.length).toBeLessThan(prompt.length);
    expect(fit.text).toContain("fakt A");
    expect(fit.text).toContain("cel 1");
    expect(fit.dropped[0]).toMatch(/MOD-SKAN/u);
    expect(fit.text).toContain("read_legal_resource");
  });

  it("a provision a motion rests on has its premises shown in the justification", () => {
    const bad = "Wnoszę o:\n1. ewentualnie konfrontację (art. 272 KPC).\n\nUzasadnienie\nZgodnie z art. 233 § 1 KPC sąd ocenia dowody.";
    expect(motionProvisionsWithoutPremises(bad)).toEqual(["art. 272"]);
    expect(argumentSchemaGaps(bad).map((gap) => gap.element)).toContain("PRZESŁANKI WNIOSKU");
    expect(motionProvisionsWithoutPremises(`${bad} Konfrontacja z art. 272 KPC jest dopuszczalna, ponieważ zeznania świadków X i Y przeczą sobie.`)).toEqual([]);
  });

  it("AUTO stops at STOP 2 (W2 closed) so the draft's file is made, then goes on to W3 and FINAL", async () => {
    let state = acceptProcessPleadingStart(createProcessPleadingState("case_" + "a".repeat(32), "AUTO", "2026-11-17T06:00:00.000Z"), "2026-11-17T06:00:01.000Z");
    const stops: string[] = [];
    for (let turn = 0; turn < 12; turn += 1) {
      const result = await runBoundedProcessAutoSequence({
        initialState: state,
        execute: async (permit) => ({ result: permit.checkpoint, commit: true }),
        persist: async (_previous, next) => next
      });
      stops.push(`${result.stopped}:${result.steps.at(-1)?.permit.checkpoint ?? "-"}`);
      state = result.state;
      if (result.stopped === "FINAL") break;
    }
    expect(stops).toContain("STAGE_STOP:CP-ATAK");
    expect(stops.at(-1)).toMatch(/^FINAL:/u);
  });

  it("in stages: a checkpoint's own module stays whole, another checkpoint's module waits for its own turn", () => {
    const prompt = [
      "wstęp",
      `# MOD-SKAN-DOWODOW-KOMPLETNY — inwentaryzacja\n${"s ".repeat(100_000)}`,
      `# MOD-ATAK-NA-DRAFT — atak\n${"a ".repeat(100_000)}`,
      `# WIDGETS (show_widget)\n${"w ".repeat(10_000)}`
    ].join("\n");
    const owner = checkpointModuleNames();
    const atAttack = fitInstructions(prompt, 128_000, 1, 0.6, { current: "CP-ATAK", owner });
    expect(atAttack.text).toContain("a ".repeat(100_000).trim());
    expect(atAttack.text).toMatch(/Moduł etapu CP-1c-skan: w tej turze odłożony/u);
    const atScan = fitInstructions(prompt, 128_000, 1, 0.6, { current: "CP-1c-skan", owner });
    expect(atScan.text).toContain("s ".repeat(100_000).trim());
    expect(atScan.text).toMatch(/Moduł etapu CP-ATAK/u);
  });
});
