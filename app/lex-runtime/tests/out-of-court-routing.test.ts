import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyDocument } from "../src/document-kind.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

// Out-of-court documents (between the parties, of a company, RODO) go to analizator-umow-v1
// (ACTIVATION-MATRIX "analiza umowy", "Dokument + wezwanie"); court documents stay in the court
// pipeline; a request naming another skill keeps that skill.
const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const executor = new SafeSessionExecutor(registry, new ProviderGateway(new ProviderRegistry()));
const route = (question: string, text: string) => executor.executiveSkillsWithMaterials(question, [{ chunks: [{ text }] }]);

const OUT_OF_COURT: Record<string, string> = {
  UMOWA: "UMOWA NAJMU LOKALU\nzawarta w dniu 1 marca 2026 r. pomiędzy stronami.\n§ 1. Strony postanawiają, że Wynajmujący oddaje lokal.\n§ 7. Kara umowna 20 000 zł.",
  REGULAMIN: "REGULAMIN ŚWIADCZENIA USŁUG DROGĄ ELEKTRONICZNĄ\n§ 1. Usługodawca świadczy usługi.\n§ 5. Reklamacje rozpatrywane są w terminie 30 dni.",
  POROZUMIENIE: "POROZUMIENIE\nzawarte w dniu 3 grudnia 2024 r.\nStrony zgodnie postanawiają rozwiązać współpracę.\n6. Zakaz konkurencji. 9. Kara umowna 20 000 zł.",
  UGODA: "UGODA\nzawarta w dniu 5 maja 2026 r.\nStrony ustalają, że dłużnik zapłaci 10 000 zł w ratach.",
  WEZWANIE: "WEZWANIE DO ZAPRZESTANIA NARUSZEŃ WRAZ Z WEZWANIEM DO ZAPŁATY\nDziałając w imieniu Spółki wzywam Pana do zaprzestania naruszeń porozumienia i zapłaty 60 000 zł.",
  ANEKS: "ANEKS NR 2 DO UMOWY O WSPÓŁPRACY\nzawarty w dniu 10 czerwca 2026 r.\n§ 1. Strony postanawiają zmienić § 4 umowy.",
  STATUT: "STATUT FUNDACJI\n§ 1. Fundacja działa na podstawie ustawy o fundacjach.\n§ 5. Zarząd fundacji składa się z 3 osób.",
  UCHWALA: "UCHWAŁA NR 3/2026 ZGROMADZENIA WSPÓLNIKÓW\nSpółki z ograniczoną odpowiedzialnością\n§ 1. Wspólnicy postanawiają podwyższyć kapitał zakładowy.",
  POLITYKA: "POLITYKA PRYWATNOŚCI\nAdministratorem danych osobowych jest Spółka. Dane przetwarzamy na podstawie art. 6 ust. 1 lit. b RODO.",
  PELNOMOCNICTWO: "PEŁNOMOCNICTWO\nNiniejszym udzielam pełnomocnictwa do reprezentowania spółki.",
  OFERTA: "OFERTA HANDLOWA\nOferujemy dostawę 100 sztuk towaru za cenę 50 000 zł netto. Warunki płatności: 30 dni.",
  ODSTAPIENIE: "OŚWIADCZENIE O ODSTĄPIENIU OD UMOWY\nNiniejszym odstępuję od umowy sprzedaży zawartej w dniu 1 września 2026 r.",
  WYPOWIEDZENIE: "WYPOWIEDZENIE UMOWY\nNiniejszym wypowiadam umowę o świadczenie usług z zachowaniem 1-miesięcznego okresu wypowiedzenia."
};

describe("out-of-court documents to analizator-umow-v1", () => {
  it("recognises each kind as a document between the parties", () => {
    for (const [name, text] of Object.entries(OUT_OF_COURT)) {
      const kind = classifyDocument({ text });
      expect([name, kind.category === "UMOWA" || kind.kind === "WEZWANIE"]).toEqual([name, true]);
    }
    // A municipal council's resolution is local law, not a company document.
    expect(classifyDocument({ text: "UCHWAŁA NR XII/45/2026 RADY GMINY KOBYLNICA\nw sprawie miejscowego planu zagospodarowania przestrzennego" }).kind).not.toBe("UCHWALA_SPOLKI");
  });

  it("an analysis in any words goes to analizator-umow-v1", () => {
    const questions = [
      "Przeanalizuj ten dokument.", "Jakie są ryzyka w tym dokumencie?", "Czy mogę to podpisać?", "Czy ten dokument jest zgodny z prawem?",
      "Sprawdź ten dokument i wskaż niekorzystne zapisy.", "Co z tego wynika dla mnie?"
    ];
    for (const [name, text] of Object.entries(OUT_OF_COURT)) {
      for (const question of questions) expect([name, question, route(question, text)[0]]).toEqual([name, question, "analizator-umow-v1"]);
    }
  });

  it("a request naming another skill keeps it", () => {
    const { UMOWA, WEZWANIE } = OUT_OF_COURT;
    expect(route("Napisz wypowiedzenie tej umowy.", UMOWA!)).toEqual(["pisma-proste-v2"]);
    expect(route("Znajdź orzeczenia dotyczące kar umownych w tej umowie.", UMOWA!)[0]).toBe("orzeczenia-sadowe-v2");
    expect(route("Co mam zrobić?", UMOWA!)[0]).toBe("przewodnik-prawny-v2");
    expect(route("Jakie mam szanse w sądzie?", UMOWA!)[0]).toBe("analiza-sadowa-v6");
    expect(route("Czy to może być dowodem?", OUT_OF_COURT.STATUT!)[0]).toBe("analizator-dowodow-v3");
    expect(route("Wyjaśnij art. 484 § 2 KC.", WEZWANIE!)[0]).toBe("analizator-przepisow-v2");
    expect(route("Odpowiedz na ten dokument.", WEZWANIE!)).toEqual(["analizator-umow-v1", "pisma-proste-v2"]);
  });

  it("court documents stay in the court pipeline", () => {
    expect(route("Przeanalizuj ten dokument.", "POZEW O ZAPŁATĘ\nWartość przedmiotu sporu: 60 000 zł\nWnoszę o zasądzenie od pozwanego kwoty 60 000 zł.")[0]).toBe("analiza-sadowa-v6");
    expect(route("Przeanalizuj ten dokument.", "WYROK\nW IMIENIU RZECZYPOSPOLITEJ POLSKIEJ\nSygn. akt I C 1/26\nSąd oddala powództwo.")[0]).toBe("analiza-sadowa-v6");
  });
});
