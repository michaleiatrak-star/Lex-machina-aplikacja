import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlashRouting, rankDomains } from "../src/domain-module-map.js";
import { LexSkillRegistry } from "../src/registry.js";
import { schemaCatalog } from "../src/skill-module-map.js";
import { decideTask, parseActivationMatrix, parseRedactionTest, parseRoutingTable } from "../src/task-routing.js";

// Choosing the domain skill (DR) for a case told in a client's words:
// - routing-domains-500.json: 413 matters for DR-01–DR-16, 67 tasks of an executive
//   skill that also need their DR, 20 questions that need no DR;
// - routing-domains-holdout.json: 113 questions written after the tuning, kept as the
//   measure of how the routing does on wording it has not seen.
// "znany_blad": a case the routing gets wrong today (mostly matters of two domains).
// Every other case must pass; a new failure is a regression. A known one fixed is fine.
type Case = { q: string; dr: string | null; skill?: string; znany_blad?: boolean };

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const read = (file: string) => fs.readFileSync(path.join(CORPUS, file), "utf8");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();
const rows = parseFlashRouting(read("prawo-polskie-v2/SKILL.md"));
const routes = parseRoutingTable(read("prawny-router-v3/SKILL.md"));
const matrix = parseActivationMatrix(read("shared/ACTIVATION-MATRIX.md"));
const redaction = parseRedactionTest(read("pisma-procesowe-v3/SKILL.md"));
const simple = { skill: "pisma-proste-v2", entries: schemaCatalog(registry, "pisma-proste-v2") };

function routed(item: Case): boolean {
  const domain = rankDomains(registry, rows, item.q)[0]?.skill.slice(0, 5) ?? null;
  const skill = item.skill ? (decideTask(routes, matrix, item.q, [], redaction, simple)?.primary ?? "-") : null;
  return domain === item.dr && (!item.skill || skill === item.skill);
}

describe.each([
  ["routing-domains-500.json", 500],
  ["routing-domains-holdout.json", 113]
])("DR choice: %s", (file, size) => {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", file), "utf8")) as Case[];

  it("has its cases, every domain among them", () => {
    expect(cases).toHaveLength(size);
    expect(new Set(cases.map((item) => item.dr).filter(Boolean))).toEqual(new Set(Array.from({ length: 16 }, (_, index) => `dr-${String(index + 1).padStart(2, "0")}`)));
  });

  it.each(cases.filter((item) => !item.znany_blad).map((item) => [item.dr ?? "bez DR", item.q, item] as const))("%s: %s", (_domain, _question, item) => {
    expect(routed(item)).toBe(true);
  });

  it("a question that needs no DR never gets one", () => {
    expect(cases.filter((item) => item.dr === null && rankDomains(registry, rows, item.q).length > 0).map((item) => item.q)).toEqual([]);
  });
});

// routing-holdout-2026-10-09.json: 160 questions, 10 per DR, written after the
// 2026-10-09 vocabulary and never used to tune it. Measured as a whole, not per case.
describe("DR choice: control set 2026-10-09", () => {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "routing-holdout-2026-10-09.json"), "utf8")) as Case[];
  const ranked = cases.map((item) => ({ item, domains: rankDomains(registry, rows, item.q).map((entry) => entry.skill.slice(0, 5)) }));
  const share = (hit: (entry: (typeof ranked)[number]) => boolean, list = ranked) => list.filter(hit).length / list.length;

  it("has 10 questions for each domain", () => {
    expect(cases).toHaveLength(160);
    for (let index = 1; index <= 16; index++) {
      expect(cases.filter((item) => item.dr === `dr-${String(index).padStart(2, "0")}`)).toHaveLength(10);
    }
  });

  it("puts the right domain first and among the first two", () => {
    expect(share((entry) => entry.domains[0] === entry.item.dr)).toBeGreaterThanOrEqual(0.85);
    expect(share((entry) => entry.domains.slice(0, 2).includes(entry.item.dr!))).toBeGreaterThanOrEqual(0.9);
  });

  it("leaves no domain behind", () => {
    for (let index = 1; index <= 16; index++) {
      const dr = `dr-${String(index).padStart(2, "0")}`;
      expect(share((entry) => entry.domains[0] === dr, ranked.filter((entry) => entry.item.dr === dr))).toBeGreaterThanOrEqual(0.5);
    }
  });
});
