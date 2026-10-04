import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKPOINT_RESOURCES, evaluateCheckpointOutput } from "../src/process-checkpoint-contract.js";
import { PROCESS_PLEADING_CHECKPOINTS, createProcessPleadingState, acceptProcessPleadingStart } from "../src/process-pleading-state.js";
import { completeProcessExecution, processCheckpointRegister, requireProcessExecutionPermit } from "../src/process-pleading-execution-gate.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

describe("pisma-procesowe-v3 checkpoint contract", () => {
  it("covers every checkpoint of CP-REJESTR with existing files", () => {
    const register = fs.readFileSync(path.join(CORPUS, "shared/CP-GATE.md"), "utf8");
    const ids = [...new Set([...register.matchAll(/^\s*\[(CP-[A-Za-z0-9-]+)\]/gm)].map((match) => match[1]))];
    expect([...ids].sort()).toEqual([...PROCESS_PLEADING_CHECKPOINTS].sort());
    for (const checkpoint of PROCESS_PLEADING_CHECKPOINTS) {
      expect(CHECKPOINT_RESOURCES[checkpoint].length).toBeGreaterThan(0);
      for (const resource of CHECKPOINT_RESOURCES[checkpoint]) expect(fs.existsSync(path.join(CORPUS, resource))).toBe(true);
    }
  });

  it("requires the checkpoint report, by id or by its CP-REJESTR name", () => {
    expect(evaluateCheckpointOutput("CP-1a", "Analiza twierdzeń.").missing).toEqual(["RAPORT_CP-1a"]);
    expect(evaluateCheckpointOutput("CP-1a", "✅ CHECKPOINT CLAIM-VALIDATION — ZAKOŃCZONY").result).toBe("PASS");
  });

  it("N/A only for a conditional checkpoint", () => {
    expect(evaluateCheckpointOutput("CP-1c-macierz", "[CP-1c-macierz] N/A — dostarczono jeden dokument").notApplicable).toMatch(/jeden dokument/);
    expect(evaluateCheckpointOutput("CP-W1", "[CP-W1] N/A").missing).toContain("CP-W1_NA_NIEDOZWOLONE");
  });

  it("PRE-W2 status, W2 isolation and RAPORT D, ST-FINAL", () => {
    expect(evaluateCheckpointOutput("CP-PRE-W2", "[CP-PRE-W2] zakończony").missing).toContain("PRE-W2_STATUS_BRAMKI");
    expect(evaluateCheckpointOutput("CP-PRE-W2", "[CP-PRE-W2] GATE-STOP").missing).toContain("PRE-W2_GATE-STOP_DECYZJA_UZYTKOWNIKA");
    const w2 = evaluateCheckpointOutput("CP-ATAK", "[CP-ATAK] RAPORT D\nart. 471 KC (Dz. U. 2024 poz. 1061); wyrok SN z 1.01.2020, sygn. II CSK 123/19");
    expect(w2.missing).toEqual(["W2_IZOLACJA_DZ.U.", "W2_IZOLACJA_SYGNATURA_ORZECZENIA"]);
    const peer = evaluateCheckpointOutput("CP-PEER", "[CP-PEER]\nSTATUS PISMA: ✅ FINAL — GOTOWE\nREJESTR KROKÓW\n[CP-1d] ⚠️ POMINIĘTY");
    expect(peer.missing).toEqual(["ST-FINAL_STATUS_DRAFT_PRZY_POMINIETYCH", "ST-FINAL_INFORMACJA_WARUNKOWA"]);
  });

  it("records an N/A with its reason and exposes it in the register", () => {
    let state = acceptProcessPleadingStart(createProcessPleadingState(`case_${"a".repeat(32)}`, "AUTO"));
    for (;;) {
      const permit = requireProcessExecutionPermit(state);
      if (permit.checkpoint === "CP-1b") {
        state = completeProcessExecution(state, permit, "[CP-1b] N/A — jedna ścieżka procesowa");
        break;
      }
      state = completeProcessExecution(state, permit);
    }
    expect(processCheckpointRegister(state).find((entry) => entry.checkpoint === "CP-1b")).toMatchObject({ status: "NA", reason: expect.stringMatching(/jedna ścieżka/) });
  });
});
