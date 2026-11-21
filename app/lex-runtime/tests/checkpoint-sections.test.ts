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
