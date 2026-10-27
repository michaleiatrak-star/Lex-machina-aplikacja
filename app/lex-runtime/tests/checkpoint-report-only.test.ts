import { describe, expect, it } from "vitest";
import { reportOnly } from "../src/session-executor.js";

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
});
