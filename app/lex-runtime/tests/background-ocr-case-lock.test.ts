import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { SecureCaseUploadStore } from "../src/case-secure-store.js";
import { LocalCaseAccessService } from "../src/case-access.js";
import { createLexHttpApp } from "../src/http/app.js";
import { LexSkillRegistry } from "../src/registry.js";
import type {
  DocumentSecurityContext,
  DocumentService,
  PublicDocumentIngestion,
  PublicDocumentReview,
  SupportedDocumentMediaType
} from "../src/document-service.js";

const roots: string[] = [];
const DR = "dr-02-prawo-cywilne-rodzinne-gospodarcze";

function registry(): LexSkillRegistry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-bg-lock-skills-"));
  roots.push(root);
  for (const name of ["prawo-polskie-v2", DR]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, "SKILL.md"), `---\nname: ${name}\n---\n# test\n`);
  }
  fs.writeFileSync(path.join(root, "prawo-polskie-v2", "ROUTING-MAP.md"), DR + "\n");
  const value = new LexSkillRegistry(root);
  value.scan();
  return value;
}

// A long background OCR (held open by `ocrDone`) and a quick confirmation of another file.
class SlowOcrDocumentService implements DocumentService {
  readonly events: string[] = [];
  private finishOcr!: () => void;
  readonly ocrDone = new Promise<void>((resolve) => (this.finishOcr = resolve));
  releaseOcr(): void {
    this.finishOcr();
  }

  async review(
    _data: Uint8Array,
    mediaType: SupportedDocumentMediaType,
    security?: DocumentSecurityContext
  ): Promise<PublicDocumentReview> {
    this.events.push("ocr start");
    await this.ocrDone;
    // The read is saved in the case under its key, as the real service does.
    if (security?.storeUnderLock) await security.storeUnderLock(async () => undefined);
    else if (!security?.caseDataKey) throw new Error("DOCUMENT_STORAGE_CONTEXT_REQUIRED");
    this.events.push("ocr saved");
    return {
      documentId: "doc_" + "a".repeat(24),
      mediaType,
      complete: true,
      totalPages: 1,
      pages: [{ page: 1, text: "Tekst", source: "OCR" }],
      suggestions: []
    };
  }

  async finalizeReview(documentId: string, _directives: unknown, security?: DocumentSecurityContext): Promise<PublicDocumentIngestion> {
    if (!security?.caseDataKey) throw new Error("DOCUMENT_VAULT_CONTEXT_REQUIRED");
    this.events.push("confirmed");
    return { documentId } as PublicDocumentIngestion;
  }

  async ingestPdf(): Promise<never> {
    throw new Error("NOT_USED");
  }
  async ingestImage(): Promise<never> {
    throw new Error("NOT_USED");
  }
  async resolveProtectedChunks(): Promise<never> {
    throw new Error("NOT_USED");
  }
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-bg-lock-data-"));
  roots.push(root);
  const authStore = new LocalAuthStore({ rootDir: root });
  const auth = new LocalAuthService(authStore, {
    sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
    kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
  });
  const files = new LocalCaseFileStore({ rootDir: root });
  const cases = new LocalCaseAccessService(authStore, auth, files);
  const secure = new SecureCaseUploadStore({ rootDir: root });
  const documents = new SlowOcrDocumentService();
  const login = await auth.bootstrap({ loginName: "owner", displayName: "Owner", password: "Lock test owner bezpieczne haslo 2026" });
  const context = { user: login.user, session: login.session };
  const localCase = await cases.createCase(context, "Blokada");
  const app = createLexHttpApp({
    registry: registry(),
    modelCatalog: { list: async () => [] },
    authService: auth,
    caseFileStore: files,
    secureCaseUploadStore: secure,
    caseAccessService: cases,
    documentService: documents
  });
  const stored = await cases.withCaseDataKey(context, localCase.caseId, "WRITE", async (caseDataKey) =>
    await secure.saveUpload({
      caseId: localCase.caseId,
      filename: "skan.pdf",
      mediaType: "application/pdf",
      data: Buffer.from("%PDF-1.7\nskan"),
      caseDataKey,
      keyVersion: localCase.keyVersion
    })
  );
  return { auth, documents, localCase, stored, token: login.sessionToken, app };
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("background OCR and the case lock", () => {
  it("confirming a file does not wait for the background OCR of another file of the same case", async () => {
    const current = await fixture();
    const caseId = current.localCase.caseId;
    const background = request(current.app)
      .post(`/api/cases/${caseId}/files/${current.stored.uploadId}/process`)
      .set("Authorization", `Bearer ${current.token}`)
      .send({ detect: false, background: true })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(current.documents.events).toEqual(["ocr start"]);

    const confirm = await request(current.app)
      .post(`/api/documents/doc_${"b".repeat(24)}/finalize`)
      .set("Authorization", `Bearer ${current.token}`)
      .send({ caseId, directives: [], reviewed: true })
      .timeout(2_000);
    expect(confirm.status).toBe(200);
    expect(current.documents.events).toEqual(["ocr start", "confirmed"]);

    current.documents.releaseOcr();
    const read = await background;
    expect(read.status).toBe(201);
    expect(current.documents.events).toEqual(["ocr start", "confirmed", "ocr saved"]);
    current.auth.close();
  });

  it("the same for a file read ahead in the chat (POST /api/documents/review, background)", async () => {
    const current = await fixture();
    const caseId = current.localCase.caseId;
    const background = request(current.app)
      .post("/api/documents/review")
      .set("Authorization", `Bearer ${current.token}`)
      .set("Content-Type", "application/pdf")
      .set("X-Lex-Case-Id", caseId)
      .set("X-Lex-Filename", "skan2.pdf")
      .set("X-Lex-Processing", "ocr-only,background")
      .send(Buffer.from("%PDF-1.7\nskan 2"))
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(current.documents.events).toEqual(["ocr start"]);

    const confirm = await request(current.app)
      .post(`/api/documents/doc_${"b".repeat(24)}/finalize`)
      .set("Authorization", `Bearer ${current.token}`)
      .send({ caseId, directives: [], reviewed: true })
      .timeout(2_000);
    expect(confirm.status).toBe(200);

    current.documents.releaseOcr();
    expect((await background).status).toBe(201);
    expect(current.documents.events).toEqual(["ocr start", "confirmed", "ocr saved"]);
    current.auth.close();
  });
});
