import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activeCountry, activeJurisdictionPack, configureJurisdiction, foreignLegalSystemNotice, setActiveCountry, skillOfferedInJurisdiction } from "../src/jurisdiction.js";
import { LexSkillRegistry } from "../src/registry.js";
import { mandatorySessionSkills } from "../src/skill-selection.js";
import { readNationalLaw } from "../src/eli/national-law.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const settings = fs.mkdtempSync(path.join(os.tmpdir(), "lex-legal-system-"));
const saved = { pack: process.env.LEX_JURISDICTION_PACK, country: process.env.LEX_JURISDICTION_COUNTRY };

beforeAll(() => {
  delete process.env.LEX_JURISDICTION_PACK;
  delete process.env.LEX_JURISDICTION_COUNTRY;
  configureJurisdiction(settings);
});
afterEach(() => setActiveCountry(CORPUS, "PL"));
afterAll(() => {
  configureJurisdiction(null);
  fs.rmSync(settings, { recursive: true, force: true });
  if (saved.pack !== undefined) process.env.LEX_JURISDICTION_PACK = saved.pack;
  if (saved.country !== undefined) process.env.LEX_JURISDICTION_COUNTRY = saved.country;
});

describe("legal system: the chosen country only, the others off", () => {
  it("Poland: its package and domain skills", () => {
    setActiveCountry(CORPUS, "PL");
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    expect(activeJurisdictionPack()).toBe("prawo-polskie-v2");
    expect(registry.get("prawo-polskie-v2")).toBeDefined();
    expect([...registry.skills.keys()].some((name) => name.startsWith("dr-02-"))).toBe(true);
    expect(foreignLegalSystemNotice(activeCountry())).toBeNull();
  });

  it("a country without a package: no Polish facade, no dr-*, method skills stay, the model told", () => {
    setActiveCountry(CORPUS, "AT");
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    expect(activeCountry()).toBe("AT");
    expect(activeJurisdictionPack()).toBe("");
    expect(registry.get("prawo-polskie-v2")).toBeUndefined();
    expect([...registry.skills.keys()].filter((name) => /^[a-z]{2}-\d{2}-/u.test(name))).toEqual([]);
    expect(registry.get("prawny-router-v3")).toBeDefined();
    expect(registry.get("analizator-umow-v1")).toBeDefined();
    expect(mandatorySessionSkills()).toEqual(["prawny-router-v3", "shared"]);
    expect(foreignLegalSystemNotice("AT")).toMatch(/Austria.*Prawo polskie, polskie skille dziedzinowe \(dr-\*\).*wyłączone/su);
  });

  it("future packages prawo-<kraj> with <kod>-xx skills: only the chosen country's are offered", () => {
    const facades = new Set(["prawo-polskie-v2", "prawo-niemieckie"]);
    setActiveCountry(CORPUS, "PL");
    expect(skillOfferedInJurisdiction("dr-02-prawo-cywilne", facades)).toBe(true);
    expect(skillOfferedInJurisdiction("de-02-zivilrecht", facades)).toBe(false);
    expect(skillOfferedInJurisdiction("prawo-niemieckie", facades)).toBe(false);
    expect(skillOfferedInJurisdiction("analizator-umow-v1", facades)).toBe(true);
  });

  it("the reader refuses another country's source", async () => {
    await expect(readNationalLaw({ url: "https://www.boe.es/eli/es/l/2015/10/01/39/con", unit: "28", country: "AT" })).rejects.toThrow("NATIONAL_LAW_COUNTRY_DISABLED:ES");
  });
});
