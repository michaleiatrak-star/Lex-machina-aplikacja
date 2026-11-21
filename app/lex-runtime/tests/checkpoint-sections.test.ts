import { describe, expect, it } from "vitest";
import { checkpointSections } from "../src/process-checkpoint-contract.js";

const answer = [
  "## [CP-1a] Walidacja twierdzeń",
  "Treść CP-1a. ✅ CHECKPOINT [CP-1a] — ZAMKNIĘTY",
  "",
  "## [CP-1b] Wybór strategii",
  "Treść CP-1b, odwołanie do [CP-1a] w tekście.",
  "✅ CHECKPOINT [CP-1b] — ZAMKNIĘTY",
  "## [CP-1c-skan] Skan",
  "Treść skanu."
].join("\n");

describe("one AUTO answer with several W1 checkpoints, each closed from its own section", () => {
  it("sections by the checkpoints' headings, in order", () => {
    const sections = checkpointSections(answer, ["CP-1a", "CP-1b", "CP-1c-skan"]);
    expect([...sections.keys()]).toEqual(["CP-1a", "CP-1b", "CP-1c-skan"]);
    expect(sections.get("CP-1a")).toContain("Treść CP-1a");
    expect(sections.get("CP-1a")).not.toContain("Wybór strategii");
    expect(sections.get("CP-1b")).toMatch(/^## \[CP-1b\]/u);
    expect(sections.get("CP-1c-skan")).toContain("Treść skanu.");
  });

  it("a checkpoint the answer did not reach has no section", () => {
    const sections = checkpointSections(answer.split("## [CP-1c-skan]")[0]!, ["CP-1a", "CP-1b", "CP-1c-skan"]);
    expect(sections.has("CP-1c-skan")).toBe(false);
    expect(sections.size).toBe(2);
  });
});

import { aheadSectionVerdict } from "../src/process-checkpoint-contract.js";

describe("a checkpoint closed from a shared answer must show it was done and closed", () => {
  it("report with a closing status: closed", () => {
    expect(aheadSectionVerdict("CP-1b", "## [CP-1b] Wybór strategii\nŚcieżki A–C.\n✅ CHECKPOINT [CP-1b] — ZAMKNIĘTY").closed).toBe(true);
  });
  it("no closing status, or an open one: runs as its own turn", () => {
    expect(aheadSectionVerdict("CP-1b", "## [CP-1b] Wybór strategii\nŚcieżki A–C.").missing).toContain("STATUS_ZAMKNIECIA_CP-1b");
    expect(aheadSectionVerdict("CP-1b", "## [CP-1b] Wybór strategii\n✅ CHECKPOINT [CP-1b] — ZAMKNIĘTY\n[CP-1b] ○ OCZEKUJE na decyzję").closed).toBe(false);
  });
});

describe("testimony in the files: SW-INW in CP-1a, SW-TARCZKA in CP-ATAK (SKILL.md W1.2c-SW, W2.4c)", () => {
  it("detects the witness case from the hearing records", async () => {
    const { witnessTestimonyCase } = await import("../src/process-checkpoint-contract.js");
    const record = "PROTOKÓŁ ROZPRAWY\nŚwiadek zeznaje: ...";
    expect(witnessTestimonyCase(`${record}\n\n---\n\n${record}`, "Przygotuj pismo")).toBe(true);
    expect(witnessTestimonyCase(record, "Przygotuj pismo o sprzecznościach w zeznaniach")).toBe(true);
    expect(witnessTestimonyCase(record, "Przygotuj pismo")).toBe(false);
    expect(witnessTestimonyCase("Umowa najmu", "Przygotuj pismo")).toBe(false);
  });
  it("requires the table and the defence, a reasoned N/A counts", async () => {
    const { evaluateCheckpointOutput } = await import("../src/process-checkpoint-contract.js");
    const facts = { witnessTestimony: true };
    expect(evaluateCheckpointOutput("CP-1a", "## [CP-1a]\nraport", facts).missing.some((item) => item.startsWith("W1.2c-SW"))).toBe(true);
    expect(evaluateCheckpointOutput("CP-1a", "## [CP-1a]\nSW-INW: tabela", facts).missing.some((item) => item.startsWith("W1.2c-SW"))).toBe(false);
    expect(evaluateCheckpointOutput("CP-ATAK", "RAPORT D\nSW-TARCZKA: nie dotyczy — brak naszego świadka", facts).missing.some((item) => item.startsWith("W2.4c"))).toBe(false);
    expect(evaluateCheckpointOutput("CP-ATAK", "RAPORT D", facts).missing.some((item) => item.startsWith("W2.4c"))).toBe(true);
    expect(evaluateCheckpointOutput("CP-1a", "## [CP-1a]\nraport").missing.some((item) => item.startsWith("W1.2c-SW"))).toBe(false);
  });
});

describe("analiza-sadowa-v6: each checkpoint's message holds its pass", () => {
  it("names what is missing, nothing for a complete message or the final report", async () => {
    const { courtCheckpointGaps } = await import("../src/process-checkpoint-contract.js");
    expect(courtCheckpointGaps("PASS_II_SOURCES_VERIFIED", "Kwalifikacja bez tabeli")).toHaveLength(1);
    expect(courtCheckpointGaps("PASS_II_SOURCES_VERIFIED", "MACIERZ FAKT-NORMA\n| F-01 | art. 52 KP |")).toEqual([]);
    expect(courtCheckpointGaps("FINAL_GATE_APPROVED", "GATE: ZATWIERDZONE TAK")).toEqual([]);
    expect(courtCheckpointGaps("FINAL_VERIFICATION_COMPLETE", "P1 ✓ | P5 ✓")).toHaveLength(1);
    expect(courtCheckpointGaps("FINAL_REPORT_PRESENTED", "cokolwiek")).toEqual([]);
  });
});
