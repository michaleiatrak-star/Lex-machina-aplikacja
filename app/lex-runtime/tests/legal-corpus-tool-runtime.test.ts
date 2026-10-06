import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";
import {
  LegalCorpusToolRuntime
} from "../src/legal-corpus-tool-runtime.js";
import {
  LexSkillRegistry
} from "../src/registry.js";

const roots: string[] = [];
const DR =
  "dr-02-prawo-cywilne-rodzinne-gospodarcze";

function fixture():
  LexSkillRegistry {
  const root = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "lex-g36-corpus-"
    )
  );
  roots.push(root);

  for (
    const [name, body]
    of [
      ["shared", "# shared\n"],
      ["prawny-router-v3", "# router\n"],
      ["prawo-polskie-v2", "# prawo\n"],
      [DR, "# dr\n"]
    ] as const
  ) {
    const dir =
      path.join(root, name);
    fs.mkdirSync(
      dir,
      { recursive: true }
    );
    fs.writeFileSync(
      path.join(
        dir,
        "SKILL.md"
      ),
      `---\nname: ${name}\nversion: "1.0"\n---\n${body}`
    );
  }

  fs.writeFileSync(
    path.join(
      root,
      "shared",
      "PRAWO-HARDGATE.md"
    ),
    "# hard gate\n"
  );

  const modules =
    path.join(
      root,
      DR,
      "modules"
    );
  fs.mkdirSync(
    modules,
    { recursive: true }
  );
  fs.writeFileSync(
    path.join(
      modules,
      "mod-KC.md"
    ),
    "A".repeat(50_000) +
      "\nKONIEC\n"
  );

  const registry =
    new LexSkillRegistry(
      root
    );
  expect(
    registry.scan()
  ).toEqual([]);
  return registry;
}

afterEach(() => {
  while (roots.length) {
    fs.rmSync(
      roots.pop()!,
      {
        recursive: true,
        force: true
      }
    );
  }
});

describe("G36 legal corpus runtime", () => {
  it("lists skills/resources and reads the full module by pagination", async () => {
    const runtime =
      new LegalCorpusToolRuntime(
        fixture()
      );

    const listedSkills =
      await runtime.runTools([
        {
          id: "1",
          name:
            "list_legal_skills",
          input: {}
        }
      ]);
    expect(
      listedSkills[0]
        ?.content
    ).toContain(DR);

    const listedResources =
      await runtime.runTools([
        {
          id: "2",
          name:
            "list_legal_resources",
          input: {
            skill: DR,
            prefix:
              "modules/"
          }
        }
      ]);
    expect(
      listedResources[0]
        ?.content
    ).toContain(
      "modules/mod-KC.md"
    );

    const first =
      JSON.parse(
        (
          await runtime
            .runTools([
              {
                id: "3",
                name:
                  "read_legal_resource",
                input: {
                  skill: DR,
                  path:
                    "modules/mod-KC.md",
                  maxChars:
                    40_000
                }
              }
            ])
        )[0]!.content
      ) as {
        content: string;
        nextOffset:
          number | null;
      };
    expect(
      first.content.length
    ).toBe(40_000);
    expect(
      first.nextOffset
    ).toBe(40_000);

    const second =
      JSON.parse(
        (
          await runtime
            .runTools([
              {
                id: "4",
                name:
                  "read_legal_resource",
                input: {
                  skill: DR,
                  path:
                    "modules/mod-KC.md",
                  offset:
                    first.nextOffset,
                  maxChars:
                    40_000
                }
              }
            ])
        )[0]!.content
      ) as {
        content: string;
        nextOffset:
          number | null;
      };
    expect(
      second.content
    ).toContain(
      "KONIEC"
    );
    expect(
      second.nextOffset
    ).toBeNull();
  });

  it("allows canonical shared reads but blocks filesystem traversal", async () => {
    const runtime =
      new LegalCorpusToolRuntime(
        fixture()
      );

    const shared =
      await runtime.runTools([
        {
          id: "1",
          name:
            "read_legal_resource",
          input: {
            skill: DR,
            path:
              "shared/PRAWO-HARDGATE.md"
          }
        }
      ]);
    expect(
      shared[0]?.content
    ).toContain(
      "# hard gate"
    );

    const blocked =
      await runtime.runTools([
        {
          id: "2",
          name:
            "read_legal_resource",
          input: {
            skill: DR,
            path:
              "../../etc/passwd"
          }
        }
      ]);
    expect(
      blocked[0]?.content
    ).toContain(
      '"status":"BLOCKED"'
    );
    expect(
      runtime.auditEvents()
        .at(-1)
    ).toMatchObject({
      decision: "BLOCK"
    });
  });
});

describe("model skill selection mode", () => {
  function withCriminalDomain(): LexSkillRegistry {
    const registry = fixture();
    const dir = path.join(registry.root, "dr-03-prawo-karne");
    fs.mkdirSync(path.join(dir, "modules"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: dr-03-prawo-karne\nversion: \"1.0\"\n---\n# karne\n"
    );
    fs.writeFileSync(
      path.join(dir, "modules", "mod-KK-kwalifikator-karnomaterialny.md"),
      "# kwalifikator\n"
    );
    registry.scan();
    return registry;
  }

  const read = (skill: string, file: string, id = skill + file) => ({
    id,
    name: "read_legal_resource",
    input: { skill, path: file }
  });

  it("delivers prawny-router-v3 with the first other legal resource instead of refusing it", async () => {
    const runtime = new LegalCorpusToolRuntime(fixture(), { modelSelectsSkills: true });
    const [first] = await runtime.runTools([read(DR, "SKILL.md")]);
    const body = JSON.parse(first!.content);
    expect(body.status).toBe("OK");
    expect(body.requiredRouter).toMatchObject({ path: expect.stringMatching(/SKILL\.md$/) });
    expect(runtime.auditEvents()[0]).toMatchObject({ decision: "ALLOW", detail: { deliveredWith: expect.any(String) } });
    expect(runtime.modelSkillSelection()).toEqual({
      primarySkill: DR,
      loadedSkills: ["prawny-router-v3", DR],
      domainSkills: [DR],
      executionSkills: []
    });
  });

  it("runs a router read batched after other reads first", async () => {
    const runtime = new LegalCorpusToolRuntime(fixture(), { modelSelectsSkills: true });
    const results = await runtime.runTools([
      read(DR, "SKILL.md"),
      read("prawny-router-v3", "SKILL.md")
    ]);
    expect(results.map((item) => item.tool_use_id)).toEqual([DR + "SKILL.md", "prawny-router-v3SKILL.md"]);
    expect(results.map((item) => JSON.parse(item.content).status)).toEqual(["OK", "OK"]);
    expect(JSON.parse(results[0]!.content).requiredRouter).toBeUndefined();
    expect(runtime.modelSkillSelection()).toEqual({
      primarySkill: DR,
      loadedSkills: ["prawny-router-v3", DR],
      domainSkills: [DR],
      executionSkills: []
    });
  });

  it("delivers the criminal qualifier with the first DR-03 skill entry", async () => {
    const runtime = new LegalCorpusToolRuntime(withCriminalDomain(), { modelSelectsSkills: true });
    await runtime.runTools([read("prawny-router-v3", "SKILL.md")]);
    const [first] = await runtime.runTools([read("dr-03-prawo-karne", "SKILL.md")]);
    expect(JSON.parse(first!.content).requiredModule).toMatchObject({
      path: "dr-03-prawo-karne/modules/mod-KK-kwalifikator-karnomaterialny.md",
      content: "# kwalifikator\n"
    });
    const [again] = await runtime.runTools([read("dr-03-prawo-karne", "SKILL.md", "again")]);
    expect(JSON.parse(again!.content).requiredModule).toBeUndefined();
  });

  it("returns no second copy of a resource the application already put in context", async () => {
    const runtime = new LegalCorpusToolRuntime(withCriminalDomain(), { modelSelectsSkills: true });
    runtime.setInContext(new Set([
      "prawny-router-v3/SKILL.md",
      "dr-03-prawo-karne/modules/mod-KK-kwalifikator-karnomaterialny.md"
    ]));
    // The router is in context: the domain read neither waits for it nor carries it.
    const [entry] = await runtime.runTools([read("dr-03-prawo-karne", "SKILL.md")]);
    const body = JSON.parse(entry!.content);
    expect(body.status).toBe("OK");
    expect(body.requiredRouter).toBeUndefined();
    // Nor the qualifier the application already gave.
    expect(body.requiredModule).toBeUndefined();
    const [qualifier] = await runtime.runTools([read("dr-03-prawo-karne", "modules/mod-KK-kwalifikator-karnomaterialny.md")]);
    expect(JSON.parse(qualifier!.content)).toMatchObject({ status: "OK", inContext: true, content: "" });
    const [router] = await runtime.runTools([read("prawny-router-v3", "SKILL.md")]);
    expect(JSON.parse(router!.content)).toMatchObject({ status: "OK", inContext: true, content: "" });
    expect(runtime.modelSkillSelection().loadedSkills).toEqual(["prawny-router-v3", "dr-03-prawo-karne"]);
    expect(runtime.missingCriminalQualifier()).toBeNull();
  });

  it("keeps the preloaded router path unchanged outside model selection", async () => {
    const runtime = new LegalCorpusToolRuntime(fixture());
    const [result] = await runtime.runTools([read(DR, "SKILL.md")]);
    expect(JSON.parse(result!.content).status).toBe("OK");
  });

  it("delivers the only matching file for a mistyped module path", async () => {
    const registry = fixture();
    const modules = path.join(registry.root, DR, "modules");
    fs.writeFileSync(path.join(modules, "mod-KC-umowy-nazwane.md"), "# umowy\n");
    const runtime = new LegalCorpusToolRuntime(registry);
    const results = await runtime.runTools([
      read(DR, "modules/mod-KC", "no-ext"),
      read(DR, "mod-KC-umowy-nazwane.md", "no-dir"),
      read("dr-02", "SKILL.md", "short-skill"),
      read(DR, "modules/mod-kc-umowy", "prefix")
    ]);
    const parsed = results.map((result) => JSON.parse(result.content));
    expect(parsed[0]).toMatchObject({ status: "OK", path: `${DR}/modules/mod-KC.md`, requestedPath: `${DR}/modules/mod-KC` });
    expect(parsed[1]).toMatchObject({ status: "OK", path: `${DR}/modules/mod-KC-umowy-nazwane.md` });
    expect(parsed[2]).toMatchObject({ status: "OK", path: `${DR}/SKILL.md`, requestedPath: "dr-02/SKILL.md" });
    expect(parsed[3]).toMatchObject({ status: "OK", path: `${DR}/modules/mod-KC-umowy-nazwane.md` });
    expect(runtime.auditEvents().filter((event) => event.detail?.resolvedFrom)).toHaveLength(4);
  });

  it("returns candidates instead of guessing when several files match", async () => {
    const registry = fixture();
    const modules = path.join(registry.root, DR, "modules");
    fs.writeFileSync(path.join(modules, "mod-KC-umowy.md"), "# umowy\n");
    fs.writeFileSync(path.join(modules, "mod-KC-spadki.md"), "# spadki\n");
    const runtime = new LegalCorpusToolRuntime(registry);
    const [several, none] = (await runtime.runTools([
      read(DR, "modules/mod-K.md", "several"),
      read(DR, "modules/xyz-abc.md", "none")
    ])).map((result) => JSON.parse(result.content));
    expect(several.status).toBe("NOT_FOUND");
    expect(several.candidates).toEqual(expect.arrayContaining(["modules/mod-KC-umowy.md", "modules/mod-KC-spadki.md"]));
    expect(several.content).toBeUndefined();
    expect(none).toMatchObject({ status: "NOT_FOUND", error: "LEGAL_RESOURCE_NOT_FOUND", candidates: [] });
    expect(runtime.auditEvents().every((event) => event.decision === "BLOCK")).toBe(true);
  });

  it("resolves a wrong version number and a module kept in another skill", async () => {
    const registry = fixture();
    fs.writeFileSync(path.join(registry.root, DR, "modules", "mod-KC-umowy-v3.md"), "# v3\n");
    const other = path.join(registry.root, "prawo-polskie-v2", "modules");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "mod-mapa-dziedzin.md"), "# mapa\n");
    const runtime = new LegalCorpusToolRuntime(registry);
    const parsed = (await runtime.runTools([
      read(DR, "modules/mod-KC-umowy-v2.md", "file-version"),
      read("prawny-router-v2", "SKILL.md", "skill-version"),
      read(DR, "modules/mod-mapa-dziedzin.md", "other-skill")
    ])).map((result) => JSON.parse(result.content));
    expect(parsed[0]).toMatchObject({ status: "OK", path: `${DR}/modules/mod-KC-umowy-v3.md` });
    expect(parsed[1]).toMatchObject({ status: "OK", path: "prawny-router-v3/SKILL.md", requestedPath: "prawny-router-v2/SKILL.md" });
    expect(parsed[2]).toMatchObject({ status: "OK", path: "prawo-polskie-v2/modules/mod-mapa-dziedzin.md" });
  });
});
