import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveActModulesWithChecks } from "../src/act-map-resolver.js";
import { citedArticles, citedArticlesPrompt } from "../src/core-law-tool-runtime.js";
import { provisionsForDetection } from "../src/legal-act-abbreviations.js";
import { LexSkillRegistry } from "../src/registry.js";

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const cites = (q: string) =>
  citedArticles(q, resolveActModulesWithChecks(registry, q).modules.flatMap((m) => (m.basis ? [m.basis] : [])), provisionsForDetection);

describe("przepisy wskazane w pytaniu: akt i numer artykułu bez modelu", () => {
  it("kodeks po skrócie i w odmianie; ustawa po Dz.U. tekstu jednolitego z mapy aktów", () => {
    expect(cites("Zbadaj zmianę treści w artykule 286 kodeksu karnego.")).toEqual([{ act: "KK", article: "286" }]);
    expect(cites("Jak brzmiał art. 178a § 4 KK?")).toEqual([{ act: "KK", article: "178a" }]);
    expect(cites("Analiza art. 299 KSH.")).toEqual([{ act: "KSH", article: "299" }]);
    expect(cites("Przeanalizuj art. 23 ustawy o obszarach morskich RP i administracji morskiej.")).toEqual([{ act: "Dz.U. 2026 poz. 1305", article: "23" }]);
    expect(cites("Co mówi przepis o zasiedzeniu?")).toEqual([]);
  });

  it("brzmienie z kopii ELI w promptcie; brak w kopii nazwany z drogą do ELI", () => {
    const index = {
      resolve: (act: string) => (act === "KK" ? { eli: "DU/2026/1342" } : null),
      currentRecord: () => ({ eli: "DU/2026/1342", title: "Kodeks karny", fetchedAt: "2026-10-20T08:00:00Z", articles: { "286": "Art. 286. § 1. Kto, w celu osiągnięcia korzyści majątkowej…" } })
    } as never;
    const prompt = citedArticlesPrompt(index, [{ act: "KK", article: "286" }, { act: "KC", article: "415" }])!;
    expect(prompt).toContain("[DU/2026/1342] Kodeks karny — art. 286 (tekst z ELI z dnia 2026-10-20)");
    expect(prompt).toContain("Art. 286. § 1. Kto, w celu osiągnięcia korzyści majątkowej");
    expect(prompt).toContain("Brak w lokalnej kopii: art. 415 (KC)");
    expect(citedArticlesPrompt(index, [])).toBeNull();
  });
});

describe("indeks rejestru modułów", () => {
  it("nazwa i pierwsza linia opisu", async () => {
    const { moduleIndex } = await import("../src/skill-sections.js");
    expect(moduleIndex("  [✓] OK    mod-a\n              (opis modułu A)\n  [✓] NOWY  mod-b\n")).toEqual(["- mod-a — opis modułu A", "- mod-b"]);
  });
});
