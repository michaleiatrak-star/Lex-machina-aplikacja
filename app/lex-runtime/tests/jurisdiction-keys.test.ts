import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LegalCorpusToolRuntime } from "../src/legal-corpus-tool-runtime.js";
import { LexSkillRegistry } from "../src/registry.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

describe("jurisdiction keys JUR: (migration of Polish law, E1)", () => {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();

  it("every key of the Polish manifest resolves to its module", () => {
    const modules = registry.jurisdictionModules();
    expect(modules.size).toBeGreaterThanOrEqual(5);
    for (const [key, target] of modules) {
      const resolved = registry.resolveResource("analizator-dowodow-v3", key);
      expect(resolved, key).toBeTruthy();
      expect(resolved!.replaceAll("\\", "/").endsWith(target)).toBe(true);
    }
  });

  it("the pilot: MD5 points to JUR:terminy-procesowe, which holds the deadlines it no longer copies", () => {
    const md5 = fs.readFileSync(path.join(CORPUS, "analizator-dowodow-v3/modules/MD5-terminy.md"), "utf8");
    expect(md5).toContain("view JUR:terminy-procesowe");
    expect(md5).not.toMatch(/art\. 264 §1 KP/u);
    const target = fs.readFileSync(registry.resolveResource("analizator-dowodow-v3", "view JUR:terminy-procesowe")!, "utf8");
    for (const provision of [/art\.\s*264\s*§\s*1/u, /art\.\s*480²\s*§\s*2/u, /art\.\s*53\s*§\s*1/u, /art\.\s*1015/u]) expect(target).toMatch(provision);
  });

  it("an unknown key resolves to nothing, never to a guess", () => {
    expect(registry.resolveResource("analizator-dowodow-v3", "JUR:nie-ma-takiego")).toBeNull();
  });

  it("a model reads it with read_legal_resource path=JUR:…", async () => {
    const runtime = new LegalCorpusToolRuntime(registry);
    const [result] = await runtime.runTools([{ id: "1", name: "read_legal_resource", input: { skill: "analizator-dowodow-v3", path: "JUR:terminy-procesowe" } }]);
    expect(result?.content).toMatch(/Terminy procesowe/u);
    expect(result?.content).toMatch(/art\.\s*264\s*§\s*1/u);
  });
});
