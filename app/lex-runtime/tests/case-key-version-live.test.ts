import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { LocalCaseAccessService } from "../src/case-access.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("case key version during rotation", () => {
  it("a case view opened before the lock reports the rotated key version inside withCaseDataKey", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-keyver-"));
    roots.push(root);
    const store = new LocalAuthStore({ rootDir: root });
    const auth = new LocalAuthService(store, {
      sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
      kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
    });
    const cases = new LocalCaseAccessService(store, auth, new LocalCaseFileStore({ rootDir: root }));
    const owner = await auth.bootstrap({
      loginName: "owner",
      displayName: "Owner",
      password: "Wersja klucza bezpieczne haslo 2026"
    });
    const context = { user: owner.user, session: owner.session };
    const created = await cases.createCase(context, "Rotacja");
    const view = cases.openCase(context, created.caseId);
    const before = view.keyVersion;

    // Rotacja rusza pierwsza, trasa czeka na blokadę z widokiem otwartym wcześniej.
    const rotation = cases.rotateCaseKey(context, created.caseId);
    const seen = await cases.withCaseDataKey(context, created.caseId, "WRITE", () => view.keyVersion);
    const rotated = await rotation;

    expect(rotated.keyVersion).toBe(before + 1);
    expect(seen).toBe(rotated.keyVersion);
    expect(JSON.parse(JSON.stringify(view)).keyVersion).toBe(rotated.keyVersion);
  });
});
