import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLexHttpApp } from "../src/http/app.js";
import { LexSkillRegistry } from "../src/registry.js";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";

const roots: string[] = [];

function tempDir(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("one-time de-anonymized download", () => {
  it("sends the whole file and wipes the buffer only after the response closes", async () => {
    const skills = tempDir("lex-sdl-skills-");
    fs.mkdirSync(path.join(skills, "prawo-polskie-v2"), { recursive: true });
    fs.writeFileSync(path.join(skills, "prawo-polskie-v2", "SKILL.md"), "---\nname: prawo-polskie-v2\n---\n# test\n");
    const registry = new LexSkillRegistry(skills);
    registry.scan();
    const store = new LocalAuthStore({ rootDir: tempDir("lex-sdl-data-") });
    const auth = new LocalAuthService(store, {
      sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
      kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
    });
    const caseId = `case_${"c".repeat(32)}`;
    const data = Buffer.alloc(24 * 1024 * 1024, 0xab);
    const sha = createHash("sha256").update(data).digest("hex");
    const artifact = {
      artifactId: "art_1",
      sensitivity: "CLEAR_PII",
      sha256: sha,
      mediaType: "application/octet-stream",
      filename: "pismo.docx"
    };
    const app = createLexHttpApp({
      registry,
      modelCatalog: { list: vi.fn(async () => []) },
      authService: auth,
      caseAccessService: {
        openCase: () => ({ caseId, keyVersion: 1 }),
        withCaseDataKey: async (_context: unknown, _caseId: string, _mode: string, callback: (key: Buffer) => unknown) =>
          await callback(Buffer.alloc(32, 1))
      } as never,
      sensitiveDownloadTickets: {
        consume: () => ({ caseId, artifactId: "art_1", finalSha256: sha })
      } as never,
      secureCaseArtifactStore: {
        listArtifacts: async () => [artifact],
        readArtifact: async () => data
      } as never
    });
    const bootstrap = await request(app)
      .post("/api/auth/bootstrap")
      .send({ loginName: "owner", displayName: "Owner", password: "Owner http bezpieczne haslo 2026" })
      .expect(201);
    const response = await request(app)
      .get("/api/sensitive-download/tkt_1")
      .set({ Authorization: `Bearer ${String(bootstrap.body.sessionToken)}` })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    const body = response.body as Buffer;
    expect(body.length).toBe(data.length);
    expect(createHash("sha256").update(body).digest("hex")).toBe(sha);
    await vi.waitFor(() => expect(data.every((byte) => byte === 0)).toBe(true));
  });
});
