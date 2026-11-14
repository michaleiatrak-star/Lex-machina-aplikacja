import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractCoreActs, setCoreLawScope } from "../src/core-law-index.js";
import { configureJurisdiction, setActiveCountry } from "../src/jurisdiction.js";

// The repository's corpus: Polish law (prawo-polskie-v2 and its domain skills dr-xx).
const corpus = path.resolve(import.meta.dirname, "../../../Wersja rozwojowa rozpakowana");
const dirs: string[] = [];
afterEach(() => {
  setCoreLawScope(() => "active");
  configureJurisdiction(null);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function settings(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-jur-"));
  dirs.push(dir);
  configureJurisdiction(dir);
}

describe("core-law RAG follows the chosen jurisdiction; server mode keeps every one", () => {
  it("Polish law chosen: the Polish acts are updated", () => {
    settings();
    setActiveCountry(corpus, "PL");
    expect(extractCoreActs(corpus).length).toBeGreaterThan(50);
  });

  it("a country without a package (Germany): no Polish act is updated on a desktop", () => {
    settings();
    setActiveCountry(corpus, "DE");
    expect(extractCoreActs(corpus)).toEqual([]);
  });

  it("server mode: every jurisdiction's acts, whatever the desktop choice", () => {
    settings();
    setActiveCountry(corpus, "DE");
    setCoreLawScope(() => "all");
    expect(extractCoreActs(corpus).length).toBeGreaterThan(50);
  });
});

describe("KATALOG-TJ of a domain (scripts/mapy_tj.py): the domain of the catalogue's acts", () => {
  const ukonc = "DU/2025/1688"; // umowa koncesji: DR-07 KATALOG-TJ only, not in its MAPA-AKTOW routing
  afterEach(() => {
    delete process.env.LEX_ELI_FULL_CATALOG;
  });

  it("full ELI catalogue on: the act of KATALOG-TJ is a core act of its domain", () => {
    settings();
    setActiveCountry(corpus, "PL");
    process.env.LEX_ELI_FULL_CATALOG = "1";
    const act = extractCoreActs(corpus).find((ref) => ref.eli === ukonc);
    expect(act?.domains).toContain("dr-07-zamowienia-publiczne-fundusze-ue");
    expect(act?.consolidated).toBe(true);
  });

  it("catalogue off: KATALOG-TJ is not read (no thousands of downloads)", () => {
    settings();
    setActiveCountry(corpus, "PL");
    process.env.LEX_ELI_FULL_CATALOG = "0";
    expect(extractCoreActs(corpus).some((ref) => ref.eli === ukonc)).toBe(false);
  });
});
