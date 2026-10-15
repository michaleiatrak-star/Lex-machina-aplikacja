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
