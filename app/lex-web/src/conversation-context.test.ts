import {
  describe,
  expect,
  it
} from "vitest";
import {
  LOCAL_CONVERSATION_CHARS,
  conversationBudgetChars,
  conversationForProvider
} from "./conversation-context.js";
import type {
  CaseChatMessage
} from "./case-thread.js";

describe(
  "continued chat context",
  () => {
    it(
      "keeps earlier turns so the next message continues the same chat",
      () => {
        const messages:
          CaseChatMessage[] = [
            {
              id: "m1",
              role: "user",
              content:
                "Pierwsza wiadomość"
            },
            {
              id: "m2",
              role: "assistant",
              content:
                "Pierwsza odpowiedź"
            },
            {
              id: "m3",
              role: "user",
              content:
                "Druga wiadomość"
            },
            {
              id: "m4",
              role: "assistant",
              content:
                "Druga odpowiedź"
            }
          ];

        const context =
          conversationForProvider(
            messages,
            "Kontynuuj"
          );

        expect(context).toContain(
          "Użytkownik: Pierwsza wiadomość"
        );
        expect(context).toContain(
          "Asystent: Pierwsza odpowiedź"
        );
        expect(context).toContain(
          "Użytkownik: Druga wiadomość"
        );
        expect(context).toContain(
          "Asystent: Druga odpowiedź"
        );
        expect(context).toMatch(
          /Użytkownik: Kontynuuj$/
        );
      }
    );

    it(
      "keeps the newest context inside the runtime query budget",
      () => {
        const old =
          "STARY_".repeat(
            6_000
          );
        const messages:
          CaseChatMessage[] = [
            {
              id: "m1",
              role: "user",
              content: old
            },
            {
              id: "m2",
              role: "assistant",
              content:
                "NAJNOWSZA_ODPOWIEDZ"
            }
          ];

        const context =
          conversationForProvider(
            messages,
            "NAJNOWSZE_PYTANIE"
          );

        expect(
          context.length
        ).toBeLessThanOrEqual(
          28_000
        );
        expect(context).toContain(
          "NAJNOWSZA_ODPOWIEDZ"
        );
        expect(context).toMatch(
          /Użytkownik: NAJNOWSZE_PYTANIE$/
        );
      }
    );

    it("sizes the history to the model window; local models keep the small budget", () => {
      expect(conversationBudgetChars("anthropic", "claude-x")).toBe(300_000);
      expect(conversationBudgetChars("openai", "account/openai/default")).toBe(150_000);
      expect(conversationBudgetChars("openai", "local/bielik")).toBe(LOCAL_CONVERSATION_CHARS);
      expect(conversationBudgetChars("local", "mistral")).toBe(LOCAL_CONVERSATION_CHARS);
    });

    it("drops whole older turns with a note instead of cutting a message", () => {
      const messages: CaseChatMessage[] = Array.from({ length: 30 }, (_, index) => ({
        id: `m${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `WIADOMOSC_${index}_` + "x".repeat(9_000)
      }));

      const long = conversationForProvider(messages, "PYTANIE", 300_000);
      expect(long).toContain("WIADOMOSC_0_");
      expect(long).not.toContain("pominięta");

      const short = conversationForProvider(messages, "PYTANIE", 100_000);
      expect(short.length).toBeLessThanOrEqual(100_000);
      expect(short).toMatch(/^\[Wcześniejsza część rozmowy pominięta \(\d+ wiadomości\)/);
      expect(short).toContain("WIADOMOSC_29_");
      expect(short).toMatch(/Użytkownik: PYTANIE$/);
      // Every kept turn is whole.
      for (const part of short.split("\n\n").slice(1, -1)) {
        expect(part).toMatch(/^(Użytkownik|Asystent): WIADOMOSC_\d+_x{9000}$/);
      }
    });
  }
);
