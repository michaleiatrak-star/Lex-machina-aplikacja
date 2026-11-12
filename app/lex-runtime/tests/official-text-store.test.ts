import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OfficialTextStore, OFFICIAL_TEXT_CHECK_MS, type OfficialTextSource } from "../src/official-text-store.js";

// The consolidated text of the Code of Bar Ethics, as the Bar's council publishes it (public).
const PDF = fs.readFileSync(path.join(__dirname, "fixtures/kea-tekst-jednolity-2026.pdf"));
const SOURCE: OfficialTextSource = { key: "KEA", name: "Kodeks Etyki Adwokackiej", issuer: "NRA", url: "https://www.adwokatura.pl/kea.pdf", version: "t.j. 174/2026", unit: "§" };

function store(responses: Array<Uint8Array | number>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "official-texts-"));
  let clock = Date.parse("2026-11-12T10:00:00Z");
  let calls = 0;
  const instance = new OfficialTextStore(dir, async () => {
    const next = responses[Math.min(calls++, responses.length - 1)]!;
    return typeof next === "number" ? { ok: false, status: next, arrayBuffer: async () => new ArrayBuffer(0) } : { ok: true, status: 200, arrayBuffer: async () => next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength) as ArrayBuffer };
  }, () => clock);
  return { instance, dir, advance: (ms: number) => (clock += ms), calls: () => calls };
}

describe("local copies of official texts outside ELI", () => {
  it("downloaded once, split into units, read locally afterwards", async () => {
    const { instance, calls } = store([PDF]);
    const first = await instance.ensure(SOURCE);
    expect(first?.from).toBe("DOWNLOADED");
    expect(first?.copy.units["16"]).toMatch(/^§ 16\. W razie konieczności .* grozić ściganiem karnym lub dyscyplinarnym\.$/u);
    expect(Object.keys(first!.copy.units).length).toBeGreaterThan(50);
    const again = await instance.ensure(SOURCE);
    expect(again?.from).toBe("LOCAL");
    expect(calls()).toBe(1);
    expect(instance.list()[0]).toMatchObject({ key: "KEA", version: "t.j. 174/2026" });
    expect(instance.changes().map((change) => change.kind)).toEqual(["ADDED"]);
    expect(instance.search("grozić ściganiem karnym")[0]).toMatchObject({ key: "KEA", unit: "16" });
  });

  it("after the check period: the same file renews the date, a new text replaces the copy and is logged", async () => {
    const { instance, advance } = store([PDF, PDF, new Uint8Array([...PDF.subarray(0, PDF.length - 1), 0x0a])]);
    await instance.ensure(SOURCE);
    advance(OFFICIAL_TEXT_CHECK_MS + 1);
    expect((await instance.ensure(SOURCE))?.from).toBe("LOCAL");
    advance(OFFICIAL_TEXT_CHECK_MS + 1);
    expect((await instance.ensure(SOURCE))?.from).toBe("UPDATED");
    expect(instance.changes().map((change) => change.kind)).toEqual(["ADDED", "UPDATED"]);
  });

  it("the source down: the local copy, said as such; nothing at all: null", async () => {
    const { instance, advance } = store([PDF, 503]);
    await instance.ensure(SOURCE);
    advance(OFFICIAL_TEXT_CHECK_MS + 1);
    expect((await instance.ensure(SOURCE))?.from).toBe("LOCAL_STALE");
    expect(await store([503]).instance.ensure(SOURCE)).toBeNull();
  });
});
