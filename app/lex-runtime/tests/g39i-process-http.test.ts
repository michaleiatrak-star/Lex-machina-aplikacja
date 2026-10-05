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
  createLexHttpApp,
  type LexHttpAppOptions
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
  EncryptedCaseWorkspaceStore
} from "../src/case-workspace-store.js";
import type {
  SessionExecutor
} from "../src/session-executor.js";

const roots: string[] = [];
const DR =
  "dr-02-prawo-cywilne-rodzinne-gospodarcze";

function writeFile(
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

function workflowRegistry():
  LexSkillRegistry {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "lex-g39i-http-skills-"
      )
    );
  roots.push(root);

  writeFile(
    root,
    "prawo-polskie-v2/SKILL.md",
    [
      "---",
      "name: prawo-polskie-v2",
      'version: "test"',
      "---",
      "# fixture"
    ].join("\n")
  );
  writeFile(
    root,
    `${DR}/SKILL.md`,
    [
      "---",
      `name: ${DR}`,
      'version: "test"',
      "---",
      "# fixture"
    ].join("\n")
  );
  writeFile(
    root,
    "prawo-polskie-v2/ROUTING-MAP.md",
    `${DR}\n`
  );
  writeFile(
    root,
    "pisma-procesowe-v3/SKILL.md",
    [
      "---",
      "name: pisma-procesowe-v3",
      'version: "test"',
      "type: executive-pisma",
      "---",
      "# fixture"
    ].join("\n")
  );

  for (
    const relative
    of [
      "pisma-procesowe-v3/references/AUTOMAT-STANOW.md",
      "shared/CP-GATE.md",
      "shared/MOD-STEP-TRACKER.md",
      "pisma-procesowe-v3/references/SELF-CHECK-PISMA.md"
    ]
  ) {
    writeFile(
      root,
      relative,
      `fixture:${relative}\n`
    );
  }

  const registry =
    new LexSkillRegistry(root);
  expect(
    registry.scan()
  ).toEqual([]);
  return registry;
}

function fixture() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "lex-g39i-http-data-"
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
  const workspace =
    new EncryptedCaseWorkspaceStore({
      rootDir: root
    });

  const execute =
    vi.fn<
      SessionExecutor["execute"]
    >(
      async (input) => ({
        sessionId:
          "session-g39i",
        status:
          "DRAFT_PRESENTABLE",
        provider:
          input.provider,
        model:
          input.model,
        primarySkill:
          input.primarySkill,
        answer:
          "draft",
        finalization:
          "PASS",
        blockedReferences: [],
        verification: {
          records: 0,
          verified: 0,
          supported: 0,
          unverified: 0
        },
        evidence: [],
        audit: {
          result: "PASS",
          eventCount: 1,
          closed: true
        },
        workflow: {
          id:
            "PROCESS_PLEADING_V1",
          result: "PASS",
          requiredResources: [],
          missingResources: []
        }
      })
    );

  const createReady = vi.fn(async (_args: { ast: { blocks: unknown[] } }) => ({
    artifact: { artifactId: "artifact_" + "b".repeat(32), filename: "pismo.docx" },
    format: "docx",
    sha256: "b".repeat(64)
  }));
  const generate = vi.fn(async (_request: { processRenderOnly?: { stage: string } }) => ({
    ast: { schemaVersion: "1", documentType: "pleading", locale: "pl-PL", styleProfile: "lex-classic-clean-v1", blocks: [] as unknown[] },
    aliasesUsed: [],
    sessionId: "session-generate",
    validationContext: {}
  }));

  const artifactId =
    "artifact_" +
    "a".repeat(32);
  const readState =
    vi.fn(
      async (
        caseId: string,
        requestedArtifactId: string
      ) => ({
        schemaVersion: 1 as const,
        caseId,
        artifactId:
          requestedArtifactId,
        format:
          "docx" as const,
        state:
          "TOKENIZED_VALIDATED" as const,
        tokenizedSha256:
          "a".repeat(64),
        vaultGeneration: 1,
        caseKeyVersion: 1,
        workflowRequirement:
          "PROCESS_PLEADING_FINAL" as const,
        createdAt:
          "2026-09-18T00:00:00.000Z"
      })
    );

  const createIntent =
    vi.fn(
      async () => {
        throw new Error(
          "TEST_REAUTH_INTENT_SHOULD_NOT_BE_CREATED"
        );
      }
    );

  const reauthorizationManager =
    {
      createIntent,
      authorizeIntent:
        vi.fn(
          async () => {
            throw new Error(
              "TEST_REAUTHORIZATION_NOT_USED"
            );
          }
        ),
      consumeGrant:
        vi.fn(
          async () => {
            throw new Error(
              "TEST_REAUTHORIZATION_NOT_USED"
            );
          }
        )
    } as unknown as
      NonNullable<
        LexHttpAppOptions[
          "reauthorizationManager"
        ]
      >;

  const core =
    createLexHttpApp({
      registry:
        workflowRegistry(),
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
      caseAccessService:
        cases,
      processWorkflowStore:
        workspace,
      documentGenerationState: {
        readState
      },
      reauthorizationManager,
      sessionExecutor: {
        execute
      },
      documentAstGenerator: { generate } as never,
      documentAuthoringService: { createReady } as never,
      documentService: { forget: vi.fn(() => false) } as never
    });

  const app =
    express();
  app.use(
    express.json({
      limit: "2mb"
    })
  );

  const workspaceDependencies:
    Parameters<
      typeof registerWorkspaceRoutes
    >[1] = {
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
    };

  registerWorkspaceRoutes(
    app,
    workspaceDependencies
  );
  app.use(core);

  return {
    root,
    app,
    auth,
    execute,
    generate,
    createReady,
    artifactId,
    readState,
    createIntent
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

describe(
  "G39I process workflow HTTP integration",
  () => {
    it(
      "suppresses provider calls before start acceptance and auto-resolves only objective N/A checkpoints",
      async () => {
        const current =
          fixture();

        const bootstrap =
          await request(
            current.app
          )
            .post(
              "/api/auth/bootstrap"
            )
            .send({
              loginName:
                "owner",
              displayName:
                "Owner",
              password:
                "G39I integration strong password 2026"
            })
            .expect(201);
        const token =
          String(
            bootstrap.body
              .sessionToken
          );
        const authorization =
          `Bearer ${token}`;

        const createdCase =
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
                "Workflow E2E"
            })
            .expect(201);
        const caseId =
          String(
            createdCase.body
              .caseId
          );

        await request(
          current.app
        )
          .post(
            `/api/cases/${caseId}/workflow/process-pleading/initialize`
          )
          .set(
            "Authorization",
            authorization
          )
          .send({
            mode:
              "CHECKPOINT"
          })
          .expect(201);

        const sessionBody = {
          query:
            "Przygotuj pismo procesowe w tej sprawie.",
          provider:
            "openai",
          model:
            "gpt-test",
          primarySkill: DR,
          mode:
            "PRAWNIK",
          knowledge: {
            caseId,
            includeCase:
              false,
            includeFirm:
              false,
            limit: 8
          }
        };

        await request(
          current.app
        )
          .post(
            "/api/sessions/execute"
          )
          .set(
            "Authorization",
            authorization
          )
          .send(
            sessionBody
          )
          .expect(
            409,
            {
              error:
                "PROCESS_PLEADING_START_ACCEPTANCE_REQUIRED"
            }
          );

        expect(
          current.execute
        ).not.toHaveBeenCalled();

        await request(
          current.app
        )
          .post(
            `/api/cases/${caseId}/workflow/process-pleading/accept-start`
          )
          .set(
            "Authorization",
            authorization
          )
          .send({})
          .expect(200);

        const first =
          await request(
            current.app
          )
            .post(
              "/api/sessions/execute"
            )
            .set(
              "Authorization",
              authorization
            )
            .send(
              sessionBody
            )
            .expect(200);

        expect(
          current.execute
        ).toHaveBeenCalledTimes(
          1
        );
        expect(
          current.execute
            .mock.calls[0]?.[0]
            .processWorkflowContext
        ).toMatchObject({
          stage: "W1",
          checkpoint:
            "CP-1a",
          mode:
            "CHECKPOINT",
          // The case's checkpoint register goes with every checkpoint.
          register: expect.arrayContaining([
            expect.objectContaining({ checkpoint: "CP-1a", status: "OPEN" })
          ])
        });
        expect(
          first.body
            .processWorkflow
            .pendingCheckpoint
        ).toBe("CP-1a");

        const confirmed =
          await request(
            current.app
          )
            .post(
              `/api/cases/${caseId}/workflow/process-pleading/confirm`
            )
            .set(
              "Authorization",
              authorization
            )
            .send({
              checkpoint:
                "CP-1a"
            })
            .expect(200);

        const afterCp1aRevision =
          Number(
            confirmed.body
              .state.revision
          );

        const cp1b =
          await request(
            current.app
          )
            .post(
              `/api/cases/${caseId}/workflow/process-pleading/not-applicable`
            )
            .set(
              "Authorization",
              authorization
            )
            .send({
              checkpoint:
                "CP-1b",
              expectedRevision:
                afterCp1aRevision,
              reason:
                "N/A — w tym teście brak drugiej ścieżki prawnej i anomalii podmiotowej."
            })
            .expect(200);

        expect(
          cp1b.body.state
            .checkpoints[
              "CP-1b"
            ]
        ).toBe("NA");

        const second =
          await request(
            current.app
          )
            .post(
              "/api/sessions/execute"
            )
            .set(
              "Authorization",
              authorization
            )
            .send(
              sessionBody
            )
            .expect(200);

        expect(
          current.execute
        ).toHaveBeenCalledTimes(
          2
        );
        expect(
          current.execute
            .mock.calls[1]?.[0]
            .processWorkflowContext
        ).toMatchObject({
          stage: "W1",
          checkpoint:
            "CP-FSL-D",
          mode:
            "CHECKPOINT",
          // The case's checkpoint register goes with every checkpoint.
          register: expect.arrayContaining([
            expect.objectContaining({ checkpoint: "CP-FSL-D", status: "OPEN" })
          ])
        });
        expect(
          second.body
            .processWorkflow
            .checkpoints[
              "CP-1c-skan"
            ]
        ).toBe("NA");
        expect(
          second.body
            .processWorkflow
            .checkpoints[
              "CP-PD"
            ]
        ).toBe("NA");
        expect(
          second.body
            .processWorkflow
            .pendingCheckpoint
        ).toBe(
          "CP-FSL-D"
        );

        const encrypted =
          fs.readFileSync(
            path.join(
              current.root,
              "cases",
              caseId,
              "secure",
              "workspace",
              "index.lmw1"
            ),
            "utf8"
          );
        expect(
          encrypted
        ).not.toContain(
          "CP-1c-skan"
        );
        expect(
          encrypted
        ).not.toContain(
          "CP-FSL-D"
        );
        expect(
          encrypted
        ).not.toContain(
          "PENDING_CONFIRMATION"
        );

        current.auth.close();
      }
    );

    it(
      "runs at most four AUTO semantic checkpoints while preserving deterministic applicability and encrypted state",
      async () => {
        const current =
          fixture();

        const bootstrap =
          await request(
            current.app
          )
            .post(
              "/api/auth/bootstrap"
            )
            .send({
              loginName:
                "owner-auto",
              displayName:
                "Owner Auto",
              password:
                "G39I auto strong password 2026"
            })
            .expect(201);
        const authorization =
          `Bearer ${String(
            bootstrap.body
              .sessionToken
          )}`;

        const createdCase =
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
                "AUTO bounded E2E"
            })
            .expect(201);
        const caseId =
          String(
            createdCase.body
              .caseId
          );

        await request(
          current.app
        )
          .post(
            `/api/cases/${caseId}/workflow/process-pleading/initialize`
          )
          .set(
            "Authorization",
            authorization
          )
          .send({
            mode:
              "AUTO"
          })
          .expect(201);

        await request(
          current.app
        )
          .post(
            `/api/cases/${caseId}/workflow/process-pleading/accept-start`
          )
          .set(
            "Authorization",
            authorization
          )
          .send({})
          .expect(200);

        const response =
          await request(
            current.app
          )
            .post(
              "/api/sessions/execute"
            )
            .set(
              "Authorization",
              authorization
            )
            .send({
              query:
                "Przygotuj pismo procesowe w trybie automatycznym.",
              provider:
                "openai",
              model:
                "gpt-test",
              primarySkill:
                DR,
              mode:
                "PRAWNIK",
              knowledge: {
                caseId,
                includeCase:
                  false,
                includeFirm:
                  false,
                limit: 8
              }
            })
            .expect(200);

        expect(
          current.execute
        ).toHaveBeenCalledTimes(
          4
        );
        expect(
          current.execute.mock.calls.map(
            (call) =>
              call[0]
                .processWorkflowContext
                ?.checkpoint
          )
        ).toEqual([
          "CP-1a",
          "CP-1b",
          "CP-FSL-D",
          "CP-1c-lancuch"
        ]);

        expect(
          response.body
            .processAuto
            .limitReached
        ).toBe(true);
        expect(
          response.body
            .processAuto
            .stopped
        ).toBe(
          "LIMIT_REACHED"
        );
        expect(
          response.body
            .processAuto
            .steps
        ).toHaveLength(4);
        expect(
          response.body
            .processWorkflow
            .pendingCheckpoint
        ).toBeNull();
        expect(
          response.body
            .processWorkflow
            .checkpoints[
              "CP-1c-skan"
            ]
        ).toBe("NA");
        expect(
          response.body
            .processWorkflow
            .checkpoints[
              "CP-PD"
            ]
        ).toBe("NA");
        expect(
          response.body
            .processWorkflow
            .checkpoints[
              "CP-1c-macierz"
            ]
        ).toBe("NA");
        expect(
          response.body
            .processWorkflow
            .checkpoints[
              "CP-1d-anomalie"
            ]
        ).toBe("OPEN");
        expect(
          String(
            response.body.answer
          )
        ).toContain(
          "## CP-1a"
        );
        expect(
          String(
            response.body.answer
          )
        ).toContain(
          "## CP-1c-lancuch"
        );

        const encrypted =
          fs.readFileSync(
            path.join(
              current.root,
              "cases",
              caseId,
              "secure",
              "workspace",
              "index.lmw1"
            ),
            "utf8"
          );
        expect(encrypted)
          .not.toContain(
            "CP-1a"
          );
        expect(encrypted)
          .not.toContain(
            "CP-FSL-D"
          );
        expect(encrypted)
          .not.toContain(
            "PENDING_CONFIRMATION"
          );

        current.auth.close();
      }
    );

    it(
      "blocks deanonymization intent until the persisted process workflow is FINAL",
      async () => {
        const current =
          fixture();

        const bootstrap =
          await request(
            current.app
          )
            .post(
              "/api/auth/bootstrap"
            )
            .send({
              loginName:
                "owner-final",
              displayName:
                "Owner Final",
              password:
                "G39I final artifact strong password 2026"
            })
            .expect(201);
        const authorization =
          `Bearer ${String(
            bootstrap.body
              .sessionToken
          )}`;

        const createdCase =
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
                "Final gate E2E"
            })
            .expect(201);
        const caseId =
          String(
            createdCase.body
              .caseId
          );

        await request(
          current.app
        )
          .post(
            `/api/cases/${caseId}/workflow/process-pleading/initialize`
          )
          .set(
            "Authorization",
            authorization
          )
          .send({
            mode:
              "CHECKPOINT"
          })
          .expect(201);

        await request(
          current.app
        )
          .post(
            `/api/cases/${caseId}/artifacts/${current.artifactId}/deanonymization-intent`
          )
          .set(
            "Authorization",
            authorization
          )
          .send({})
          .expect(
            409,
            {
              error:
                "PROCESS_PLEADING_FINAL_REQUIRED"
            }
          );

        expect(
          current.readState
        ).toHaveBeenCalledWith(
          caseId,
          current.artifactId
        );
        expect(
          current.createIntent
        ).not.toHaveBeenCalled();

        const encrypted =
          fs.readFileSync(
            path.join(
              current.root,
              "cases",
              caseId,
              "secure",
              "workspace",
              "index.lmw1"
            ),
            "utf8"
          );
        expect(
          encrypted
        ).not.toContain(
          "PROCESS_PLEADING_V1"
        );
        expect(
          encrypted
        ).not.toContain(
          "CG_ACCEPTANCE"
        );

        current.auth.close();
      }
    );
    it("renders a pleading file only from the case's started pipeline", async () => {
      const current = fixture();
      const bootstrap = await request(current.app)
        .post("/api/auth/bootstrap")
        .send({ loginName: "owner", displayName: "Owner", password: "G39I render strong password 2026" })
        .expect(201);
      const authorization = `Bearer ${String(bootstrap.body.sessionToken)}`;
      const createdCase = await request(current.app)
        .post("/api/cases")
        .set("Authorization", authorization)
        .send({ displayName: "Render" })
        .expect(201);
      const caseId = String(createdCase.body.caseId);
      const body = {
        query: "Napisz pozew o zapłatę w pliku docx.",
        provider: "openai",
        model: "gpt-test",
        primarySkill: DR,
        mode: "PRAWNIK",
        format: "docx",
        documentType: "pleading",
        styleProfile: "lex-classic-clean-v1",
        attachments: []
      };

      await request(current.app)
        .post(`/api/cases/${caseId}/artifacts/generate`)
        .set("Authorization", authorization)
        .send(body)
        .expect(409, { error: "PROCESS_PLEADING_PIPELINE_REQUIRED" });
      expect(current.generate).not.toHaveBeenCalled();

      await request(current.app)
        .post(`/api/cases/${caseId}/workflow/process-pleading/initialize`)
        .set("Authorization", authorization)
        .send({ mode: "CHECKPOINT" })
        .expect(201);
      await request(current.app)
        .post(`/api/cases/${caseId}/workflow/process-pleading/accept-start`)
        .set("Authorization", authorization)
        .send({})
        .expect(200);

      const rendered = await request(current.app)
        .post(`/api/cases/${caseId}/artifacts/generate`)
        .set("Authorization", authorization)
        .send(body);
      expect(rendered.status).toBe(201);
      expect(current.generate.mock.calls[0]?.[0]?.processRenderOnly).toEqual({ stage: expect.any(String) });
      current.auth.close();
    });
    it("keeps the pleading text between stages, passes it to the next step and takes the user's versions", async () => {
      const current = fixture();
      const bootstrap = await request(current.app)
        .post("/api/auth/bootstrap")
        .send({ loginName: "owner", displayName: "Owner", password: "G39I draft strong password 2026" })
        .expect(201);
      const authorization = `Bearer ${String(bootstrap.body.sessionToken)}`;
      const caseId = String(
        (await request(current.app).post("/api/cases").set("Authorization", authorization).send({ displayName: "Draft" }).expect(201)).body.caseId
      );
      await request(current.app)
        .post(`/api/cases/${caseId}/workflow/process-pleading/initialize`)
        .set("Authorization", authorization)
        .send({ mode: "AUTO" })
        .expect(201);
      await request(current.app)
        .post(`/api/cases/${caseId}/workflow/process-pleading/accept-start`)
        .set("Authorization", authorization)
        .send({})
        .expect(200);

      current.execute.mockImplementation(async (input) => {
        const checkpoint = input.processWorkflowContext?.checkpoint ?? "";
        const answer = ["CP-ATAK", "CP-PODMIOT", "CP-QUALITY", "CP-AUDYT", "CP-PEER"].includes(checkpoint)
          ? [
              `Raport ${checkpoint}.`,
              "=== PISMO ===",
              `Sąd Rejonowy dla Krakowa. Pozew o zapłatę kwoty 10 000 zł wraz z odsetkami ustawowymi za opóźnienie. Wersja ${checkpoint}.`,
              "=== KONIEC PISMA ===",
              ...(checkpoint === "CP-PEER" ? ["RAPORT W3", "STATUS PISMA: do decyzji", "UWAGI REDAKCYJNE PRZED ZŁOŻENIEM", "REJESTR KROKÓW"] : [])
            ].join("\n")
          : `Raport ${checkpoint}.`;
        return {
          sessionId: "session-draft",
          status: "DRAFT_PRESENTABLE",
          provider: input.provider,
          model: input.model,
          primarySkill: input.primarySkill,
          answer,
          finalization: "PASS",
          blockedReferences: [],
          verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
          evidence: [],
          audit: { result: "PASS", eventCount: 1, closed: true },
          workflow: { id: "PROCESS_PLEADING_V1", result: "PASS", requiredResources: [], missingResources: [] }
        };
      });
      const body = {
        query: "Przygotuj pismo procesowe w trybie automatycznym.",
        provider: "openai",
        model: "gpt-test",
        primarySkill: DR,
        mode: "PRAWNIK",
        knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 }
      };
      let stage = "";
      for (let round = 0; round < 8 && stage !== "FINAL"; round += 1) {
        const response = await request(current.app).post("/api/sessions/execute").set("Authorization", authorization).send(body).expect(200);
        stage = response.body.processWorkflow.stage;
      }
      expect(stage).toBe("FINAL");

      // Every W3 step worked on the text of the step before, not on the chat.
      const contexts = current.execute.mock.calls.map((call) => call[0].processWorkflowContext);
      const quality = contexts.find((context) => context?.checkpoint === "CP-QUALITY");
      expect(quality?.draft?.text).toContain("Wersja CP-PODMIOT");
      expect(contexts.find((context) => context?.checkpoint === "CP-ATAK")?.draft).toBeUndefined();

      const stored = await request(current.app)
        .get(`/api/cases/${caseId}/workflow/process-pleading/draft`)
        .set("Authorization", authorization)
        .expect(200);
      expect(stored.body.draft.latest.text).toContain("Wersja CP-PEER");
      expect(stored.body.draft.versions.map((item: { checkpoint: string }) => item.checkpoint)).toEqual([
        "CP-ATAK",
        "CP-PODMIOT",
        "CP-QUALITY",
        "CP-AUDYT",
        "CP-PEER"
      ]);

      // A draft file stays tokenized even once the pipeline is FINAL.
      current.readState.mockImplementationOnce(async (stateCaseId: string, artifactId: string) => ({
        schemaVersion: 1 as const,
        caseId: stateCaseId,
        artifactId,
        format: "docx" as const,
        state: "TOKENIZED_VALIDATED" as const,
        tokenizedSha256: "a".repeat(64),
        vaultGeneration: 1,
        caseKeyVersion: 1,
        workflowRequirement: "PROCESS_PLEADING_FINAL" as const,
        processDocumentStatus: "DRAFT" as const,
        createdAt: "2026-10-05T00:00:00.000Z"
      }) as never);
      await request(current.app)
        .post(`/api/cases/${caseId}/artifacts/${current.artifactId}/deanonymization-intent`)
        .set("Authorization", authorization)
        .send({})
        .expect(409, { error: "PROCESS_PLEADING_DRAFT_ARTIFACT" });

      // A minor correction keeps FINAL; a substantive one goes back to W2 (§7.2).
      const minor = await request(current.app)
        .post(`/api/cases/${caseId}/workflow/process-pleading/draft`)
        .set("Authorization", authorization)
        .send({ text: "Sąd Rejonowy dla Krakowa-Śródmieścia. Pozew o zapłatę.", change: "MINOR", expectedRevision: stored.body.draft.revision })
        .expect(200);
      expect(minor.body.state.stage).toBe("FINAL");
      expect(minor.body.draft.latest).toMatchObject({ source: "USER", change: "MINOR" });

      await request(current.app)
        .post(`/api/cases/${caseId}/workflow/process-pleading/draft`)
        .set("Authorization", authorization)
        .send({ text: "Inny tekst", change: "MINOR", expectedRevision: stored.body.draft.revision })
        .expect(409, { error: "PROCESS_PLEADING_DRAFT_CONFLICT" });

      const substantive = await request(current.app)
        .post(`/api/cases/${caseId}/workflow/process-pleading/draft`)
        .set("Authorization", authorization)
        .send({ text: "Pozew o zapłatę 20 000 zł (zmiana żądania).", change: "SUBSTANTIVE", expectedRevision: minor.body.draft.revision })
        .expect(200);
      expect(substantive.body.state).toMatchObject({ stage: "W2", documentStatus: "DRAFT" });
      expect(substantive.body.state.checkpoints).toMatchObject({
        "CP-ATAK": "OPEN",
        "CP-QUALITY": "OPEN",
        "CP-AUDYT": "OPEN",
        "CP-PEER": "OPEN",
        "CP-PODMIOT": "CLOSED"
      });

      // The file renders the stored version: passed to the generator, checked, marked as a draft.
      const docBody = {
        query: "Przygotuj plik docx: pismo procesowe z zapisanego projektu sprawy.",
        provider: "openai",
        model: "gpt-test",
        primarySkill: DR,
        mode: "PRAWNIK",
        format: "docx",
        documentType: "pleading",
        styleProfile: "lex-classic-clean-v1",
        attachments: []
      };
      current.generate.mockImplementation(async () => ({
        ast: {
          schemaVersion: "1",
          documentType: "pleading",
          locale: "pl-PL",
          styleProfile: "lex-classic-clean-v1",
          blocks: [{ type: "paragraph", content: [{ type: "text", text: "Pozew o zapłatę 20 000 zł (zmiana żądania)." }] }]
        },
        aliasesUsed: [],
        sessionId: "session-generate",
        validationContext: {}
      }));
      await request(current.app).post(`/api/cases/${caseId}/artifacts/generate`).set("Authorization", authorization).send(docBody).expect(201);
      expect((current.generate.mock.calls.at(-1)?.[0] as { sourceText?: { text: string } }).sourceText?.text).toBe(
        "Pozew o zapłatę 20 000 zł (zmiana żądania)."
      );
      expect(JSON.stringify(current.createReady.mock.calls.at(-1)?.[0].ast.blocks[0])).toContain("PROJEKT – NIE SKŁADAĆ");

      current.generate.mockImplementation(async () => ({
        ast: {
          schemaVersion: "1",
          documentType: "pleading",
          locale: "pl-PL",
          styleProfile: "lex-classic-clean-v1",
          blocks: [{ type: "paragraph", content: [{ type: "text", text: "Zupełnie inne pismo o rozwód." }] }]
        },
        aliasesUsed: [],
        sessionId: "session-generate",
        validationContext: {}
      }));
      const unfaithful = await request(current.app).post(`/api/cases/${caseId}/artifacts/generate`).set("Authorization", authorization).send(docBody);
      expect(unfaithful.status).toBe(422);
      expect(unfaithful.body.error).toBe("DOCUMENT_PLEADING_FIDELITY_FAILED");

      // The next step starts from the user's version.
      current.execute.mockClear();
      await request(current.app).post("/api/sessions/execute").set("Authorization", authorization).send(body).expect(200);
      expect(current.execute.mock.calls[0]?.[0].processWorkflowContext).toMatchObject({
        checkpoint: "CP-ATAK",
        draft: { source: "USER", text: "Pozew o zapłatę 20 000 zł (zmiana żądania)." }
      });
      current.auth.close();
    });

    it("sends a step back with remarks and gives them to its next run", async () => {
      const current = fixture();
      const bootstrap = await request(current.app)
        .post("/api/auth/bootstrap")
        .send({ loginName: "owner", displayName: "Owner", password: "G39I remarks strong password 2026" })
        .expect(201);
      const authorization = `Bearer ${String(bootstrap.body.sessionToken)}`;
      const caseId = String(
        (await request(current.app).post("/api/cases").set("Authorization", authorization).send({ displayName: "Remarks" }).expect(201)).body.caseId
      );
      await request(current.app)
        .post(`/api/cases/${caseId}/workflow/process-pleading/initialize`)
        .set("Authorization", authorization)
        .send({ mode: "CHECKPOINT" })
        .expect(201);
      await request(current.app)
        .post(`/api/cases/${caseId}/workflow/process-pleading/accept-start`)
        .set("Authorization", authorization)
        .send({})
        .expect(200);
      const body = {
        query: "Przygotuj pismo procesowe w tej sprawie.",
        provider: "openai",
        model: "gpt-test",
        primarySkill: DR,
        mode: "PRAWNIK",
        knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 }
      };
      const first = await request(current.app).post("/api/sessions/execute").set("Authorization", authorization).send(body).expect(200);
      const pending = first.body.processWorkflow.pendingCheckpoint;
      expect(pending).toBeTruthy();

      const revised = await request(current.app)
        .post(`/api/cases/${caseId}/workflow/process-pleading/revise`)
        .set("Authorization", authorization)
        .send({ checkpoint: pending, remarks: "Dodaj zarzut przedawnienia." })
        .expect(200);
      expect(revised.body.state.pendingCheckpoint).toBeNull();
      expect(revised.body.state.checkpoints[pending]).toBe("OPEN");

      current.execute.mockClear();
      await request(current.app).post("/api/sessions/execute").set("Authorization", authorization).send(body).expect(200);
      expect(current.execute.mock.calls[0]?.[0].processWorkflowContext).toMatchObject({
        checkpoint: pending,
        remarks: "Dodaj zarzut przedawnienia."
      });
      const draft = await request(current.app)
        .get(`/api/cases/${caseId}/workflow/process-pleading/draft`)
        .set("Authorization", authorization)
        .expect(200);
      expect(draft.body.draft?.remarks).toBeUndefined();
      current.auth.close();
    });
  }
);
