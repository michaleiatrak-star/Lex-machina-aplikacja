import path from "node:path";
import { describe, expect, it } from "vitest";
import { documentCompletenessWarnings } from "../src/document-completeness.js";
import type { LegalDocumentAst } from "../src/legal-document-ast.js";
import { domainSubject, parseFlashRouting, rankDomains } from "../src/domain-module-map.js";
import { LexSkillRegistry } from "../src/registry.js";
import { resolveAdditionalSkills } from "../src/skill-selection.js";

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const workflow = (query: string) => resolveAdditionalSkills(registry, query, "prawny-router-v3", true, []).workflowExecutionSkill;

describe("every letter or reply to draft runs the pleading path (live test 2026-11-19)", () => {
  it("a reply to the court built on hearing records is a pleading, not an evidence analysis", () => {
    expect(workflow("Przygotuj odpowiedź do sądu wykorzystując wcześniejszy protokół do wykazania sprzeczności i obydwa protokoły do wykazania korzystnych dla mnie zeznań")).toBe("pisma-procesowe-v3");
    expect(workflow("przygotuj odwołanie od decyzji ZUS")).toBe("pisma-procesowe-v3");
    expect(workflow("napisz zażalenie na postanowienie o kosztach")).toBe("pisma-procesowe-v3");
  });

  it("the simple letters, contracts and conclusions of an analysis keep their own path", () => {
    expect(workflow("Napisz wniosek o uzasadnienie wyroku")).toBe("pisma-proste-v2");
    expect(workflow("napisz wezwanie do zapłaty")).toBe("pisma-proste-v2");
    expect(workflow("napisz umowę najmu")).toBe("analizator-umow-v1");
    expect(workflow("przygotuj wnioski z analizy dowodów")).toBe("analizator-dowodow-v3");
  });

  it("the court a letter goes to does not name the courts-and-professions domain", () => {
    const rows = parseFlashRouting(registry.get("prawo-polskie-v2")!.body);
    const domains = (text: string) => rankDomains(registry, rows, text).map((row) => row.skill);
    expect(domains("Przygotuj odpowiedź do sądu w sprawie zeznań świadka")).not.toContain("dr-12-sadownictwo-prokuratura-zawody-prawnicze");
    expect(domains("sąd nie wyznaczył rozprawy od roku")).toContain("dr-12-sadownictwo-prokuratura-zawody-prawnicze");
  });
});

describe("case-file markers are not fields of the letter", () => {
  it("[[LEXDOCREF:…]] and [[LEXDOC:…]] are not listed to fill in", () => {
    const ast: LegalDocumentAst = {
      schemaVersion: "1",
      documentType: "pleading",
      locale: "pl-PL",
      styleProfile: "lex-office-tnr-v1",
      title: [{ type: "text", text: "PISMO PROCESOWE" }],
      blocks: [{ type: "signature", content: [{ type: "text", text: "Podpis" }] }]
    };
    const warnings = documentCompletenessWarnings(ast, "Świadek zeznał [[LEXDOCREF:docref_1]] oraz [[LEXDOC:doc_a:3]]. [UZUPEŁNIJ: data]");
    expect(warnings).toEqual(["pola do uzupełnienia: [UZUPEŁNIJ: data]"]);
  });
});

describe("the domain comes from the matter, not from the court (user 2026-11-19)", () => {
  const rows = parseFlashRouting(registry.get("prawo-polskie-v2")!.body);
  const domains = (text: string) => rankDomains(registry, rows, text).map((row) => row.skill.slice(0, 5));

  it("a court's name, division and address, the addressee and what the court did name no domain", () => {
    const subject = domainSubject("Sąd Okręgowy w Katowicach XI Wydział Pracy i Ubezpieczeń Społecznych, ul. Andrzeja 16/18, 40-061 Katowice. Sąd dopuścił dowód, odpowiedź do sądu.");
    expect(subject).not.toMatch(/Okręgowy|Wydział|Andrzeja|dopuścił|do sądu/u);
    expect(domains("Sąd Okręgowy w Katowicach XI Wydział Pracy, ul. Andrzeja 16/18. Sąd dopuścił dowód z zeznań świadka.")).toEqual([]);
    expect(domains("Sąd wyznaczył rozprawę na 5 maja")).not.toContain("dr-12");
  });

  it("the matter still names its domain, also a complaint about the court itself", () => {
    expect(domains("Sąd oddalił mój wniosek dowodowy w sprawie o zapłatę faktury")).toEqual(["dr-02"]);
    expect(domains("sąd nie wyznaczył rozprawy od roku")).toContain("dr-12");
    expect(domains("Biegły sądowy wydał stronniczą opinię, zarzuty do opinii")).toContain("dr-12");
  });

  it("forms of one word are one word, and a cut stem is not another word's start", () => {
    // "protokół"/"protokoły" alone named the KPA module; "sprzeczności" matched "sprzeciw" (RODO objection).
    expect(domains("Przygotuj odpowiedź do sądu wykorzystując wcześniejszy protokół do wykazania sprzeczności i obydwa protokoły do wykazania korzystnych dla mnie zeznań")).toEqual([]);
  });

  it("the case's own documents then name it: a labour-court record's subject is labour law", () => {
    const heading = "Sygn. akt: XI P 27/26 PROTOKÓŁ Sąd Okręgowy w Katowicach, XI Wydział Pracy i Ubezpieczeń Społecznych na rozprawie rozpoznał sprawę z powództwa [PII:PERSON:0001] przeciwko [PII:FIRM:0001] o wynagrodzenie za pracę, ekwiwalent pieniężny za niewykorzystany urlop wypoczynkowy, odszkodowanie i sprostowanie świadectwa pracy";
    const ranked = rankDomains(registry, rows, heading);
    expect(ranked[0]).toMatchObject({ skill: expect.stringMatching(/^dr-04-/u), strong: true });
  });
});
