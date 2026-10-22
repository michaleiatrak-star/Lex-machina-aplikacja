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
        "lex-answer-document-skills-"
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
        "lex-answer-document-data-"
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
  // Fields of the next result beyond its answer (courtsFound of court_for_address…).
  const extras: Array<Partial<SessionExecutionResponse>> = [];
  const execute =
    vi.fn<SessionExecutor["execute"]>(async (input) => {
      const next = answers.shift() ?? "brak";
      const blocked = next.startsWith("BLOCKED:");
      const result: SessionExecutionResponse = {
        sessionId: "session-answer-letter",
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
      Object.assign(result, extras.shift() ?? {});
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
    extras,
    generate,
    createReady
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

const LETTER = [
  "Przygotowałem wersję dokumentu na podstawie poprzedniego wyniku.",
  "",
  "**ODPOWIEDŹ NA WEZWANIE DO ZAPŁATY**",
  "",
  "Jan Kowalski  ",
  "ul. Polna 1, 00-001 Warszawa",
  "",
  "Do:  ",
  "Kancelaria Przykładowa  ",
  "ul. Leśna 2, 00-002 Warszawa",
  "",
  "W odpowiedzi na pismo z 3 grudnia 2024 r. kwestionuję roszczenie co do zasady i wysokości.",
  "",
  "Wzywam zatem do wycofania żądania zapłaty kwoty 60 000 zł.",
  "",
  "Jan Kowalski",
  "",
  "### Status dokumentu",
  "",
  "- Nie dodano nowych wątków."
].join("\n");

const ANALYSIS = [
  "## Analiza odpowiedzialności za zwłokę",
  "",
  "### Stan faktyczny",
  "Dłużnik pozostaje w zwłoce ze spełnieniem świadczenia pieniężnego od kilku miesięcy, mimo wezwania do zapłaty doręczonego w terminie.",
  "",
  "### Wnioski",
  "- Wierzyciel może żądać odsetek za opóźnienie bez wykazywania szkody.",
  "- Warto ponowić wezwanie i wyznaczyć ostateczny termin zapłaty przed wniesieniem pozwu.",
  "",
  "⚖️ Ważna informacja: to nie jest porada prawna."
].join("\n");

describe("plik pisma z odpowiedzi, która sama jest pismem", () => {
  it("odpowiedź-pismo zostaje w sprawie ze śladem sesji; „Generuj dokument” tworzy plik mechanicznie, bez tury modelu", async () => {
    const current = fixture();
    const { authorization, caseId } = await bootstrapCase(current);
    const body = { provider: "openai", model: "gpt-test", primarySkill: DR, mode: "PRAWNIK" };
    const generate = (extra: Record<string, unknown>) =>
      request(current.app)
        .post(`/api/cases/${caseId}/artifacts/generate`)
        .set("Authorization", authorization)
        .send({ ...body, query: "ok daj mi pismo", format: "docx", documentType: "letter", styleProfile: "lex-office-tnr-v1", ...extra });

    // No letter kept yet: the mechanical file is refused, the model is not asked.
    await generate({ source: "ANSWER" }).expect(409, { error: "ANSWER_DOCUMENT_MISSING" });

    current.answers.push(LETTER);
    const turn = await request(current.app)
      .post("/api/sessions/execute")
      .set("Authorization", authorization)
      .send({ ...body, query: "Przygotuj dokument.", knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 } })
      .expect(200);
    expect(turn.body.answerDocument).toEqual({ sessionId: "session-answer-letter" });

    // Another session's answer: not this one.
    await generate({ source: "ANSWER", answerSessionId: "session-other" }).expect(409, { error: "ANSWER_DOCUMENT_MISSING" });

    const file = await generate({ source: "ANSWER", answerSessionId: "session-answer-letter", filename: "LexMachina-pismo.docx" }).expect(201);
    expect(file.body).toMatchObject({ sessionId: "session-answer-letter", readyForDownload: true, mechanical: true });
    expect(current.generate).not.toHaveBeenCalled();
    const ready = (current.createReady.mock.calls as unknown as unknown[][])[0]![0] as { ast: { documentType: string; styleProfile: string; blocks: Array<{ type: string; content?: Array<{ text?: string }> }> }; validationContext: { sourceSessionId: string }; filename: string };
    expect(ready.validationContext.sourceSessionId).toBe("session-answer-letter");
    expect(ready.filename).toBe("LexMachina-pismo.docx");
    expect(ready.ast).toMatchObject({ documentType: "letter", styleProfile: "lex-office-tnr-v1" });
    const texts = ready.ast.blocks.map((block) => (block.content ?? []).map((node) => node.text ?? "").join(""));
    expect(texts).toContain("ODPOWIEDŹ NA WEZWANIE DO ZAPŁATY");
    expect(texts).toContain("W odpowiedzi na pismo z 3 grudnia 2024 r. kwestionuję roszczenie co do zasady i wysokości.");
    expect(texts.join("\n")).not.toMatch(/Przygotowałem|Status dokumentu|Nie dodano/u);
    expect(ready.ast.blocks.at(-1)!.type).toBe("signature");
  });

  it("odpowiedź-analiza (model lokalny) daje plik opinii mechanicznie, bez JSON AST modelu", async () => {
    const current = fixture();
    const { authorization, caseId } = await bootstrapCase(current);
    const body = { provider: "openai", model: "gpt-test", primarySkill: DR, mode: "PRAWNIK" };
    current.answers.push(ANALYSIS);
    const turn = await request(current.app)
      .post("/api/sessions/execute")
      .set("Authorization", authorization)
      .send({ ...body, query: "przeanalizuj zagadnienie", knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 } })
      .expect(200);
    expect(turn.body.answerDocument).toBeDefined();
    const file = await request(current.app)
      .post(`/api/cases/${caseId}/artifacts/generate`)
      .set("Authorization", authorization)
      .send({ ...body, query: "wygeneruj odpowiedź w postaci dokumentu docx", format: "docx", documentType: "letter", styleProfile: "lex-office-tnr-v1", source: "ANSWER", answerSessionId: turn.body.answerDocument.sessionId })
      .expect(201);
    expect(file.body).toMatchObject({ mechanical: true, readyForDownload: true });
    expect(current.generate).not.toHaveBeenCalled();
    const ready = (current.createReady.mock.calls as unknown as unknown[][])[0]![0] as { ast: { documentType: string; blocks: Array<{ type: string; content?: Array<{ text?: string }> }> } };
    expect(ready.ast.documentType).toBe("opinion");
    const texts = ready.ast.blocks.map((block) => (block.content ?? []).map((node) => node.text ?? "").join(""));
    expect(texts).toContain("ANALIZA ODPOWIEDZIALNOŚCI ZA ZWŁOKĘ");
    expect(texts.join("\n")).toContain("Dłużnik pozostaje w zwłoce");
    expect(texts.join("\n")).not.toMatch(/Ważna informacja/u);
  });

  it("korekta faktu w trwającej sprawie: lekka ścieżka bez skilli, korekta w rejestrze prac sprawy", async () => {
    const current = fixture();
    const { authorization, caseId } = await bootstrapCase(current);
    current.answers.push("Przyjmuję korektę: to jedna spółka — Human Park Global.");
    const query = "Użytkownik: Przeanalizuj porozumienie.\n\nAsystent: Strony: Human Park oraz Human Park Global.\n\nUżytkownik: to ta sama firma, tylko błąd ocr - to cały czas Human Park Global";
    const turn = await request(current.app)
      .post("/api/sessions/execute")
      .set("Authorization", authorization)
      .send({ query, provider: "openai", model: "gpt-test", primarySkill: "AUTO", mode: "PRAWNIK", knowledge: { caseId, includeCase: true, includeFirm: false, limit: 8 } })
      .expect(200);
    expect(turn.body.status).toBe("DRAFT_PRESENTABLE");
    const input = current.execute.mock.calls.at(-1)![0] as { conversationalOnly?: boolean; factCorrection?: boolean };
    expect(input).toMatchObject({ conversationalOnly: true, factCorrection: true });
    const memory = await request(current.app).get(`/api/cases/${caseId}/memory`).set("Authorization", authorization).expect(200);
    expect(JSON.stringify(memory.body.work)).toContain("KOREKTA UŻYTKOWNIKA (obowiązuje): „to ta sama firma, tylko błąd ocr - to cały czas Human Park Global”");
  });

  it("odpowiedź bez pisma (pytania) nie zostaje jako pismo", async () => {
    const current = fixture();
    const { authorization, caseId } = await bootstrapCase(current);
    current.answers.push("Czy wezwanie zostało doręczone? Podaj datę doręczenia, a przygotuję odpowiedź.");
    const turn = await request(current.app)
      .post("/api/sessions/execute")
      .set("Authorization", authorization)
      .send({ query: "Odpowiedz na wezwanie.", provider: "openai", model: "gpt-test", primarySkill: DR, mode: "PRAWNIK", knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 } })
      .expect(200);
    expect(turn.body.answerDocument).toBeUndefined();
  });
});
