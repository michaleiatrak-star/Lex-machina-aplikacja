import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { replyChoices } from "./reply-choices";
import { ReplyChoices } from "./ReplyChoices";

const START = [
  "┌──────────────────────────────────────────────┐",
  "│ ⚠️ INFORMACJA PRZED STARTEM — PISMA PROCESOWE v3 │",
  "│ Czy akceptujesz powyższe warunki i chcesz kontynuować? │",
  "│  a) Tak, akceptuję — wczytaj checklistę i rozpocznij │",
  "│  b) Nie — zakończ lub wyjaśnij wątpliwości  │",
  "└──────────────────────────────────────────────┘",
  "Odpowiedź „a” zamyka obie bramki tej tury."
].join("\n");

const CHECKPOINT = [
  "│ STATUS: ⚠️ DRAFT — NIE SKŁADAĆ                            │",
  "│ ➡️ Zatwierdzasz strukturę i przejście do [CP-FSL-D]?        │",
  '│    "tak" / modyfikuj / porzuć ścieżkę X                    │',
  "└─────────────────────────────────────────────────────────────┘"
].join("\n");

describe("wybory z odpowiedzi jako przyciski", () => {
  it("opcje a) / b) w ramce: przyciski z pełną treścią opcji", () => {
    expect(replyChoices(START)).toEqual([
      { kind: "SEND", label: "a) Tak, akceptuję — wczytaj checklistę i rozpocznij", message: "a) Tak, akceptuję — wczytaj checklistę i rozpocznij" },
      { kind: "SEND", label: "b) Nie — zakończ lub wyjaśnij wątpliwości", message: "b) Nie — zakończ lub wyjaśnij wątpliwości" }
    ]);
  });

  it("ramka checkpointu: „Tak” wysyła, modyfikacja tylko wstawia początek odpowiedzi", () => {
    expect(replyChoices(CHECKPOINT)).toEqual([
      { kind: "SEND", label: "Tak", message: "tak" },
      { kind: "DRAFT", label: "Modyfikuj / porzuć ścieżkę…", draft: "Modyfikuj: " }
    ]);
    expect(replyChoices('➡️ Kontynuować do CP-1b?\n   Odpowiedz: "tak" / "ok" / lub uwagi')[1]).toMatchObject({ kind: "DRAFT", label: "Uwagi…" });
  });

  it("cztery opcje FSL-D (a–d) i brak przycisków bez pytania", () => {
    expect(replyChoices("Decyzja:\na) uzupełnij dokumenty\nb) pomiń wątek\nc) pismo bez tego faktu\nd) wstrzymaj").map((c) => c.label[0])).toEqual(["a", "b", "c", "d"]);
    expect(replyChoices("Wniosek jest gotowy. Załączniki: a) umowa.")).toEqual([]);
    expect(replyChoices("Punkty: a) pierwszy\nc) trzeci")).toEqual([]);
  });

  it("renderuje przyciski; pierwszy wyróżniony", () => {
    const html = renderToStaticMarkup(<ReplyChoices answer={START} disabled={false} onSend={() => undefined} onDraft={() => undefined} />);
    expect(html).toContain("a) Tak, akceptuję");
    expect(html).toContain("primary-button");
    expect(renderToStaticMarkup(<ReplyChoices answer="Brak pytań." disabled={false} onSend={() => undefined} onDraft={() => undefined} />)).toBe("");
  });

  it("ramka z pytaniem bez dosłownego „tak” (model: „➡️ Zatwierdzasz układ…?”) i opcje wielką literą", () => {
    const frame = "│ ✅ CHECKPOINT [CP-1b] MOD-STRATEGIA-WYBOR — ZAKOŃCZONY │\n│ ➡️ Zatwierdzasz układ z S4 i odpowiesz na pytania 1–3? │\n└──────┘";
    expect(replyChoices(frame).map((c) => c.label)).toEqual(["Tak", "Uwagi…"]);
    expect(replyChoices("A) Tak, akceptuję\nB) Nie — zakończ").map((c) => c.label)).toEqual(["a) Tak, akceptuję", "b) Nie — zakończ"]);
  });
});
