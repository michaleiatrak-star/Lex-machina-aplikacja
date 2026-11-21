import path from "node:path";
import { describe, expect, it } from "vitest";
import { simpleFormQuestion } from "../src/matter-complexity.js";
import { LexSkillRegistry } from "../src/registry.js";
import { resolveAdditionalSkills } from "../src/skill-selection.js";

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const workflow = (query: string) => resolveAdditionalSkills(registry, query, "prawny-router-v3", true, []).workflowExecutionSkill;

describe("work without a letter does not start the pleading pipeline (user 2026-11-21)", () => {
  it("a question naming a pleading is a legal question", () => {
    for (const q of ["Czy powinienem złożyć pismo przygotowawcze?", "Jaki jest termin na wniesienie apelacji?", "Czym różni się pozew od wniosku?", "Co powinno zawierać pismo przygotowawcze?"]) {
      expect(workflow(q)).not.toBe("pisma-procesowe-v3");
    }
  });
  it("a request to draft and a matter described for a pleading still run it", () => {
    expect(workflow("Napisz apelację od wyroku")).toBe("pisma-procesowe-v3");
    expect(workflow("Pozew o zapłatę 5000 zł przeciwko pracodawcy")).toBe("pisma-procesowe-v3");
  });
});

describe("questions in the simple form: no executive skill's procedure", () => {
  it("opinions and one short question", () => {
    for (const q of ["Co sądzisz o zachowaniu pozwanej?", "Jak oceniasz zeznania świadka Kasta?", "Czy Twoim zdaniem sąd uwzględni wniosek o zobowiązanie pozwanej?", "Jaki jest termin na wniesienie apelacji?", "Dostałem to pismo, co o tym myślisz?", "Jakie jest Twoje zdanie?", "Co sądzisz o tej umowie?", "Jak oceniasz ten wyrok?"]) {
      expect(simpleFormQuestion(q), q).toBe(true);
    }
  });
  it("analyses, work products and named outputs keep the full path", () => {
    for (const q of ["Przeanalizuj dowody w tej sprawie", "Oceń wiarygodność zeznań świadka Kasta", "Jakie mam szanse w tej sprawie?", "Przygotuj pytania do świadka na następną rozprawę", "Zrób chronologię sprawy", "Napisz apelację od wyroku", "W skrócie: czy mam szanse?"]) {
      expect(simpleFormQuestion(q), q).toBe(false);
    }
  });
});
