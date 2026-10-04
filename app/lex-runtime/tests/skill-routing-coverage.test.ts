import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyDocument } from "../src/document-kind.js";
import { parseActMap, parseFlashRouting, rankDomains } from "../src/domain-module-map.js";
import { executiveContract } from "../src/executive-skill-contract.js";
import { LexSkillRegistry } from "../src/registry.js";
import { matchSchema, parseSchemaCatalog } from "../src/skill-schema-catalog.js";
import { moduleMap, schemaCatalog, skillModules } from "../src/skill-module-map.js";
import { decideTask, parseActivationMatrix, parseRedactionTest, parseRoutingTable } from "../src/task-routing.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const read = (file: string) => fs.readFileSync(path.join(CORPUS, file), "utf8");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();

describe("pisma-proste-v2: every category of its schema catalogue", () => {
  const catalog = parseSchemaCatalog(read("pisma-proste-v2/SKILL.md"), "pisma-proste-v2");
  const routes = parseRoutingTable(read("prawny-router-v3/SKILL.md"));
  const matrix = parseActivationMatrix(read("shared/ACTIVATION-MATRIX.md"));
  const redaction = parseRedactionTest(read("pisma-procesowe-v3/SKILL.md"));
  const simple = { skill: "pisma-proste-v2", entries: schemaCatalog(registry, "pisma-proste-v2") };

  it.each([
    ["Napisz sprzeciw od nakazu zapłaty", "SPA"],
    ["Przygotuj zarzuty od nakazu zapłaty", "SPB"],
    ["Wniosek o klauzulę wykonalności", "SPC"],
    ["Wniosek o wszczęcie egzekucji do komornika", "SPD"],
    ["Napisz wezwanie do zapłaty", "SPE"],
    ["Ostateczne wezwanie do zapłaty przed pozwem", "SPE-O"],
    ["Wniosek o uzasadnienie wyroku", "SPF"],
    ["Wniosek o zabezpieczenie roszczenia", "SPG"],
    ["Wniosek o zwolnienie od kosztów sądowych", "SPH"],
    ["Wniosek o przywrócenie terminu", "SPH"],
    ["Wniosek o wgląd do akt", "SPH"],
    ["Sprzeciw od orzeczenia referendarza", "SPH"],
    ["Odpowiedź na zawezwanie do próby ugodowej", "SPI"],
    ["Wniosek o interpretację indywidualną ZUS", "SPJ"],
    ["Skarga do UODO na administratora", "SPK"],
    ["Skarga na czynności komornika", "SPL"],
    ["Oświadczenie o sankcji kredytu darmowego", "SPM"]
  ])("%s -> %s", (question, code) => {
    expect(matchSchema(catalog, question)?.code).toBe(code);
    const decision = decideTask(routes, matrix, question, [], redaction, simple);
    expect(decision?.primary).toBe("pisma-proste-v2");
    expect(decision?.modules?.length).toBeGreaterThan(0);
  });

  it("SPM reads the DR-02 SKD module before its schema", () => {
    expect(catalog.find((entry) => entry.code === "SPM")?.resources[0]).toBe(
      "dr-02-prawo-cywilne-rodzinne-gospodarcze/modules/mod-ustawa-kredyt-konsumencki-SKD.md"
    );
  });

  it("no schema for other requests; a full pleading stays with pisma-procesowe-v3", () => {
    expect(matchSchema(catalog, "Napisz skargę na decyzję")).toBeNull();
    expect(decideTask(routes, matrix, "Napisz pozew i wniosek o zabezpieczenie roszczenia", [], redaction, simple)?.primary).toBe("pisma-procesowe-v3");
    const order = classifyDocument({ text: "NAKAZ ZAPŁATY W POSTĘPOWANIU UPOMINAWCZYM\nSygn. akt I Nc 1/24" });
    expect(decideTask(routes, matrix, "Przeanalizuj ten nakaz i przygotuj sprzeciw od nakazu zapłaty", [order], redaction, simple)).toMatchObject({
      primary: "analiza-sadowa-v6",
      then: "pisma-proste-v2"
    });
  });

  it("loads the always-modules (M1, M2, M4, M8, M9) and the one schema", () => {
    const modules = skillModules(registry, "pisma-proste-v2", { text: "Napisz sprzeciw od nakazu zapłaty" }).map((item) => item.resource);
    expect(modules[0]).toBe("pisma-proste-v2/references/SPA-sprzeciw.md");
    for (const code of ["M1-zasady", "M2-intake", "M4-struktura", "M8-checklista", "M9-format"]) {
      expect(modules).toContain(`pisma-proste-v2/references/${code}.md`);
    }
    expect(modules.filter((resource) => /\/SP[A-Z]/.test(resource))).toHaveLength(1);
  });
});

describe("drafting a letter vs analysing one", () => {
  const routes = parseRoutingTable(read("prawny-router-v3/SKILL.md"));
  const matrix = parseActivationMatrix(read("shared/ACTIVATION-MATRIX.md"));
  const redaction = parseRedactionTest(read("pisma-procesowe-v3/SKILL.md"));
  const simple = { skill: "pisma-proste-v2", entries: schemaCatalog(registry, "pisma-proste-v2") };
  const demand = classifyDocument({ text: "PRZEDSĄDOWE WEZWANIE DO ZAPŁATY\nWzywam do zapłaty kwoty 5000 zł" });
  const order = classifyDocument({ text: "NAKAZ ZAPŁATY W POSTĘPOWANIU UPOMINAWCZYM\nSygn. akt I Nc 1/24" });
  const pick = (question: string, materials: Parameters<typeof decideTask>[3] = []) => {
    const decision = decideTask(routes, matrix, question, materials, redaction, simple);
    return [decision?.primary, decision?.then, (decision?.modules ?? []).map((module) => module.split("/").pop()).join(",")].filter(Boolean).join(" | ");
  };

  it.each([
    ["Napisz wezwanie do zapłaty", [], "pisma-proste-v2 | SPC-SPD-SPE.md"],
    ["Przeanalizuj to wezwanie do zapłaty", [demand], "analizator-dowodow-v3"],
    ["Oceń, czy to wezwanie do zapłaty jest zasadne", [demand], "analizator-dowodow-v3"],
    ["Dostałem wezwanie do zapłaty, co mam zrobić?", [demand], "przewodnik-prawny-v2"],
    ["Czy muszę zapłacić? Dostałem wezwanie do zapłaty", [], "przewodnik-prawny-v2"],
    ["Odpowiedz na to wezwanie do zapłaty", [demand], "analizator-dowodow-v3 | pisma-proste-v2"],
    ["Przeanalizuj nakaz zapłaty", [order], "analiza-sadowa-v6"],
    ["Napisz sprzeciw od nakazu zapłaty", [order], "pisma-proste-v2 | SPA-sprzeciw.md"],
    ["Sprawdź mój sprzeciw od nakazu zapłaty", [], "pisma-proste-v2 | SPA-sprzeciw.md"]
  ] as const)("%s", (question, materials, expected) => {
    expect(pick(question, [...materials])).toBe(expected);
  });

  it("no drafting schema in the module map for a question about a received demand", () => {
    expect(skillModules(registry, "pisma-proste-v2", { text: "Przeanalizuj to wezwanie do zapłaty" }).some((item) => /SPC-SPD-SPE/.test(item.resource))).toBe(false);
  });
});

describe("pipeline stages: shared modules named in stage headings", () => {
  it("pisma-procesowe-v3 W1 requires its strategy and red-team modules", () => {
    const w1 = moduleMap(registry, "pisma-procesowe-v3").filter((entry) => entry.stage === "W1" && entry.always).map((entry) => entry.resource);
    expect(w1).toEqual(expect.arrayContaining(["shared/MOD-STRATEGIA-WYBOR.md", "shared/MOD-WARIANTY-POZWU.md", "shared/MOD-RED-TEAM-WLASNY.md"]));
  });
});

describe("DR domains: flash routing of prawo-polskie-v2 and act modules of MAPA-AKTOW", () => {
  const rows = parseFlashRouting(read("prawo-polskie-v2/SKILL.md"));

  it("reads all sixteen domains and their act maps", () => {
    expect(rows).toHaveLength(16);
    expect(rows.every((row) => registry.get(row.skill))).toBe(true);
    expect(parseActMap(read("dr-04-prawo-pracy-zus-swiadczenia/MAPA-AKTOW.md"), "dr-04-prawo-pracy-zus-swiadczenia").flatMap((entry) => entry.resources)).toContain(
      "dr-04-prawo-pracy-zus-swiadczenia/modules/mod-KP-prawo-pracy.md"
    );
  });

  it.each([
    ["Ile wynosi zasiłek pogrzebowy z ZUS?", "dr-04-prawo-pracy-zus-swiadczenia", "mod-FUS-zasilek-pogrzebowy-renta-rodzinna-waloryzacja.md"],
    ["Czy przysługuje mi urlop rodzicielski?", "dr-04-prawo-pracy-zus-swiadczenia", "mod-KP-dzial-VIII-rodzicielstwo.md"],
    ["Spadek po ojcu — zachowek", "dr-02-prawo-cywilne-rodzinne-gospodarcze", "mod-KC-spadki-zachowek-dzial-rozrzadzenia.md"],
    ["Administrator nie usuwa moich danych osobowych RODO", "dr-11-cyfrowe-cyber-ai-dane-ip", "mod-UODO-postepowanie-ochrona-danych.md"],
    ["Sąsiad wybudował garaż bez pozwolenia, samowola budowlana", "dr-09-budownictwo-srodowisko-energia-transport", "mod-PrBud-prawo-budowlane.md"]
  ])("%s", (question, domain, module) => {
    const ranked = rankDomains(registry, rows, question);
    const hit = ranked.find((row) => row.skill === domain);
    expect(hit).toBeDefined();
    expect(hit!.modules[0]?.resource.endsWith(module)).toBe(true);
  });
});

describe("executive skills: required dependencies, coded modules, load instructions", () => {
  it("analizator-dowodow-v3: frontmatter MOD-* in the contract, coded modules of its diagnostic tree", () => {
    expect(executiveContract(registry, "analizator-dowodow-v3")?.resources).toEqual(
      expect.arrayContaining(["shared/MOD-SKAN-DOWODOW-KOMPLETNY.md", "shared/MOD-STEP-TRACKER.md"])
    );
    const map = moduleMap(registry, "analizator-dowodow-v3");
    expect(map.find((entry) => entry.resource.endsWith("MD1-klasyfikacja.md"))?.condition).toMatch(/dowody do oceny/);
    expect(map.some((entry) => entry.resource.endsWith("MX-dziedziny.md"))).toBe(true);
    const modules = skillModules(registry, "analizator-dowodow-v3", { text: "Oceń te maile.\nmateriał zawiera dowody do oceny (dokumenty)" }).map((item) => item.resource);
    expect(modules).toEqual(expect.arrayContaining(["analizator-dowodow-v3/modules/MD1-klasyfikacja.md", "analizator-dowodow-v3/modules/MD2-scoring.md"]));
  });

  it("raport-klienta-v1: the client language reference is always read", () => {
    expect(skillModules(registry, "raport-klienta-v1", { text: "Przygotuj raport dla klienta" }).map((item) => item.resource)).toContain(
      "raport-klienta-v1/references/jezyk-klienta.md"
    );
  });
});
