import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CoreLawIndex } from "../src/core-law-index.js";
import { citedArticles } from "../src/core-law-tool-runtime.js";
import { provisionsForDetection } from "../src/legal-act-abbreviations.js";

// The probe of 2026-10-21: "art. 30 KP" read article 30 of the reprivatisation act, because
// "kp" was found inside the label "KPA art. 156 § 2a + ustawa reprywatyzacyjna".
function index(): CoreLawIndex {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-core-codes-"));
  fs.mkdirSync(path.join(root, "dr-04-praca"));
  fs.writeFileSync(
    path.join(root, "dr-04-praca", "MAPA-AKTOW.md"),
    [
      "| KPA art. 156 § 2a + ustawa reprywatyzacyjna | Dz.U. 2021 poz. 795 t.j. | `mod-x` | ✅ |",
      "| Kodeks pracy (KP) | Dz.U. 2026 poz. 1245 t.j. ze zm. | `mod-KP` | ✅ |",
      "| Kodeks postępowania administracyjnego (KPA) | Dz.U. 2025 poz. 1691 t.j. | `mod-KPA` | ✅ |",
      "| KK art. 278–295 — przestępstwa przeciwko mieniu | Dz.U. 2025 poz. 383 t.j. | `mod-KK-mienie` | ✅ |",
      "| Kodeks karny (KK) | Dz.U. 2026 poz. 1342 t.j. | `mod-KK` | ✅ |",
      "| Kodeks karny skarbowy | Dz.U. 2025 poz. 633 t.j. | `mod-KKS` | ✅ |",
      "| Kodeks rodzinny i opiekuńczy | Dz.U. 2026 poz. 236 t.j. | `mod-KRO` | ✅ |",
      "| Rozporządzenie w sprawie grzywien (KRO art. 50) | Dz.U. 2020 poz. 1 | `mod-y` | ✅ |"
    ].join("\n")
  );
  const result = new CoreLawIndex(fs.mkdtempSync(path.join(os.tmpdir(), "lex-core-codes-store-")), (async () => {
    throw new Error("NO_NETWORK");
  }) as never);
  result.load(root);
  return result;
}

describe("a code's abbreviation resolves to the code, not to a label that starts with its letters", () => {
  const core = index();
  it.each([
    ["KP", "DU/2026/1245"],
    ["KPA", "DU/2025/1691"],
    ["KK", "DU/2026/1342"],
    ["KKS", "DU/2025/633"],
    ["KRO", "DU/2026/236"],
    ["Kodeks pracy", "DU/2026/1245"]
  ])("%s -> %s", (act, eli) => {
    expect(core.resolve(act)?.eli).toBe(eli);
  });
});

describe("articles cited in a question", () => {
  const cites = (q: string) => citedArticles(q, [], provisionsForDetection);
  it("keeps a superscript, a unit's number is no article, a list with one code gives each article", () => {
    expect(cites("Co mówi art. 55¹ KP?")).toEqual([{ act: "KP", article: "55^1" }]);
    expect(cites("art. 10 ust. 1 pkt 2 KP")).toEqual([{ act: "KP", article: "10" }]);
    expect(cites("art. 148 i 286 KK")).toEqual([{ act: "KK", article: "148" }, { act: "KK", article: "286" }]);
    expect(cites("art. 415, 445 i 448 k.c.")).toEqual([{ act: "KC", article: "415" }, { act: "KC", article: "445" }, { act: "KC", article: "448" }]);
    expect(cites("art. 30 KP i art. 35 KPA")).toEqual([{ act: "KP", article: "30" }, { act: "KPA", article: "35" }]);
  });
  it("a number after a unit is no bare provision", () => {
    expect(provisionsForDetection("art. 10 ust. 1 pkt 2 KP")).toBe("art. 10 ust. 1 pkt 2 KP");
    expect(provisionsForDetection("art. 55¹ KP")).toBe("art. 55^1 KP");
  });
});
