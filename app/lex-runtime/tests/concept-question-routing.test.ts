import path from "node:path";
import { describe, expect, it } from "vitest";
import { TurnRouter } from "../src/routing-benchmark.js";

// User 2026-11-27: a question about the law, a provision or the difference between legal notions goes
// to the statute skill. Before: letters (pisma-proste-v2), contract review (analizator-umow-v1), no
// skill, and two questions taken as small talk.
const router = new TurnRouter(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));

describe("questions explaining legal notions and their differences", () => {
  it.each([
    "Jaka jest różnica między rozwiązaniem umowy a odstąpieniem od umowy?",
    "Czym się różni zadatek od zaliczki?",
    "Wyjaśnij różnicę między przedawnieniem a prekluzją",
    "Czym różni się umowa o dzieło od umowy zlecenia?",
    "Różnica między nieważnością a bezskutecznością czynności prawnej",
    "Jaka jest różnica między karą umowną a odszkodowaniem?",
    "Objaśnij różnicę między rękojmią a gwarancją",
    "Czym różni się wypowiedzenie zmieniające od porozumienia zmieniającego?",
    "Porównaj spółkę z o.o. i spółkę komandytową pod kątem odpowiedzialności wspólników",
    "Na czym polega różnica między art. 415 a art. 471 KC?",
    "Czym się różni najem od dzierżawy?",
    "Jaka jest różnica między pełnomocnictwem a prokurą?",
    "Czym się różni separacja od rozwodu?",
    "Różnica między umową przedwstępną a umową przyrzeczoną"
  ])("%s", (question) => {
    const routed = router.route(question);
    expect(routed.legal).toBe(true);
    expect(routed.executive).toBe("analizator-przepisow-v2");
  });

  it("one notion explained follows the corpus: a bare \"co to znaczy\" to the guide, \"wyjaśnij\" and \"co oznacza pojęcie\" to the statute skill", () => {
    expect(router.route("Co to znaczy przedawnienie?").executive).toBe("przewodnik-prawny-v2");
    for (const question of ["Wyjaśnij, co to jest przedawnienie roszczeń", "Co oznacza pojęcie siły wyższej w prawie polskim?"]) {
      const routed = router.route(question);
      expect(routed.legal, question).toBe(true);
      expect(routed.executive, question).toBe("analizator-przepisow-v2");
    }
  });

  it("one's own matter and a request to draft keep their path", () => {
    expect(router.route("Napisz odstąpienie od umowy zakupu przez internet").executive).toBe("pisma-proste-v2");
    expect(router.route("Czym różni się moja umowa od wzoru, który dostałem?").executive).not.toBe("analizator-przepisow-v2");
  });

  it("non-legal comparisons stay conversations", () => {
    for (const question of ["Czym się różni latte od cappuccino?", "Jaka jest różnica między Pythonem a JavaScriptem?"]) expect(router.route(question).legal).toBe(false);
  });
});
