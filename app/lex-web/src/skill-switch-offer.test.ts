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
    expect(letterDocumentPlan(base as never)).toEqual({ documentType: "letter", stage: "FINAL" });
  });
});
