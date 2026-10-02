import { describe, expect, it } from "vitest";
import { blockedReasonText } from "./MatterChatApp.js";

describe("przyczyna blokady odpowiedzi", () => {
  it("wymienia stan, naruszenia i zdarzenia BLOCKED", () => {
    const text = blockedReasonText({
      status: "BLOCKED",
      finalization: "PASS",
      audit: {
        result: "BLOCKED",
        eventCount: 9,
        closed: true,
        violations: ["blocked_event_present"],
        blockedEvents: ["gate: G36_LEGAL_CORPUS_RUNTIME", "resource_read: dr-01:references/x.md — LEGAL_RESOURCE_NOT_FOUND"]
      },
      workflow: { id: "LEGAL_QUERY_V1", result: "PASS", requiredResources: [], missingResources: [] }
    } as never);
    expect(text).toContain("status=BLOCKED; finalization=PASS; audit=BLOCKED; answer=missing; workflow=LEGAL_QUERY_V1:PASS");
    expect(text).toContain("audit.violations: blocked_event_present");
    expect(text).toContain("blokada: resource_read: dr-01:references/x.md — LEGAL_RESOURCE_NOT_FOUND");
  });
});
