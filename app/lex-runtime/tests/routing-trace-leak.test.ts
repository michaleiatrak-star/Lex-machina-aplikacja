import { describe, expect, it } from "vitest";
import { withoutModelRoutingTrace } from "../src/routing-trace-leak.js";

const disclaimer = "⚖️ Ważna informacja: Niniejsza analiza ma charakter wyłącznie informacyjny.";

describe("the model's KROK 3A trace in the answer", () => {
  it("is removed with the blueprint line after it (live C09-058)", () => {
    const text = [
      "Brakuje wartości mieszkania względem salda kredytu 300 000 zł.",
      "",
      "TRYB: LAIK",
      "PRIMARY: raport-sytuacyjny-v2 (tryb [C] — na żądanie) — ROUTER-WCZYTANY: TAK",
      "SECONDARY: dr-02-prawo-cywilne-rodzinne-gospodarcze — ROUTER-WCZYTANY: TAK (kontynuacja)",
      "ODRZUCONE: brak — żądanie jednoznaczne",
      "PROFIL: LEKKI — rdzeń R-1…R-5: TAK",
      "ODROCZONE: BRAK",
      "WERSJA ROUTERA: 3.74",
      "",
      "BLUEPRINT: przesłany i zweryfikowany przez runtime (submit_report_blueprint) — status PASS.",
      "",
      disclaimer
    ].join("\n");
    expect(withoutModelRoutingTrace(text)).toBe(["Brakuje wartości mieszkania względem salda kredytu 300 000 zł.", "", disclaimer].join("\n"));
  });

  it("is removed when written as a bold list under a heading", () => {
    const text = ["Odpowiedź.", "", "**KROK 3A**", "- **TRYB:** PRAWNIK", "- **PRIMARY:** dr-05 — ROUTER-WCZYTANY: TAK", "- **SECONDARY:** BRAK", "", disclaimer].join("\n");
    expect(withoutModelRoutingTrace(text)).toBe(["Odpowiedź.", "", disclaimer].join("\n"));
  });

  it("keeps a letter's own field lines and a lone mode line", () => {
    const letter = ["Tryb: zwykły", "Sprawa: zapłata", "Wartość przedmiotu sporu: 12 000 zł", "", "TRYB: LAIK oznacza prosty język."].join("\n");
    expect(withoutModelRoutingTrace(letter)).toBe(letter);
    const fields = ["TRYB: pilny", "PROFIL: firma", "ODROCZONE: nie"].join("\n");
    expect(withoutModelRoutingTrace(fields)).toBe(fields);
  });
});

describe("a single developer line in the answer", () => {
  it("the router version and resolver line is removed (user report 2026-11-06)", () => {
    const text = ["Sprawdza, czy odpowiedź prowadzi do konkretnego rozwiązania.", "", "• **WERSJA ROUTERA i RESOLVER:** wynik aplikacji, nie podano ich w tej turze", "", "Nie powołałem żadnych przepisów."].join("\n");
    expect(withoutModelRoutingTrace(text)).toBe(["Sprawdza, czy odpowiedź prowadzi do konkretnego rozwiązania.", "", "Nie powołałem żadnych przepisów."].join("\n"));
  });

  it("a sentence that only mentions a resolver keeps its line", () => {
    const text = "Resolver DNS w umowie: dostawca odpowiada za jego dostępność.";
    expect(withoutModelRoutingTrace(text)).toBe(text);
  });
});
