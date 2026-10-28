import { describe, expect, it } from "vitest";
import { frameHeld, reportOnly } from "../src/session-executor.js";

const frame = (status: string, prompt: string) =>
  ["```", "┌──────┐", `│ ✅ CHECKPOINT [CP-1b] MOD-STRATEGIA-WYBOR — ${status} │`, "│ REJESTR CP: ✅ CP-1a │", `│ ➡️ ${prompt} │`, "└──────┘", "```"].join("\n");

describe("checkpoint report waiting for the user", () => {
  it("treats the done frame's own prompt as the confirmation", () => {
    expect(reportOnly(`Analiza.\n\n${frame("ZAMKNIĘTY", "Zgadzasz się na nową kolejność? Wgraj umowę.")}\n\n[CZEKAM NA ODPOWIEDŹ]`, "CP-1b")).toBe(true);
    expect(reportOnly(`Analiza.\n\n${frame("ZAKOŃCZONY", "Zatwierdzasz układ z S4?")}\n\n[CZEKAM NA ODPOWIEDŹ]`, "CP-1b")).toBe(true);
  });

  it("keeps the step open for a request after the frame or a frame that is not done", () => {
    expect(reportOnly(`${frame("ZAMKNIĘTY", "Dalej?")}\n\nPodaj datę spłaty.\n\n[CZEKAM NA ODPOWIEDŹ]`, "CP-1b")).toBe(false);
    expect(reportOnly(`${frame("W TOKU", "Która ścieżka?")}\n\n[CZEKAM NA ODPOWIEDŹ]`, "CP-1b")).toBe(false);
    expect(reportOnly(`${frame("POPRAWIONY", "Odpowiedz na pytania 1–3; potem CP-1c-skan")}\n\n[CZEKAM NA ODPOWIEDŹ]`, "CP-1b")).toBe(false);
    expect(reportOnly(`${frame("ZAKOŃCZONY", "Zatwierdzasz układ i odpowiesz na pytania 1–3?")}\n\n[CZEKAM NA ODPOWIEDŹ]`, "CP-1b")).toBe(false);
    expect(reportOnly(`${frame("ZAKOŃCZONY", "Dalej (czeka na odpowiedź na 3 pytania)")}\n\n[CZEKAM NA ODPOWIEDŹ]`, "CP-1b")).toBe(false);
    const held = "```\n│ ⛔ CHECKPOINT [CP-1c-skan] — WSTRZYMANY (SD-GATE-0) │\n│ ▶ bieżący: CP-1c-skan (czeka na pliki) │\n└──┘\n```\n\n[CZEKAM NA ODPOWIEDŹ]";
    expect(reportOnly(held, "CP-1c-skan")).toBe(false);
    expect(reportOnly("[CP-1b] Brak danych.\nPodaj datę spłaty.\n\n[CZEKAM NA ODPOWIEDŹ]", "CP-1b")).toBe(false);
  });

  it("a held frame keeps the step open without the marker", () => {
    expect(frameHeld("a) dokumenty\nb) bez\n```\n│ ⏸ CHECKPOINT [CP-1c-lancuch] — OTWARTY (czeka na decyzję)│\n└─┘\n```", "CP-1c-lancuch")).toBe(true);
    expect(frameHeld("│ ⛔ CHECKPOINT [CP-1c-skan] — WSTRZYMANY (SD-GATE-0) │", "CP-1c-skan")).toBe(true);
    expect(frameHeld(frame("ZAKOŃCZONY", "Dalej?"), "CP-1b")).toBe(false);
    expect(frameHeld("│ ✅ CHECKPOINT [CP-1c-skan] — ZAMKNIĘTY JAKO N/A │", "CP-1c-skan")).toBe(false);
    expect(frameHeld(frame("W TOKU", "?"), "CP-1a")).toBe(false);
  });

  it("finds the frame header, not a later mention of the checkpoint inside the frame", () => {
    const answer = [
      "```",
      "│ ✅ CHECKPOINT [CP-1d-anomalie] — ZAMKNIĘTY JAKO N/A │",
      "│ Wyniki: [CP-1d-anomalie] N/A — warunek = NIE │",
      "│ ➡️ Kontynuować do [CP-1d]? Odpowiedz: „tak” / „ok” / lub uwagi │",
      "└──┘",
      "```",
      "",
      "[CZEKAM NA ODPOWIEDŹ]"
    ].join("\n");
    expect(reportOnly(answer, "CP-1d-anomalie")).toBe(true);
  });

  it("reads a frame header wrapped onto the next line", () => {
    const answer = [
      "```",
      "│ ✅ CHECKPOINT [CP-PRE-W2] — PRE-W2-VERIFICATION-GATE —   │",
      "│    ZAKOŃCZONY                                            │",
      "│ Wykonane: PRE-W2.A–E │",
      "│ WYNIK BRAMKI: ⚠️ GATE-WARN │",
      "│ ➡️ Kontynuować do W2? Odpowiedz „tak”. Jeśli możesz, podaj też kwotę. │",
      "└──┘",
      "```",
      "",
      "[CZEKAM NA ODPOWIEDŹ]"
    ].join("\n");
    expect(reportOnly(answer, "CP-PRE-W2")).toBe(true);
    expect(frameHeld(answer, "CP-PRE-W2")).toBe(false);
    expect(frameHeld("│ ⏸ CHECKPOINT [CP-W1] — RAMA W1 —   │\n│ OTWARTY │\n│ Wykonane: x │", "CP-W1")).toBe(true);
  });
});
