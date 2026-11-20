import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CoreLawIndex } from "../src/core-law-index.js";

// The release copy lost the amendments after the t.j. of 520 acts (2026-11-20): the catalogue had
// them, the act's state did not. Loading the copy joins them again.
describe("the ELI catalogue's amendments after the t.j. join the act's state", () => {
  it("same t.j.: joined once, titles from the held texts; another t.j.: not joined", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-cat-am-"));
    fs.writeFileSync(
      path.join(dir, "index.json"),
      JSON.stringify({
        acts: {
          "DU/2026/100": { currentEli: "DU/2026/100", amendmentsAfter: [{ eli: "DU/2026/200", title: "Nowela A", promulgation: null }] },
          "DU/2025/300": { currentEli: "DU/2026/301" }
        },
        blockedUntil: null
      })
    );
    fs.writeFileSync(
      path.join(dir, "eli-catalog.json"),
      JSON.stringify({
        schemaVersion: 1,
        builtAt: "2026-11-20T00:00:00Z",
        notices: {},
        complete: true,
        acts: {
          "DU/2020/1": { eli: "DU/2020/1", tj: "DU/2026/100", tjDate: null, title: "Ustawa A", type: "Ustawa", inForce: true, amendmentsAfter: ["DU/2026/200", "DU/2026/201"], domains: [], domainSource: "TITLE" },
          "DU/2019/2": { eli: "DU/2019/2", tj: "DU/2025/300", tjDate: null, title: "Ustawa B", type: "Ustawa", inForce: true, amendmentsAfter: ["DU/2025/999"], domains: [], domainSource: "TITLE" }
        }
      })
    );
    const index = new CoreLawIndex(dir);
    const corpus = fs.mkdtempSync(path.join(os.tmpdir(), "lex-cat-corpus-"));
    index.load(corpus);
    const state = JSON.parse(JSON.stringify((index as unknown as { state: { acts: Record<string, { amendmentsAfter?: Array<{ eli: string }> }> } }).state));
    expect(state.acts["DU/2026/100"].amendmentsAfter.map((item: { eli: string }) => item.eli)).toEqual(["DU/2026/200", "DU/2026/201"]);
    expect(state.acts["DU/2025/300"].amendmentsAfter ?? []).toEqual([]);
    expect(index.adoptCatalogAmendments()).toBe(0);
  });
});
