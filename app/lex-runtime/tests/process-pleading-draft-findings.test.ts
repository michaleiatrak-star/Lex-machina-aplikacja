import { describe, expect, it } from "vitest";
import { checkpointFindingsPrompt, emptyProcessPleadingDraft, withCheckpointFinding } from "../src/process-pleading-draft.js";
import { PROCESS_PLEADING_CHECKPOINTS } from "../src/process-pleading-state.js";

const CASE = `case_${"a".repeat(32)}`;

describe("findings of the pipeline's gates, by stages", () => {
  it("a writing step keeps its report without the pleading and the disclaimer", () => {
    const draft = withCheckpointFinding(emptyProcessPleadingDraft(CASE), "CP-ATAK", "W2", "Raport D: słabe punkty P1, P2.\n=== PISMO ===\nPozew.\n=== KONIEC PISMA ===\nRejestr.\n\n---\n⚖️ Zastrzeżenie: …");
    expect(draft.findings?.["CP-ATAK"]?.text).toBe("Raport D: słabe punkty P1, P2.\n\nRejestr.");
  });
  it("the prompt holds only earlier steps, shortened for a small window", () => {
    let draft = emptyProcessPleadingDraft(CASE);
    draft = withCheckpointFinding(draft, "CP-1c-macierz", "W1", `MACIERZ ${"x".repeat(5_000)}`);
    draft = withCheckpointFinding(draft, "CP-PEER", "W3", "później");
    const local = checkpointFindingsPrompt(draft.findings, PROCESS_PLEADING_CHECKPOINTS, "CP-W1", 1_000)!;
    expect(local).toContain("## CP-1c-macierz (etap W1)");
    expect(local).toContain("[… skrócono:");
    expect(local).not.toContain("później");
    expect(checkpointFindingsPrompt(draft.findings, PROCESS_PLEADING_CHECKPOINTS, "CP-1a", 1_000)).toBeNull();
  });
});
