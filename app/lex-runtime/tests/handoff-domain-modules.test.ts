import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LexSkillRegistry } from "../src/registry.js";
import { moduleMap, triggeredModules } from "../src/skill-module-map.js";
import { decideTask, parseActivationMatrix, parseRoutingTable } from "../src/task-routing.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const SKD = "dr-02-prawo-cywilne-rodzinne-gospodarcze/modules/mod-ustawa-kredyt-konsumencki-SKD.md";

describe("hand-off of cases between skills (2026-10-05)", () => {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();
  const triggered = (skill: string, text: string) => triggeredModules(moduleMap(registry, skill), { text }).map((entry) => entry.resource);

  it("delivers a domain skill module a pleading skill names by its dr-NN path, only for that case", () => {
    expect(triggered("pisma-proste-v2", "Oświadczenie o skorzystaniu z sankcji kredytu darmowego wobec banku")).toContain(SKD);
    expect(triggered("pisma-procesowe-v3", "Pozew o zwrot nadpłaty po oświadczeniu o sankcji kredytu darmowego")).toContain(SKD);
    expect(triggered("pisma-procesowe-v3", "Napisz pozew o zapłatę za niezapłaconą fakturę")).not.toContain(SKD);
    expect(triggered("pisma-proste-v2", "Napisz wezwanie do zapłaty za fakturę")).not.toContain(SKD);
  });

  it("routes an assessment of chances or of case files to the court analysis skill", () => {
    const read = (file: string) => fs.readFileSync(path.join(CORPUS, file), "utf8");
    const routes = parseRoutingTable(read("prawny-router-v3/SKILL.md"));
    const matrix = parseActivationMatrix(read("shared/ACTIVATION-MATRIX.md"));
    for (const question of ["Oceń szanse wygrania sprawy w sądzie", "Przeanalizuj akta sprawy", "Jakie mam szanse w sprawie o zapłatę?"]) {
      expect(decideTask(routes, matrix, question, [])?.primary).toBe("analiza-sadowa-v6");
    }
  });
});
