import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  createLexHttpApp
} from "../src/http/app.js";
import {
  registerWorkspaceRoutes
} from "../src/http/workspace-routes.js";
import {
  LexSkillRegistry
} from "../src/registry.js";
import {
  LocalAuthStore
} from "../src/auth/store.js";
import {
  LocalAuthService
} from "../src/auth/service.js";
import {
  AuthSessionManager
} from "../src/auth/session-manager.js";
import {
  LocalCaseFileStore
} from "../src/case-file-store.js";
import {
  LocalCaseAccessService
} from "../src/case-access.js";
import {
  SecureCaseUploadStore
} from "../src/case-secure-store.js";
import {
  SecureCaseArtifactStore
} from "../src/case-artifact-store.js";
import {
  EncryptedCaseWorkspaceStore
} from "../src/case-workspace-store.js";
import {
  SESSION_EXECUTION_INTERNAL,
  type SessionExecutionResponse,
  type SessionExecutor
} from "../src/session-executor.js";

const roots: string[] = [];
const DR =
  "dr-02-prawo-cywilne-rodzinne-gospodarcze";

function writeFixture(
  root: string,
  relative: string,
  content: string
): void {
  const target =
    path.join(
      root,
      ...relative.split("/")
    );
  fs.mkdirSync(
    path.dirname(target),
    { recursive: true }
  );
  fs.writeFileSync(
    target,
    content,
    "utf8"
  );
}

function registry():
  LexSkillRegistry {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "lex-long-document-skills-"
      )
    );
  roots.push(root);

  for (
    const [
      name,
      type,
      description
    ] of [
      [
        "prawo-polskie-v2",
        "domain-router",
        "routing polskiego prawa"
      ],
      [
        DR,
        "domain",
        "cywilne gospodarcze"
      ],
      [
        "chronologia-sprawy-v1",
        "executive-chronologia",
        "oś czasu zdarzeń dokumentów i terminów"
      ]
    ] as const
  ) {
    writeFixture(
      root,
      `${name}/SKILL.md`,
      [
        "---",
        `name: ${name}`,
        'version: "test"',
        `type: ${type}`,
        `description: "${description}"`,
        "---",
        "# fixture"
      ].join("\n")
    );
  }

  writeFixture(
    root,
    "prawo-polskie-v2/ROUTING-MAP.md",
    DR + "\n"
  );

  for (
    const relative
    of [
      "shared/PRAWO-HARDGATE.md",
      "shared/SELF-CHECK-ANTY-FASADA.md",
      "shared/MOD-OS-CZASU-PRZESLANEK.md",
      "chronologia-sprawy-v1/references/ekstrakcja-zdarzen.md",
      "chronologia-sprawy-v1/references/sprzecznosci-dat.md"
    ]
  ) {
    writeFixture(
      root,
      relative,
      `fixture:${relative}\n`
    );
  }

  const result =
    new LexSkillRegistry(root);
  expect(result.scan())
    .toEqual([]);
  return result;
}

function fixture() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "lex-long-document-data-"
      )
    );
  roots.push(root);

  const authStore =
    new LocalAuthStore({
      rootDir: root
    });
  const auth =
    new LocalAuthService(
      authStore,
      {
        sessionManager:
          new AuthSessionManager({
            scheduleExpiryTimers:
              false
          }),
        kdf: {
          memoryKiB: 1024,
          iterations: 1,
          parallelism: 1,
          keyLength: 32,
          version: 1
        }
      }
    );
  const files =
    new LocalCaseFileStore({
      rootDir: root
    });
  const cases =
    new LocalCaseAccessService(
      authStore,
      auth,
      files
    );
  const uploads =
    new SecureCaseUploadStore({
      rootDir: root
    });
  const artifacts =
    new SecureCaseArtifactStore({
      rootDir: root
    });
  const workspace =
    new EncryptedCaseWorkspaceStore({
      rootDir: root
    });

  const answers: string[] = [];
  const execute =
    vi.fn<SessionExecutor["execute"]>(async (input) => {
      const next = answers.shift() ?? "brak";
      const blocked = next.startsWith("BLOCKED:");
      const result: SessionExecutionResponse = {
        sessionId: "session-long-document",
        status: blocked ? "BLOCKED" : "DRAFT_PRESENTABLE",
        provider: input.provider,
        model: input.model,
        primarySkill: input.primarySkill,
        answer: blocked ? "" : next,
        finalization: blocked ? "DEGRADED" : "PASS",
        blockedReferences: blocked ? [{ claim: next.slice(8), kind: "statute", line: 3, status: "UNVERIFIED_MARKED" }] : [],
        verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
        evidence: [],
        audit: { result: "PASS", eventCount: 0, closed: true }
      };
      Object.defineProperty(result, SESSION_EXECUTION_INTERNAL, { value: { verificationRecords: [], auditEvents: [] }, enumerable: false });
      return result;
    });

  const generate = vi.fn(async (_request: { sourceText?: { label: string; text: string }; processRenderOnly?: unknown }) => ({
    ast: { schemaVersion: "1", documentType: "letter", locale: "pl-PL", styleProfile: "lex-classic-clean-v1", blocks: [{ type: "paragraph", content: [{ type: "text", text: "Regulamin" }] }] as unknown[] },
    aliasesUsed: [],
    sessionId: "session-generate",
    validationContext: {}
  }));
  const createReady = vi.fn(async () => ({
    artifact: { artifactId: "artifact_" + "b".repeat(32), filename: "regulamin.docx" },
    format: "docx",
    sha256: "b".repeat(64)
  }));

  const core =
    createLexHttpApp({
      registry: registry(),
      modelCatalog: {
        list:
          vi.fn(
            async () => []
          )
      },
      authService: auth,
      caseFileStore: files,
      secureCaseUploadStore:
        uploads,
      secureCaseArtifactStore:
        artifacts,
      caseAccessService:
        cases,
      chronologyWorkflowStore:
        workspace,
      caseMemoryStore:
        workspace,
      sessionExecutor: {
        execute
      },
      documentAstGenerator: { generate } as never,
      documentAuthoringService: { createReady } as never,
      documentService: { forget: vi.fn(() => false) } as never
    });

  const app = express();
  app.use(
    express.json({
      limit: "2mb"
    })
  );
  registerWorkspaceRoutes(
    app,
    {
      authService: auth,
      caseAccessService:
        cases,
      uploads,
      templates: {
        templatesDir:
          path.join(
            root,
            "templates"
          ),
        listTemplates:
          vi.fn(
            async () => []
          ),
        readTemplate:
          vi.fn(
            async () => {
              throw new Error(
                "TEST_TEMPLATE_NOT_USED"
              );
            }
          )
      },
      privacyVaults: {
        deleteDocumentVault:
          vi.fn(
            async () => false
          )
      },
      documentService: {
        forget:
          vi.fn(
            () => false
          )
      },
      workspace,
      rootDir: root
    }
  );
  app.use(core);

  return {
    root,
    app,
    auth,
    execute,
    answers,
    generate
  };
}

async function bootstrapCase(
  current:
    ReturnType<
      typeof fixture
    >
) {
  const bootstrap =
    await request(
      current.app
    )
      .post(
        "/api/auth/bootstrap"
      )
      .send({
        loginName:
          "chronology-owner",
        displayName:
          "Chronology Owner",
        password:
          "G39I chronology strong password 2026"
      })
      .expect(201);
  const authorization =
    `Bearer ${String(
      bootstrap.body
        .sessionToken
    )}`;

  const created =
    await request(
      current.app
    )
      .post(
        "/api/cases"
      )
      .set(
        "Authorization",
        authorization
      )
      .send({
        displayName:
          "Chronology E2E"
      })
      .expect(201);

  return {
    authorization,
    caseId:
      String(
        created.body.caseId
      )
  };
}

afterEach(() => {
  for (
    const root
    of roots.splice(0)
  ) {
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true
      }
    );
  }
});

const part = (name: string) => fs.readFileSync(new URL(`./fixtures/long-document/${name}`, import.meta.url), "utf8");

describe("długie pismo w częściach: czat i plik", () => {
  it("plan i część 1, kontynuacja z blokiem aplikacji, błędna część do poprawy, komplet", async () => {
    const current = fixture();
    const { authorization, caseId } = await bootstrapCase(current);
    const send = (query: string) =>
      request(current.app)
        .post("/api/sessions/execute")
        .set("Authorization", authorization)
        .send({ query, provider: "openai", model: "gpt-test", primarySkill: DR, mode: "PRAWNIK", knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 } })
        .expect(200);

    current.answers.push(`Regulamin jest długi: powstanie w 3 częściach.\n\n\`\`\`plan-pisma\n${part("regulamin-plan.json")}\n\`\`\`\n\n${part("regulamin-1.txt")}`);
    const first = await send("Napisz pełny regulamin sklepu internetowego.");
    expect(first.body.longDocument).toMatchObject({ part: 1, parts: 3, ok: true, complete: false, next: 2 });
    expect(first.body.answer).toContain("Część 1 z 3");
    expect(first.body.answer).not.toContain("plan-pisma");
    expect(first.body.answer).not.toContain("[KONIEC CZĘŚCI");
    expect(first.body.pipelineNext.choices[0]).toMatchObject({ kind: "CONTINUE", reason: "Część 2 z 3" });

    // Part 2 without its first paragraph (§ 16): rejected, the same part asked for again.
    current.answers.push(part("regulamin-2.txt").replace(/@SEKCJA: § 16\.[\s\S]*?(?=@SEKCJA: § 17\.)/u, ""));
    const faulty = await send("Kontynuuj");
    expect(String(current.execute.mock.calls[1]?.[0].query)).toContain("# DŁUGIE PISMO — CZĘŚĆ 2 Z 3");
    expect(String(current.execute.mock.calls[1]?.[0].query)).toContain("Ostatni paragraf poprzednich części: § 15.");
    expect(faulty.body.longDocument).toMatchObject({ part: 2, ok: false, next: 2 });
    expect(faulty.body.longDocument.problems.join(" ")).toMatch(/16/u);
    expect(faulty.body.pipelineNext.choices[0].reason).toMatch(/^Popraw część 2 z 3/u);

    current.answers.push(part("regulamin-2.txt"));
    const fixed = await send("Popraw część 2 z 3");
    expect(String(current.execute.mock.calls[2]?.[0].query)).toContain("POPRAW poprzednią wersję tej części");
    expect(fixed.body.longDocument).toMatchObject({ part: 2, ok: true, next: 3 });

    // Part 3 blocked by the gates (a provision cited under the wrong act): a rejected part with
    // the citation to correct, asked for again, not a dead end.
    current.answers.push("BLOCKED:art. 43a KC");
    const blockedTurn = await send("dalej");
    expect(blockedTurn.body.status).toBe("BLOCKED");
    expect(blockedTurn.body.longDocument).toMatchObject({ part: 3, ok: false, next: 3 });
    expect(blockedTurn.body.longDocument.problems[0]).toMatch(/^art\. 43a KC: niezweryfikowany w ELI/u);
    expect(blockedTurn.body.pipelineNext.choices[0].reason).toMatch(/^Popraw część 3 z 3: art\. 43a KC/u);

    current.answers.push(part("regulamin-3.txt"));
    const last = await send("Popraw część 3 z 3.");
    expect(String(current.execute.mock.calls.at(-1)?.[0].query)).toContain("POPRAW poprzednią wersję tej części: art. 43a KC");
    expect(last.body.longDocument).toMatchObject({ part: 3, ok: true, complete: true, next: null });
    const id = String(last.body.longDocument.id);
    expect(id).toBe(String(first.body.longDocument.id));
    expect(last.body.pipelineNext.choices[0]).toEqual({ skill: DR, kind: "DOCUMENT", reason: "jeden plik z 3 części", longDocumentId: id });

    const file = (longDocumentId: string) =>
      request(current.app)
        .post(`/api/cases/${caseId}/artifacts/generate`)
        .set("Authorization", authorization)
        .send({ query: "Przygotuj plik .docx.", provider: "openai", model: "gpt-test", primarySkill: DR, mode: "PRAWNIK", format: "docx", documentType: "letter", styleProfile: "lex-classic-clean-v1", attachments: [], longDocumentId });
    expect((await file("00000000-0000-4000-8000-000000000000")).status).toBe(409);
    expect(current.generate).not.toHaveBeenCalled();
    const made = await file(id);
    expect(made.status).toBe(201);
    const source = current.generate.mock.calls[0]?.[0].sourceText;
    expect(source?.label).toBe("długie pismo „Regulamin sklepu internetowego „ZielonySad.pl”” z 3 części");
    for (const k of [1, 2, 3]) expect(source?.text).toContain(part(`regulamin-${k}.txt`).split("\n")[1]!.trim());
    expect(source?.text).not.toMatch(/\[(?:KONIEC )?CZĘŚCI? \d/u);

    // A later ordinary question: no continuation block once the document is complete.
    current.answers.push("Odpowiedź.");
    await send("Kontynuuj");
    expect(String(current.execute.mock.calls.at(-1)?.[0].query)).not.toContain("# DŁUGIE PISMO");
  });

  it("„dalej” i „Kontynuuj” (AUTO) przy niedokończonym piśmie: kolejna część, nie rozmowa", async () => {
    const current = fixture();
    const { authorization, caseId } = await bootstrapCase(current);
    const send = (query: string, primarySkill: string) =>
      request(current.app)
        .post("/api/sessions/execute")
        .set("Authorization", authorization)
        .send({ query, provider: "openai", model: "gpt-test", primarySkill, mode: "PRAWNIK", knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 } })
        .expect(200);
    current.answers.push(`Regulamin jest długi: powstanie w 3 częściach.\n\n\`\`\`plan-pisma\n${part("regulamin-plan.json")}\n\`\`\`\n\n${part("regulamin-1.txt")}`);
    await send("Napisz pełny regulamin sklepu internetowego.", DR);
    for (const message of ["dalej", "Kontynuuj"]) {
      current.answers.push("Odpowiedź.");
      await send(message, "AUTO");
      const call = current.execute.mock.calls.at(-1)?.[0];
      expect(call?.conversationalOnly).not.toBe(true);
      expect(String(call?.query)).toContain("# DŁUGIE PISMO — CZĘŚĆ 2 Z 3");
    }
  });

  it("prośba o część w sprawie (AUTO) idzie ścieżką prawną, nie rozmową", async () => {
    const current = fixture();
    const { authorization, caseId } = await bootstrapCase(current);
    current.answers.push("Odpowiedź.");
    await request(current.app)
      .post("/api/sessions/execute")
      .set("Authorization", authorization)
      .send({ query: "Popraw część 3 z 3.", provider: "openai", model: "gpt-test", primarySkill: "AUTO", mode: "PRAWNIK", knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 } });
    expect(current.execute).toHaveBeenCalled();
    expect(current.execute.mock.calls[0]?.[0].conversationalOnly).not.toBe(true);
  });
});
