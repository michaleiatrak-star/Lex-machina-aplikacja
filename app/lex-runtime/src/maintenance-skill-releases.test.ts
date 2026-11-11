import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MaintenanceService, compareSkillVersions, skillReleaseComparison } from "./maintenance-service.js";
import type { VerifiedSkillIndex } from "./skill-update-verifier.js";
import type { UpdateDiscovery, UpdateDiscoveryResult } from "./update-discovery.js";

// Skills releases of the skills repository (2026-11-11): installed only with a newer skill and
// none older than the skills in use.
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const RELEASE = "2026.1111.183005";
const BASE = `https://github.com/michaleiatrak-star/Lex-Machina/releases/download/v${RELEASE}`;

function setup(skills: Array<{ id: string; version: string }>, active: Record<string, string>) {
  const indexBytes = new TextEncoder().encode('{"index":1}');
  const result: UpdateDiscoveryResult = {
    currentVersion: "0.0.0",
    status: "AVAILABLE",
    checkedAt: "2026-11-11T18:30:00.000Z",
    latestVersion: RELEASE,
    repository: "michaleiatrak-star/Lex-Machina",
    skillsBundle: { name: `LexMachina-Skills-${RELEASE}.zip`, url: `${BASE}/LexMachina-Skills-${RELEASE}.zip`, sha256: "a".repeat(64), bytes: 123 },
    skillsIndex: { name: "LexMachina-Skills-Index.json", url: `${BASE}/LexMachina-Skills-Index.json`, sha256: sha256(indexBytes), bytes: indexBytes.byteLength }
  };
  const verified: VerifiedSkillIndex = {
    signerKeyId: "UNSIGNED_ALLOWED",
    indexSha256: "f".repeat(64),
    index: {
      schemaVersion: 1,
      kind: "LEX_MACHINA_SKILLS_INDEX",
      version: RELEASE,
      bundle: { filename: `LexMachina-Skills-${RELEASE}.zip`, sha256: "a".repeat(64), bytes: 123 },
      compatibility: { minAppVersion: "0.1.77" },
      skills: skills.map((skill) => ({ ...skill, sha256: "b".repeat(64), dependencies: [] }))
    }
  };
  const fetched: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    fetched.push(url);
    return url === result.skillsIndex!.url ? new Response(indexBytes, { status: 200 }) : new Response("missing", { status: 404 });
  }) as typeof fetch;
  const unused: UpdateDiscovery = { async check() { throw new Error("APPLICATION_RELEASES_NOT_USED_FOR_SKILLS"); } };
  const maintenance = new MaintenanceService(
    unused,
    fetchImpl,
    { verify() { throw new Error("UNUSED"); } },
    () => true,
    () => verified,
    () => false,
    () => { throw new Error("UNUSED"); },
    () => "UNSIGNED_ALLOWED",
    () => "SIGNED_REQUIRED"
  );
  maintenance.useSkillReleases({ async check() { return result; } }, () => new Map(Object.entries(active)));
  return { maintenance, fetched };
}

describe("skills releases of the skills repository", () => {
  it("compares skill versions part by part as numbers", () => {
    expect(compareSkillVersions("6.85", "6.9")).toBe(1);
    expect(compareSkillVersions("3.99.65", "3.99.7")).toBe(1);
    expect(compareSkillVersions("5.54", "5.54")).toBe(0);
    expect(compareSkillVersions("2.0", "2.0.1")).toBe(-1);
    expect(skillReleaseComparison({ skills: [{ id: "a", version: "2.1" }, { id: "b", version: "1.0" }, { id: "c", version: "1.0" }] as never }, new Map([["a", "2.0"], ["b", "1.1"]]))).toEqual({ newer: ["a", "c"], older: ["b"] });
  });

  it("offers a release with a newer skill and none older", async () => {
    const { maintenance } = setup([{ id: "prawo-polskie-v2", version: "6.86" }, { id: "shared", version: "3.99.65" }], { "prawo-polskie-v2": "6.85", shared: "3.99.65" });
    expect(await maintenance.skillStatus()).toMatchObject({ status: "AVAILABLE", latestVersion: RELEASE, bundleReady: true });
  });

  it("never offers a release older than the skills in use (the application's own are newer)", async () => {
    const { maintenance, fetched } = setup([{ id: "prawo-polskie-v2", version: "6.86" }, { id: "shared", version: "3.99.64" }], { "prawo-polskie-v2": "6.85", shared: "3.99.65" });
    expect((await maintenance.skillStatus()).status).toBe("UP_TO_DATE");
    await expect(maintenance.applySkillUpdate()).rejects.toThrow("SKILL_UPDATE_WOULD_DOWNGRADE");
    // Stopped before the bundle was downloaded.
    expect(fetched.some((url) => url.endsWith(".zip"))).toBe(false);
  });

  it("a release with the same skills as in use is up to date", async () => {
    const { maintenance } = setup([{ id: "shared", version: "3.99.65" }], { shared: "3.99.65" });
    expect((await maintenance.skillStatus()).status).toBe("UP_TO_DATE");
    await expect(maintenance.applySkillUpdate()).rejects.toThrow("SKILL_UPDATE_NOT_AVAILABLE");
  });
});
