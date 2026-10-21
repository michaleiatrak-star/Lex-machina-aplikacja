import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { LocalCaseAccessService } from "../src/case-access.js";
import {
  DeanonymizationReauthorizationManager,
  type DeanonymizationTargetResolver,
  type DeanonymizationTargetState
} from "../src/auth/reauthorization.js";

// A document generated in the chat comes back with the case's data without a second password:
// the grant of the signed-in session, still one-use and bound to the exact artifact state.
const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-deanon-session-"));
  roots.push(rootDir);
  const now = { value: Date.parse("2026-10-21T10:00:00.000Z") };
  const clock = { now: () => now.value };
  const store = new LocalAuthStore({ rootDir });
  const auth = new LocalAuthService(store, {
    clock,
    sessionManager: new AuthSessionManager({
      clock,
      scheduleExpiryTimers: false,
      policy: { idleTimeoutMs: 60 * 60 * 1000, overallTimeoutMs: 8 * 60 * 60 * 1000 }
    }),
    kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
  });
  const cases = new LocalCaseAccessService(store, auth, new LocalCaseFileStore({ rootDir }));
  const owner = await auth.bootstrap({ loginName: "owner", displayName: "Owner", password: "Bezpieczne haslo wlasciciela 2026" });
  const actor = { user: owner.user, session: owner.session };
  const legalCase = await cases.createCase(actor, "Sprawa");
  const target: DeanonymizationTargetState = {
    caseId: legalCase.caseId,
    artifactId: "artifact_" + "2".repeat(32),
    artifactFormat: "docx",
    state: "TOKENIZED_VALIDATED",
    tokenizedSha256: createHash("sha256").update("tokenized-docx").digest("hex"),
    vaultGeneration: 3,
    caseKeyVersion: legalCase.keyVersion,
    deanonymizationKeyBinding: "d".repeat(64)
  };
  const resolver: DeanonymizationTargetResolver & { target: DeanonymizationTargetState } = {
    target,
    async resolve(caseId, artifactId) {
      return caseId === this.target.caseId && artifactId === this.target.artifactId ? { ...this.target } : null;
    }
  };
  const manager = new DeanonymizationReauthorizationManager(auth, cases, store, resolver, {
    clock,
    intentTtlMs: 5 * 60 * 1000,
    grantTtlMs: 90 * 1000
  });
  return { auth, actor, target, resolver, manager };
}

describe("deanonimizacja dokumentu w zalogowanej sesji (bez drugiego hasła)", () => {
  it("grant bez hasła: związany z artefaktem, jednorazowy, odrzucony po zmianie artefaktu", async () => {
    const { auth, actor, target, resolver, manager } = await fixture();
    const intent = await manager.createIntent(actor, target.caseId, target.artifactId);
    const { intent: authorized, grant } = await manager.authorizeIntentInSession(actor, intent.intentId);
    expect(authorized.status).toBe("AUTHORIZED");
    expect(grant.deanonymizationKeyBinding).toBe(target.deanonymizationKeyBinding);

    expect(await manager.consumeGrant(actor, grant.grantId)).toEqual(target);
    await expect(manager.consumeGrant(actor, grant.grantId)).rejects.toMatchObject({ code: "REAUTH_GRANT_ALREADY_USED" });

    const second = await manager.createIntent(actor, target.caseId, target.artifactId);
    resolver.target = { ...target, vaultGeneration: 4 };
    await expect(manager.authorizeIntentInSession(actor, second.intentId)).rejects.toMatchObject({ code: "REAUTH_TARGET_CHANGED" });
    auth.close();
  });

  it("hasło podane mimo to nadal jest sprawdzane", async () => {
    const { auth, actor, target, manager } = await fixture();
    const intent = await manager.createIntent(actor, target.caseId, target.artifactId);
    await expect(manager.authorizeIntent(actor, intent.intentId, "Bledne haslo 2026 xyz")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    auth.close();
  });
});
