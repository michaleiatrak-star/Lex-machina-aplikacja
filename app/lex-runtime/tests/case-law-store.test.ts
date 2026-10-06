import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseLawStore, caseLawRepository, configureCaseLawStore, courtOfCard } from "../src/case-law-store.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { LegalVerificationToolRuntime } from "../src/verification-tool-runtime.js";
import { CaseLawPreviewService } from "../src/case-law-preview.js";
import { SupremeCourtCaseVerifier, supremeCourtCardId } from "../src/case-law-verifier.js";

const CARD = "https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ZuUySp8Bw1HnVDW6c5lg";
const TEXT = "Sąd Najwyższy, sygn. III CZP 25/11. Uchwała: wierzyciel może dochodzić roszczenia w całości.";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function snText(html: string): Response {
  return json({ data: [{ success: true, data: { raw: Buffer.from(html, "utf8").toString("base64") } }] });
}

let dir = "";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-case-law-"));
});
afterEach(() => {
  configureCaseLawStore(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("local copies of decisions keyed by their card", () => {
  it("keeps the first copy and fills in missing metadata only", () => {
    const store = new CaseLawStore(dir);
    expect(courtOfCard(CARD)).toBe("SN");
    expect(store.put({ cardUrl: CARD, text: "za krótko" })).toBeNull();
    const first = store.put({ cardUrl: CARD, text: TEXT, fetchedAt: "2026-10-05T10:00:00.000Z" })!;
    expect(first).toMatchObject({ cardUrl: CARD, court: "SN", text: TEXT, fetchedAt: "2026-10-05T10:00:00.000Z" });
    const second = store.put({ cardUrl: CARD, text: `${TEXT} inna wersja`, signature: "III CZP 25/11", date: "2011-10-18" })!;
    expect(second.text).toBe(TEXT);
    expect(second.sha256).toBe(first.sha256);
    expect(second).toMatchObject({ signature: "III CZP 25/11", date: "2011-10-18", fetchedAt: first.fetchedAt });
    expect(new CaseLawStore(dir).get(CARD)?.signature).toBe("III CZP 25/11");
    expect(store.get(CARD.replace("https://sn.pl", "https://www.sn.pl"))?.text).toBe(TEXT);
    expect(store.get("https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=inne")).toBeNull();
  });

  it("previews from the network once, then from the case's copy; the card stays the source", async () => {
    configureCaseLawStore(dir);
    const url = "https://orzeczenia.uzp.gov.pl/Home/Details/12345";
    const fetch = vi.fn(async () => new Response(`<html><body><p>Sygn. akt: KIO 512/25</p><p>${TEXT}</p></body></html>`, { status: 200, headers: { "content-type": "text/html" } }));
    const first = await new CaseLawPreviewService(fetch as never).preview({ sourceUrl: url, passage: "wierzyciel może dochodzić roszczenia", caseId: "sprawa-1" });
    expect(first).toMatchObject({ source: "NETWORK", match: "EXACT" });
    const second = await new CaseLawPreviewService(fetch as never).preview({ sourceUrl: url, passage: "wierzyciel może dochodzić roszczenia", caseId: "sprawa-1" });
    expect(second).toMatchObject({ source: "LOCAL", match: "EXACT", storedAt: first.storedAt });
    expect(second.html).toContain(`Karta orzeczenia (źródło): <a href="${url}">`);
    expect(fetch).toHaveBeenCalledTimes(1);
    const copy = await new CaseLawPreviewService(fetch as never).copy({ sourceUrl: url, signature: "KIO 512/25", caseId: "sprawa-1" });
    expect(copy).toMatchObject({ cardUrl: url, court: "KIO", signature: "KIO 512/25" });
    expect(fetch).toHaveBeenCalledTimes(1);
    // Library off: the copy is only in that case; another case downloads its own.
    expect(caseLawRepository()?.catalog()).toEqual([]);
    await new CaseLawPreviewService(fetch as never).preview({ sourceUrl: url, caseId: "sprawa-2" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("with the library on catalogues decisions by court, signature and date, searchable by the model", async () => {
    configureCaseLawStore(dir);
    const repository = caseLawRepository()!;
    expect(repository.libraryEnabled()).toBe(false);
    repository.setLibraryEnabled(true);
    repository.put({ cardUrl: CARD, text: TEXT, signature: "III CZP 25/11", date: "2011-10-18", form: "uchwała" });
    repository.put({ cardUrl: "https://orzeczenia.nsa.gov.pl/doc/ABCDEF1234", text: "Naczelny Sąd Administracyjny oddalił skargę kasacyjną organu w sprawie podatku.", signature: "II FSK 1/20" });
    expect(repository.catalog().map((entry) => entry.signature).sort()).toEqual(["II FSK 1/20", "III CZP 25/11"]);
    expect(repository.catalog("czp 25/11")[0]).toMatchObject({ court: "SN", signature: "III CZP 25/11", form: "uchwała" });
    expect(repository.catalog("skargę kasacyjną")[0]?.snippet).toContain("skargę kasacyjną");
    const runtime = new LegalVerificationToolRuntime(new VerificationLedger());
    const [result] = await runtime.runTools([{ id: "l1", name: "search_case_law_library", input: { query: "III CZP 25/11" } }]);
    expect(JSON.parse(result!.content)).toMatchObject({ status: "FOUND", entries: [{ cardUrl: CARD, signature: "III CZP 25/11" }] });
    expect(repository.remove(CARD)).toBe(true);
    expect(repository.catalog("III CZP 25/11")).toEqual([]);
    repository.setLibraryEnabled(false);
    const [off] = await runtime.runTools([{ id: "l2", name: "search_case_law_library", input: { query: "II FSK" } }]);
    expect(JSON.parse(off!.content).status).toBe("DISABLED");
  });
});

describe("SN: the card picks the record and the verified text is stored", () => {
  it("reads the card ID from a card URL or a bare ID", () => {
    expect(supremeCourtCardId(CARD)).toBe("ZuUySp8Bw1HnVDW6c5lg");
    expect(supremeCourtCardId("ZuUySp8Bw1HnVDW6c5lg")).toBe("ZuUySp8Bw1HnVDW6c5lg");
    expect(supremeCourtCardId("III CZP 25/11")).toBeNull();
  });

  it("chooses the record of the given card among exact duplicates and saves its text under the card", async () => {
    configureCaseLawStore(dir);
    caseLawRepository()!.setLibraryEnabled(true);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("task=searchOrzeczenia")) {
        return json({
          data: [{
            data: [
              { id: "AbCdEf123456ghIJ", sygnatura_sprawy: "III CZP 25/11", data_wydania: "2011-10-18" },
              { id: "ZuUySp8Bw1HnVDW6c5lg", sygnatura_sprawy: "III CZP 25/11", data_wydania: "2011-10-18", forma_orzeczenia: "uchwała" }
            ]
          }]
        });
      }
      expect(url).toContain("id=ZuUySp8Bw1HnVDW6c5lg");
      return snText(`<html><body><p>${TEXT}</p></body></html>`);
    });
    const result = await new SupremeCourtCaseVerifier(fetcher, () => "2026-10-05T10:00:00.000Z").verify({
      claim: "sygn. III CZP 25/11",
      signature: "III CZP 25/11",
      toolCallId: "case-card-1",
      cardUrl: CARD
    });
    expect(result.status).toBe("FOUND");
    expect(result.record?.sourceUrl).toBe(CARD);
    expect(caseLawRepository()?.library.get(CARD)).toMatchObject({ court: "SN", signature: "III CZP 25/11", date: "2011-10-18", form: "uchwała" });
    expect(caseLawRepository()?.library.get(CARD)?.text).toContain("wierzyciel może dochodzić roszczenia");
  });
});
