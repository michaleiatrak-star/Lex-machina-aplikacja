import { describe, expect, it } from "vitest";
import { executionMessage } from "./ChatApp.js";
import type { SessionExecutionResponse } from "./api.js";

const base = {
  status: "DRAFT_PRESENTABLE",
  answer: "Odpowiedź z powołaniem.",
  primarySkill: "prawo-polskie-v2",
  finalization: "PASS",
  blockedReferences: [],
  verification: { records: 1, verified: 1, supported: 0, unverified: 0 },
  evidence: [],
  audit: { result: "PASS", eventCount: 1, closed: true }
} as unknown as SessionExecutionResponse;

describe("czat ogólny: ramka weryfikacji sn.pl", () => {
  it("przenosi sourceVerification do wiadomości, gdy sn.pl zablokował konektor", () => {
    const msg = executionMessage(
      { ...base, sourceVerification: { source: "sn", url: "https://www.sn.pl/pl/wyszukiwarka-orzeczen" } },
      "prawo-polskie-v2"
    );
    expect(msg.sourceVerification).toEqual({ source: "sn", url: "https://www.sn.pl/pl/wyszukiwarka-orzeczen" });
  });

  it("bez blokady nie ma ramki weryfikacji", () => {
    expect(executionMessage(base, "prawo-polskie-v2").sourceVerification).toBeUndefined();
  });

  it("flaga działa też na odpowiedzi zatrzymanej przez bramkę (system)", () => {
    const blocked = executionMessage(
      {
        ...base,
        status: "BLOCKED",
        answer: "",
        verification: { records: 1, verified: 0, supported: 0, unverified: 1 },
        sourceVerification: { source: "sn", url: "https://www.sn.pl/pl/wyszukiwarka-orzeczen" }
      } as unknown as SessionExecutionResponse,
      "prawo-polskie-v2"
    );
    expect(blocked.role).toBe("system");
    expect(blocked.sourceVerification?.source).toBe("sn");
  });
});
