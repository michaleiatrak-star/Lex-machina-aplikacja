import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LegalCorpusToolRuntime } from "../src/legal-corpus-tool-runtime.js";
import { LexSkillRegistry } from "../src/registry.js";
import { loadModules, skillModules } from "../src/skill-module-map.js";
import { writeJurisdictionManifest } from "./jurisdiction-fixture.js";

// Migration of Polish law E3 (prawo-polskie-v2/krajowe/): the executive skills, shared and the
// router name national law by key; the application must still read that content, and another
// jurisdiction's package with the same keys must replace it.
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const METHOD_SKILLS = [
  "analiza-sadowa-v6", "analizator-dowodow-v3", "analizator-przepisow-v2", "analizator-umow-v1", "chronologia-sprawy-v1",
  "orzeczenia-sadowe-v2", "pisma-procesowe-v3", "pisma-proste-v2", "przesluchanie-swiadkow-v2-min90", "przewodnik-prawny-v2",
  "raport-klienta-v1", "raport-sytuacyjny-v2", "shared", "prawny-router-v3"
];

function markdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__pycache__" ? [] : markdownFiles(full);
    return entry.name.endsWith(".md") && !/CHANGELOG|AUDIT-JOURNAL/u.test(entry.name) ? [full] : [];
  });
}

describe("national law by key after the move to the jurisdiction package (E3)", () => {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();

  it("every JUR: key the method skills, shared and the router name resolves to a non-empty module", () => {
    const used = new Map<string, string>();
    for (const skill of METHOD_SKILLS) {
      for (const file of markdownFiles(path.join(CORPUS, skill))) {
        for (const key of fs.readFileSync(file, "utf8").match(/JUR:[a-z0-9-]+/gu) ?? []) used.set(key, path.relative(CORPUS, file));
      }
    }
    expect(used.size).toBeGreaterThan(80);
    for (const [key, where] of used) {
      const resolved = registry.resolveResource("analizator-umow-v1", key);
      expect(resolved, `${key} (${where})`).toBeTruthy();
      expect(fs.statSync(resolved!).size, key).toBeGreaterThan(200);
      expect(resolved!.replaceAll("\\", "/"), key).toContain("/prawo-polskie-v2/");
    }
  });

  it("no national-law module is left in an executive skill or in shared under its old name", () => {
    for (const [key, module] of registry.jurisdictionModules()) {
      if (key === "JUR:agent-weryfikator-isap") continue; // a plugin agent stays in shared/agents/
      if (/^(?:prawny-router-v3|prawo-polskie-v2)\//u.test(module)) continue;
      throw new Error(`${key} → ${module}: outside the jurisdiction package`);
    }
  });

  it("the model reads moved content with read_legal_resource", async () => {
    const runtime = new LegalCorpusToolRuntime(registry);
    const [pzp] = await runtime.runTools([{ id: "1", name: "read_legal_resource", input: { skill: "analizator-umow-v1", path: "JUR:umowy-j7-pzp" } }]);
    expect(pzp?.content).toMatch(/zamówie[nń]/iu);
    const [canon] = await runtime.runTools([{ id: "2", name: "read_legal_resource", input: { skill: "pisma-proste-v2", path: "view JUR:weryfikacja-przepisow-kanon" } }]);
    expect(canon?.content).toMatch(/HARD GATE|HARDGATE/u);
  });

  it("the skill's module map loads a moved module by key (analizator-dowodow-v3 → MX-dziedziny)", () => {
    const modules = skillModules(registry, "analizator-dowodow-v3", { text: "Oceń te maile.\nmateriał zawiera dowody do oceny (dokumenty)" });
    const entry = { resource: "JUR:dowody-mx-dziedziny", why: "test", condition: "" } as never;
    const { loaded } = loadModules(registry, "analizator-dowodow-v3", [...modules, entry], new Set());
    const mx = loaded.find((item) => item.resource === "JUR:dowody-mx-dziedziny");
    expect(mx?.content.length).toBeGreaterThan(500);
  });

  it("a simple letter's schema comes from the package by key (pisma-proste-v2 → SPA)", () => {
    const modules = skillModules(registry, "pisma-proste-v2", { text: "Napisz sprzeciw od nakazu zapłaty" });
    const { loaded } = loadModules(registry, "pisma-proste-v2", modules, new Set());
    expect(loaded.find((item) => item.resource === "JUR:pisma-proste-spa-sprzeciw")?.content).toMatch(/sprzeciw/iu);
  });
});

describe("another jurisdiction's package replaces the national law (LEX_JURISDICTION_PACK)", () => {
  const roots: string[] = [];
  const saved = process.env.LEX_JURISDICTION_PACK;
  afterEach(() => {
    if (saved === undefined) delete process.env.LEX_JURISDICTION_PACK;
    else process.env.LEX_JURISDICTION_PACK = saved;
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function corpus(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-jur-swap-"));
    roots.push(root);
    for (const [skill, body] of [["pisma-proste-v2", "view JUR:terminy-procesowe"], ["prawo-polskie-v2", "PL"], ["prawo-testowe-v1", "TEST"]]) {
      fs.mkdirSync(path.join(root, skill!), { recursive: true });
      fs.writeFileSync(path.join(root, skill!, "SKILL.md"), `---\nname: ${skill}\nversion: "1.0"\ndescription: "test"\n---\n${body}\n`);
    }
    fs.mkdirSync(path.join(root, "prawo-polskie-v2", "krajowe"), { recursive: true });
    fs.writeFileSync(path.join(root, "prawo-polskie-v2", "krajowe", "terminy.md"), "# Terminy PL: art. 505 § 1 KPC\n");
    writeJurisdictionManifest(root, { "JUR:terminy-procesowe": "prawo-polskie-v2/krajowe/terminy.md" });
    fs.writeFileSync(path.join(root, "prawo-testowe-v1", "terminy.md"), "# Terminy kraju testowego: § 7 ZPO\n");
    fs.writeFileSync(
      path.join(root, "prawo-testowe-v1", "JURYSDYKCJA.md"),
      "| Klucz | Moduł | Zakres |\n|---|---|---|\n| `JUR:terminy-procesowe` | `prawo-testowe-v1/terminy.md` | terminy |\n"
    );
    return root;
  }

  it("the same key reads the selected country's module; the default is Polish law", async () => {
    const root = corpus();
    delete process.env.LEX_JURISDICTION_PACK;
    const polish = new LexSkillRegistry(root);
    polish.scan();
    expect(fs.readFileSync(polish.resolveResource("pisma-proste-v2", "JUR:terminy-procesowe")!, "utf8")).toMatch(/KPC/u);

    process.env.LEX_JURISDICTION_PACK = "prawo-testowe-v1";
    const other = new LexSkillRegistry(root);
    other.scan();
    const [result] = await new LegalCorpusToolRuntime(other).runTools([
      { id: "1", name: "read_legal_resource", input: { skill: "pisma-proste-v2", path: "JUR:terminy-procesowe" } }
    ]);
    expect(result?.content).toMatch(/ZPO/u);
    expect(result?.content).not.toMatch(/KPC/u);
    // A key the selected package lacks resolves to nothing (fail-closed), never to Polish law.
    expect(other.resolveResource("pisma-proste-v2", "JUR:oplaty-sadowe")).toBeNull();
  });
});
