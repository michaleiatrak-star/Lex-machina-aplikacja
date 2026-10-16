import { describe, expect, it } from "vitest";
import { deterministicActionFromMeta, deterministicActionMeta } from "./chat-routing.js";
import { actionMetaMessage, switchAction, switchMessage } from "./skill-switch-offer.js";

describe("switch between the letter skills in a thread", () => {
  it("escalation goes to the process pleading action, reduction to the simple letter", () => {
    expect(switchAction({ from: "pisma-proste-v2", to: "pisma-procesowe-v3", direction: "ESCALATION", reason: null })).toBe("PROCESS_PLEADING");
    expect(switchAction({ from: "pisma-procesowe-v3", to: "pisma-proste-v2", direction: "REDUCTION", reason: null })).toBe("SIMPLE_LETTER");
    expect(switchMessage({ from: "pisma-proste-v2", to: "pisma-procesowe-v3", direction: "ESCALATION", reason: null })).toContain("pismo procesowe");
  });

  it("the thread's action comes from the last message that names one (a switch is not reverted)", () => {
    const messages = [
      { role: "system", content: "x" },
      { role: "user", content: "Sprzeciw", meta: deterministicActionMeta("SIMPLE_LETTER") },
      { role: "assistant", content: "ESKALACJA" },
      { role: "user", content: "Przełączam", meta: `${deterministicActionMeta("PROCESS_PLEADING")} | Przełączono na: Pismo procesowe` },
      { role: "user", content: "Kontynuuj.", meta: "Automatyczne przejście · krok" }
    ];
    expect(deterministicActionFromMeta(actionMetaMessage(messages)?.meta)).toBe("PROCESS_PLEADING");
    expect(deterministicActionFromMeta(actionMetaMessage(messages.slice(0, 3))?.meta)).toBe("SIMPLE_LETTER");
    expect(actionMetaMessage([{ role: "user", content: "a" }])?.content).toBe("a");
  });
});

describe("no letter file for questions or a switch offer", async () => {
  const { letterDocumentPlan } = await import("./MatterChatApp.js");
  const base = {
    status: "DRAFT_PRESENTABLE" as const,
    answer: "ESKALACJA DO pisma-procesowe-v3",
    workflow: { id: "SIMPLE_LETTER_V1", result: "PASS" as const, requiredResources: [], missingResources: [] },
    finalization: "PASS" as const,
    verification: { records: 0, verified: 0, supported: 0, unverified: 0 }
  };
  it("escalation offer and a checkpoint question make no .docx; a finished letter does", () => {
    expect(letterDocumentPlan({ ...base, skillSwitch: { from: "pisma-proste-v2", to: "pisma-procesowe-v3", direction: "ESCALATION", reason: null } } as never)).toBeNull();
    expect(letterDocumentPlan({ ...base, waitingForUser: true } as never)).toBeNull();
    expect(letterDocumentPlan({ ...base, answer: "Kraków, dnia 3 marca 2026 r.\nAdresat: Spółka Przykład sp. z o.o., ul. Polna 1, 00-001 Warszawa\nODPOWIEDŹ NA WEZWANIE DO ZAPŁATY\nW odpowiedzi na wezwanie z dnia 20 lutego 2026 r. oświadczam, że kwestionuję roszczenie w całości. Wezwanie nie wskazuje podstawy faktycznej ani sposobu wyliczenia kwoty, a dołączone dokumenty nie potwierdzają wykonania usługi w terminie. Wzywam do przedstawienia dokumentów, na których oparto żądanie, w terminie 14 dni.\nNiniejsze pismo nie stanowi uznania roszczenia.\nZ poważaniem\n[podpis]" } as never)).toEqual({ documentType: "letter", stage: "FINAL" });
    // Questions about missing data without the letter: no file.
    expect(letterDocumentPlan({ ...base, answer: "Brakuje danych:\n* adres nadawcy;\n* miejscowość." } as never)).toBeNull();
  });
});

describe("corrected pleading (MOD-REDAKCJA)", async () => {
  const { letterDocumentPlan, pleadingPipelineNeeded } = await import("./MatterChatApp.js");
  const redaction = {
    status: "DRAFT_PRESENTABLE" as const,
    answer: "RAPORT REDAKCJI\nSTATUS: POPRAWIONA WERSJA GOTOWA\n\nPOZEW O ZAPŁATĘ ...",
    taskSkill: "pisma-procesowe-v3",
    taskMode: "REDACTION" as const,
    finalization: "PASS" as const,
    verification: { records: 0, verified: 0, supported: 0, unverified: 0 }
  };
  it("the corrected text becomes a pleading file from the redaction, not an offer of the W1–W3 pipeline", () => {
    expect(letterDocumentPlan(redaction as never)).toEqual({ documentType: "pleading", stage: "FINAL", source: "REDACTION" });
    expect(letterDocumentPlan({ ...redaction, answer: redaction.answer + "\nSTATUS: WYMAGA DECYZJI co do sugestii" } as never)?.stage).toBe("DRAFT");
    expect(pleadingPipelineNeeded(redaction as never)).toBe(false);
    expect(pleadingPipelineNeeded({ ...redaction, taskMode: undefined } as never)).toBe(true);
  });
});

describe("contract file from the analizator-umow-v1 pipeline", async () => {
  const { letterDocumentPlan } = await import("./MatterChatApp.js");
  const turn = (closed: string[], next: string | null, mode = "DRAFT") => ({
    status: "DRAFT_PRESENTABLE" as const,
    answer: "UMOWA NAJMU LOKALU ...",
    finalization: "PASS" as const,
    verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
    contractWorkflow: { mode, closedCheckpoints: closed, nextCheckpoint: next }
  });
  it("the turn that closed AU-STRIP after AU-HYBRID makes the contract file; analysis and earlier turns do not", () => {
    expect(letterDocumentPlan(turn(["AU-HYBRID", "AU-STRIP"], "AU-POST") as never)).toEqual({ documentType: "contract", stage: "FINAL" });
    expect(letterDocumentPlan(turn(["AU-HYBRID"], "AU-STRIP") as never)).toBeNull();
    expect(letterDocumentPlan(turn(["AU-HYBRID", "AU-STRIP", "AU-POST"], "AU-DISC") as never)).toBeNull();
    expect(letterDocumentPlan(turn(["AU-HYBRID", "AU-STRIP"], "AU-POST", "ANALYSIS") as never)).toBeNull();
  });
});
