import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CaseLawDatabase } from "../src/case-law-db.js";
import { buildCaseLawSource, caseLawSyncStatus, startCaseLawSync, stopCaseLawBuild, type SyncAdapter } from "../src/case-law-sync.js";

// A fabricated source of 5 pages; each run may ask 2 of them.
const db = new CaseLawDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "lex-build-")));
let page = 0;
const adapter: SyncAdapter = {
  source: "KIO",
  label: "KIO (test)",
  progress: () => `strona ${page}`,
  async run(ctx) {
    while (ctx.open && page < 5) {
      await ctx.get(`https://example.test/kio?page=${page}`);
      page += 1;
    }
  }
};
const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
const kio = () => caseLawSyncStatus().sources.find((item) => item.source === "KIO");
const previous = process.env.LEX_CASE_LAW_SYNC;
process.env.LEX_CASE_LAW_SYNC = "0";
const stop = startCaseLawSync({ adapters: [adapter], fetcher, budget: 2, gapMs: 0, database: () => db, intervalMs: 3_600_000 });

afterAll(() => {
  stop();
  if (previous === undefined) delete process.env.LEX_CASE_LAW_SYNC;
  else process.env.LEX_CASE_LAW_SYNC = previous;
});

describe("the administrator builds a source on request (no server mode)", () => {
  it("nothing is downloaded until asked", () => {
    expect(fetcher).not.toHaveBeenCalled();
    expect(caseLawSyncStatus().active).toBe(false);
  });

  it("batch after batch until the source is caught up, then the build ends by itself", async () => {
    expect(buildCaseLawSource("KIO")).toBe(true);
    await vi.waitFor(() => expect(kio()).toMatchObject({ building: false, running: false }), { timeout: 2_000 });
    expect(kio()?.lastRun).toMatchObject({ requests: 1 });
    expect(page).toBe(5);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("stop ends the build after the batch in progress; an unknown source is refused", async () => {
    page = 0;
    fetcher.mockClear();
    buildCaseLawSource("KIO");
    stopCaseLawBuild("KIO");
    await vi.waitFor(() => expect(kio()?.running).toBe(false), { timeout: 2_000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(buildCaseLawSource("NIEZNANE")).toBe(false);
  });
});
