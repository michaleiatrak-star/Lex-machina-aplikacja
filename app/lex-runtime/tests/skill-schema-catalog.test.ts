import path from "node:path";
import { describe, expect, it } from "vitest";
import { LexSkillRegistry } from "../src/registry.js";
import { schemaCatalog } from "../src/skill-module-map.js";
import { draftingSchema } from "../src/skill-schema-catalog.js";

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const entries = schemaCatalog(registry, "pisma-proste-v2");
const code = (text: string) => draftingSchema(entries, text)?.code ?? null;

describe("SPN: wypowiedzenie umowy", () => {
  it("the notice of termination, in any form of the verb", () => {
    expect(code("Napisz wypowiedzenie tej umowy najmu.")).toBe("SPN");
    expect(code("Chcę wypowiedzieć najem mieszkania.")).toBe("SPN");
    expect(code("Wypowiedz umowę dzierżawy gruntu.")).toBe("SPN");
    expect(code("Napisz wypowiedzenie umowy o świadczenie usług księgowych.")).toBe("SPN");
  });

  it("other contracts: agency, loan, bank account, insurance, licence, partnership, energy, telecom, cooperation", () => {
    for (const text of [
      "Napisz wypowiedzenie umowy agencyjnej.",
      "Wypowiedz umowę pożyczki, termin zwrotu nie był ustalony.",
      "Napisz wypowiedzenie umowy rachunku bankowego.",
      "Wypowiedz umowę ubezpieczenia na życie.",
      "Przygotuj wypowiedzenie umowy licencyjnej.",
      "Napisz wypowiedzenie udziału w spółce cywilnej.",
      "Przygotuj wypowiedzenie umowy sprzedaży energii elektrycznej.",
      "Wypowiedz abonament telefoniczny.",
      "Przygotuj wypowiedzenie umowy o współpracy B2B."
    ]) expect(code(text), text).toBe("SPN");
    expect(code("Napisz umowę o świadczenie usług.")).toBeNull();
    expect(code("Napisz umowę pożyczki.")).toBeNull();
    expect(code("Jak wypowiedzieć abonament?")).toBeNull();
  });

  it("not the contract itself, an employment contract or a how-to question", () => {
    expect(code("Napisz umowę najmu.")).toBeNull();
    expect(code("Napisz wypowiedzenie umowy o pracę.")).toBeNull();
    expect(code("Jak wypowiedzieć najem?")).toBeNull();
  });
});

describe("SPO / SPR: reklamacja, rękojmia, odstąpienie od umowy", () => {
  it("complaint, warranty and non-conformity letters", () => {
    expect(code("Napisz reklamację wadliwego telefonu.")).toBe("SPO");
    expect(code("Napisz odpowiedź na reklamację klienta.")).toBe("SPO");
    expect(code("Napisz pismo z rękojmi do sprzedawcy samochodu.")).toBe("SPO-R");
    expect(code("Przygotuj żądanie obniżenia ceny, towar niezgodny z umową.")).toBe("SPO-N");
  });

  it("withdrawal, including \"zerwanie umowy\"", () => {
    expect(code("Przygotuj pismo o odstąpieniu od umowy zawartej przez internet.")).toBe("SPR");
    expect(code("Chcę odstąpić od umowy, wykonawca się spóźnia.")).toBe("SPR");
    expect(code("Napisz zerwanie umowy z firmą remontową.")).toBe("SPR");
  });

  it("not a contract to draft, a received refusal or a how-to question", () => {
    expect(code("Napisz umowę sprzedaży z prawem odstąpienia.")).toBeNull();
    expect(code("Przygotuj projekt umowy najmu z prawem wypowiedzenia.")).toBeNull();
    expect(code("Dostałem odmowę reklamacji, co dalej?")).toBeNull();
    expect(code("Jak odstąpić od umowy?")).toBeNull();
  });
});
