import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlashRouting, rankDomains } from "../src/domain-module-map.js";
import { LexSkillRegistry } from "../src/registry.js";

// Cases the 2026-10-20 comparison with LexAgento found wrong: a wrong act module
// (collective dismissals for a disciplinary one, VAT for PIT on a flat sale, guardianship
// for a bailiff complaint) or a missing second domain (case-law research, DR-16).
type Case = { q: string; domains: string[]; module?: string; notModule?: string };

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();
const rows = parseFlashRouting(fs.readFileSync(path.join(CORPUS, "prawo-polskie-v2/SKILL.md"), "utf8"));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "routing-lexagento-2026-10-20.json"), "utf8")) as Case[];

describe("routing: cases from the LexAgento comparison", () => {
  it.each(cases.map((item) => [item.q, item] as const))("%s", (_q, item) => {
    const ranked = rankDomains(registry, rows, item.q);
    expect(ranked.slice(0, item.domains.length).map((domain) => domain.skill.slice(0, 5))).toEqual(item.domains);
    // The matter's domain leads in the mechanical pick too (it takes a strong domain first).
    expect(ranked.find((domain) => domain.strong)?.skill.slice(0, 5) ?? ranked[0]!.skill.slice(0, 5)).toBe(item.domains[0]);
    const modules = ranked[0]!.modules.map((module) => path.basename(module.resource));
    if (item.module) expect(modules).toContain(item.module);
    if (item.notModule) expect(modules).not.toContain(item.notModule);
  });
});
