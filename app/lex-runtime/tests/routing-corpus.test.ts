import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlashRouting, rankDomains } from "../src/domain-module-map.js";
import { LexSkillRegistry } from "../src/registry.js";
import { schemaCatalog } from "../src/skill-module-map.js";
import { decideTask, parseActivationMatrix, parseRedactionTest, parseRoutingTable } from "../src/task-routing.js";

// Lay questions per legal domain (DR-01–DR-16) and per executive skill: the case
// must reach the right domain, its act module, and the right executive skill.
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const read = (file: string) => fs.readFileSync(path.join(CORPUS, file), "utf8");
const fixture = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as T;
const registry = new LexSkillRegistry(CORPUS);
registry.scan();

describe("a case reaches its domain skill (DR) and the act module", () => {
  const rows = parseFlashRouting(read("prawo-polskie-v2/SKILL.md"));
  const cases = Object.entries(fixture<Record<string, Array<[string, string | null]>>>("routing-domains.json")).flatMap(([domain, questions]) =>
    questions.map(([question, module]) => [domain, question, module] as const)
  );

  it("covers every domain skill of the corpus", () => {
    const domains = [...registry.skills.keys()].filter((name) => /^dr-\d{2}-/.test(name));
    expect(new Set(cases.map(([domain]) => domain))).toEqual(new Set(domains));
  });

  it.each(cases)("%s: %s", (domain, question, module) => {
    const ranked = rankDomains(registry, rows, question);
    expect(ranked[0]?.skill).toBe(domain);
    if (module) expect(ranked[0]!.modules.map((item) => item.resource).join(" ")).toContain(module);
  });
});

describe("a task reaches its executive skill (router v3, activation matrix)", () => {
  const routes = parseRoutingTable(read("prawny-router-v3/SKILL.md"));
  const matrix = parseActivationMatrix(read("shared/ACTIVATION-MATRIX.md"));
  const redaction = parseRedactionTest(read("pisma-procesowe-v3/SKILL.md"));
  const simple = { skill: "pisma-proste-v2", entries: schemaCatalog(registry, "pisma-proste-v2") };
  // "-": a domain question with no executive skill (prawo-polskie-v2 and the DR hint).
  const cases = Object.entries(fixture<Record<string, string[]>>("routing-executive.json")).flatMap(([skill, questions]) =>
    questions.map((question) => [skill, question] as const)
  );

  it("covers every executive skill of the corpus", () => {
    const executive = [...registry.skills.keys()].filter(
      (name) => !/^dr-\d{2}-|^(?:shared|prawny-router-v3|prawo-polskie-v2|audyt-systemu-v4)$/.test(name)
    );
    expect(new Set(cases.map(([skill]) => skill).filter((skill) => skill !== "-"))).toEqual(new Set(executive));
  });

  it.each(cases)("%s: %s", (skill, question) => {
    expect(decideTask(routes, matrix, question, [], redaction, simple)?.primary ?? "-").toBe(skill);
  });
});
