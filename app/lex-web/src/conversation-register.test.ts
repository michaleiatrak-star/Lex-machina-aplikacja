import { describe, expect, it } from "vitest";
import type { CaseChatMessage } from "./case-thread.js";
import { conversationForProvider } from "./conversation-context.js";

// Wersja 0.1.27: pytany "co zawiodło", model zgadywał ("prawdopodobnie"), bo historia nie
// mówiła, że odpowiedź z wyrokiem nie miała żadnego zapisu weryfikacji.
const path = { profile: "LEKKI" } as unknown as CaseChatMessage["mandatoryPath"];

describe("history carries the application's register of each answer", () => {
  it("says an answer had no verification records", () => {
    const messages: CaseChatMessage[] = [
      { id: "u1", role: "user", content: "ok, robisz to." },
      { id: "a1", role: "assistant", content: "Znalazłem polskie orzeczenie: sygn. II SAB/Po 175/26.", mandatoryPath: path }
    ];
    expect(conversationForProvider(messages, "Co zawiodło?", 100_000)).toContain(
      "Asystent: Znalazłem polskie orzeczenie: sygn. II SAB/Po 175/26.\n[Rejestr aplikacji dla tej odpowiedzi: brak zapisów weryfikacji i źródeł pomocniczych]"
    );
  });

  it("lists verified records and auxiliary sources", () => {
    const messages: CaseChatMessage[] = [
      { id: "u1", role: "user", content: "Wyszukaj uchwałę SN o neosędziach" },
      {
        id: "a1",
        role: "assistant",
        content: "Uchwała SN, sygn. I KZP 3/24.",
        evidence: [{ claim: "uchwała SN, sygn. I KZP 3/24", kind: "case", status: "VERIFIED", sourceTier: "R1", fetchedAt: "2026-10-13T10:00:00Z" }],
        auxiliarySources: [{ sourceUrl: "https://example.org/a", sourceTier: "R3" } as never]
      }
    ];
    expect(conversationForProvider(messages, "Dalej", 100_000)).toContain(
      "[Rejestr aplikacji dla tej odpowiedzi: VERIFIED uchwała SN, sygn. I KZP 3/24 (R1); pomocnicze R3 https://example.org/a]"
    );
  });

  it("adds nothing to a non-legal or legacy answer", () => {
    const messages: CaseChatMessage[] = [{ id: "a1", role: "assistant", content: "Dzień dobry." }];
    expect(conversationForProvider(messages, "Hej", 100_000)).not.toContain("Rejestr aplikacji");
  });
});
