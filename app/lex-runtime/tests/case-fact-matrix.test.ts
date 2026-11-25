import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EncryptedCaseWorkspaceStore } from "../src/case-workspace-store.js";

// The fact matrices of a case's documents kept with the case (task 12.3): the next question in the
// case reads them instead of building them again; stored encrypted, newest kept.
describe("fact matrices in the case's memory", () => {
  it("are saved encrypted, read back by their key, and kept to the newest eight", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-matrix-"));
    const store = new EncryptedCaseWorkspaceStore({ rootDir: root });
    const caseId = "case_" + "b".repeat(32);
    const key = { caseId, caseDataKey: randomBytes(32), keyVersion: 1 };
    const matrix = { facts: [{ topic: "zakres obowiązków", quote: "koordynował pracę zespołu" }], failures: [], topics: ["zakres"] };
    await store.saveCaseMemory({ ...key, factMatrix: { key: "witness:model-x:abc", value: matrix } });
    expect((await store.getCaseMemory(key)).factMatrices?.["witness:model-x:abc"]?.value).toEqual(matrix);
    const file = fs.readFileSync(path.join(root, "cases", caseId, "secure", "workspace", "index.lmw1"), "utf8");
    expect(file).not.toContain("koordynował");
    for (let index = 0; index < 10; index += 1) {
      await store.saveCaseMemory({ ...key, factMatrix: { key: `documents:model-x:${index}`, value: { facts: [index], failures: [] } } });
    }
    const kept = Object.keys((await store.getCaseMemory(key)).factMatrices ?? {});
    expect(kept).toHaveLength(8);
    expect(kept).toContain("documents:model-x:9");
    await store.saveCaseMemory({ ...key, factMatrix: null });
    expect((await store.getCaseMemory(key)).factMatrices).toBeUndefined();
  });
});

describe("a turn reads the case's matrix instead of building it", () => {
  it("the stored matrix is used and the record noted; a new one is written once built", async () => {
    const { LexSkillRegistry } = await import("../src/registry.js");
    const { ProviderGateway, ProviderRegistry } = await import("../src/providers/gateway.js");
    const { SafeSessionExecutor } = await import("../src/session-executor.js");
    const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(new ProviderRegistry())) as unknown as {
      cachedMatrix: (key: string, compute: () => Promise<{ facts: unknown[]; failures: unknown[] }>, store?: unknown, onHit?: () => void) => Promise<{ facts: unknown[] }>;
    };
    const saved = new Map<string, unknown>([["witness:m:1", { facts: ["z zapisu"], failures: [] }]]);
    const store = { read: async (key: string) => saved.get(key) ?? null, write: async (key: string, value: unknown) => void saved.set(key, value) };
    let built = 0;
    let hits = 0;
    const compute = async () => ((built += 1), { facts: ["nowa"], failures: [] });
    expect((await executor.cachedMatrix("witness:m:1", compute, store, () => (hits += 1))).facts).toEqual(["z zapisu"]);
    expect(built).toBe(0);
    expect(hits).toBe(1);
    await executor.cachedMatrix("witness:m:2", compute, store);
    expect(built).toBe(1);
    expect(saved.get("witness:m:2")).toEqual({ facts: ["nowa"], failures: [] });
  });
});
