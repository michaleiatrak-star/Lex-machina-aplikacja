import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LexSkillRegistry } from "../src/registry.js";
import { resolveAdditionalSkills } from "../src/skill-selection.js";
import { decideTask, parseActivationMatrix, parseRedactionTest, parseRoutingTable } from "../src/task-routing.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();
const routes = parseRoutingTable(fs.readFileSync(path.join(CORPUS, "prawny-router-v3/SKILL.md"), "utf8"));
const matrix = parseActivationMatrix(fs.readFileSync(path.join(CORPUS, "shared/ACTIVATION-MATRIX.md"), "utf8"));
const redaction = parseRedactionTest(fs.readFileSync(path.join(CORPUS, "pisma-procesowe-v3/SKILL.md"), "utf8"));
const both = (q: string) => [resolveAdditionalSkills(registry, q, "prawny-router-v3", true, []).workflowExecutionSkill, decideTask(routes, matrix, q, [], redaction)?.primary ?? null];

// Probe 2026-11-26: before, "podstawa prawna" had no skill, "wyrok"/"świadka"/"faktur" started the
// court-analysis, witness or evidence skill, "odwołanie" the pleading pipeline.
const STATUTE = [
  "Jaka jest podstawa prawna rozwiązania umowy o pracę bez wypowiedzenia?",
  "Na jakiej podstawie prawnej pracodawca może obniżyć wynagrodzenie?",
  "Przeanalizuj art. 52 Kodeksu pracy",
  "Jak interpretować art. 233 § 1 kpc?",
  "Jaka jest wykładnia art. 415 kc w zakresie winy?",
  "Co oznacza przesłanka ciężkiego naruszenia obowiązków pracowniczych?",
  "Jakie przepisy regulują przedawnienie roszczeń pracowniczych?",
  "Jakie było brzmienie art. 30 kp w 2022 roku?",
  "Czy art. 8 kp ma zastosowanie do roszczenia o odszkodowanie?",
  "Jakie są przesłanki z art. 471 kc?",
  "Interpretacja przepisu o zachowku w przypadku darowizny sprzed 10 lat",
  "Czy przepis art. 23 1 kp stosuje się przy outsourcingu?",
  "Podaj przepisy dotyczące terminu na odwołanie od wypowiedzenia",
  "Jaka ustawa reguluje ochronę sygnalistów i jakie są jej kluczowe przepisy?",
  "Czy zmieniło się brzmienie art. 94 3 kp o mobbingu?"
];
const CASE_LAW = [
  "Znajdź wyroki SN dotyczące mobbingu po 2020 roku",
  "Jaka jest linia orzecznicza w sprawie zachowku od darowizn?",
  "Czy wyrok SN II PK 123/19 jest nadal aktualny?",
  "Czy wyrok III CZP 25/11 został uchylony?",
  "Jaka jest teza uchwały SN III CZP 6/22?",
  "Szukam orzeczeń, w których sąd uznał, że brak przeszkolenia BHP wyklucza winę pracownika",
  "Czy w wyroku I ACa 100/20 sąd stwierdził, że umowa była nieważna, czy to tylko twierdzenie powoda?",
  "Czy NSA orzekał o zwrocie podatku VAT przy fikcyjnych fakturach?",
  "Sprawdź, czy wyrok TK K 1/20 obowiązuje",
  "Jak sądy oceniają zeznania świadka będącego pracownikiem strony?",
  "Podaj orzecznictwo na temat art. 52 kp i utraty zaufania",
  "Czy wyrok sądu apelacyjnego w sprawie V ACa 50/21 jest prawomocny?",
  "Czy istnieje rozbieżność w orzecznictwie co do przedawnienia roszczeń z umowy frankowej?",
  "Co orzekł Sąd Najwyższy w wyroku III CZP 25/11?",
  "Czy teza z wyroku II CSK 123/18 dotyczy rękojmi?"
];

describe("questions about the law go to the statute skill", () => {
  it.each(STATUTE)("%s", (q) => expect(both(q)).toEqual(["analizator-przepisow-v2", "analizator-przepisow-v2"]));
});
describe("questions about case law go to the case-law skill", () => {
  it.each(CASE_LAW)("%s", (q) => expect(both(q)).toEqual(["orzeczenia-sadowe-v2", "orzeczenia-sadowe-v2"]));
});
describe("own documents, drafting and witness questions keep their skills", () => {
  it("a delivered judgment to analyse is the court analysis", () => expect(both("Przeanalizuj ten wyrok i oceń szanse apelacji")[0]).not.toBe("orzeczenia-sadowe-v2"));
  it("drafting an appeal is the pleading", () => expect(both("Napisz apelację od wyroku SN II PK 123/19")[0]).toBe("pisma-procesowe-v3"));
  it("questions for a witness are the witness skill", () => expect(both("Przygotuj pytania do świadka na rozprawę")[1]).toBe("przesluchanie-swiadkow-v2-min90"));
});

describe("editing a contract's clause is the contract skill, not the statute analysis a '§' picks", () => {
  it.each(["Popraw § 5 tej umowy, kara umowna jest za wysoka", "Dodaj do umowy klauzulę o waloryzacji czynszu", "Przeredaguj umowę tak, żeby chroniła najemcę"])("%s", (q) => {
    expect(decideTask(routes, matrix, q, [], redaction)?.primary).toBe("analizator-umow-v1");
  });
  it("a question about a statute's paragraph stays the statute analysis", () => {
    expect(decideTask(routes, matrix, "Jak interpretować art. 233 § 1 kpc?", [], redaction)?.primary).toBe("analizator-przepisow-v2");
  });
});
