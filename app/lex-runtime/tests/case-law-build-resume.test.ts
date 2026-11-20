import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CaseLawDatabase, setSharedCaseLawDatabase } from "../src/case-law-db.js";
import { buildCaseLawSource, caseLawSyncStatus, progressPhase, startCaseLawSync, stopCaseLawBuild, type SyncAdapter } from "../src/case-law-sync.js";

process.env.LEX_CASE_LAW_SYNC = "0";

describe("an interrupted build continues", () => {
  it("reads the phase from a source's progress", () => {
    expect(progressPhase("nie rozpoczęto (od 2000-01-01)")).toBe("NONE");
    expect(progressPhase("pełne pobieranie: nr 37 z 29557")).toBe("PARTIAL");
    expect(progressPhase("pobrane w całości (2026-11-20); dociąganie nowych od nr 900")).toBe("COMPLETE");
    expect(progressPhase("pełny przegląd izb zakończony 2026-11-01; izba 2 z 40 (ORA)")).toBe("COMPLETE");
  });

  it("a build left by closing the application goes on at the next start, from the saved cursor", async () => {
    const db = new CaseLawDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "lex-resume-")));
    setSharedCaseLawDatabase(db);
    const adapter: SyncAdapter = {
      source: "KIO",
      label: "KIO (test)",
      progress: (store) => {
        const next = store.state<{ next: number }>("KIO")?.next;
        return next === undefined ? "nie rozpoczęto" : next >= 6 ? "pobrane w całości (2026-11-20); dociąganie nowych" : `pełne pobieranie: nr ${next}`;
      },
      async run(ctx) {
        let next = ctx.db.state<{ next: number }>("KIO")?.next ?? 0;
        while (ctx.open && next < 6) {
          await ctx.get(`https://example.test/kio/${next}`);
          next += 1;
          ctx.db.saveState("KIO", { next, max: 6, completedAt: next >= 6 ? "2026-11-20T00:00:00Z" : null });
        }
      }
    };
    const fetcher = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
    const kio = () => caseLawSyncStatus().sources.find((item) => item.source === "KIO");
    const first = startCaseLawSync({ adapters: [adapter], fetcher, budget: 2, gapMs: 50, database: () => db, intervalMs: 3_600_000 });
    buildCaseLawSource("KIO");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    // The application closes mid-build: the build is still listed, the cursor saved.
    first();
    stopCaseLawBuild("KIO");
    await vi.waitFor(() => expect(kio()?.running).toBe(false), { timeout: 2_000 });
    expect(kio()?.phase).toBe("PARTIAL");
    db.saveState("BUILD:sources", ["KIO"]);
    fetcher.mockClear();
    const second = startCaseLawSync({ adapters: [adapter], fetcher, budget: 2, gapMs: 0, database: () => db, intervalMs: 3_600_000 });
    expect(kio()?.building).toBe(true);
    await vi.waitFor(() => expect(kio()).toMatchObject({ building: false, running: false, phase: "COMPLETE" }), { timeout: 2_000 });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(["https://example.test/kio/2", "https://example.test/kio/3", "https://example.test/kio/4", "https://example.test/kio/5"]);
    expect(db.state("BUILD:sources")).toBeNull();
    second();
  });
});
