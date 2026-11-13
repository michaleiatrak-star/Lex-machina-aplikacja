import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogDue, catalogRefs, domainsByTitle, loadCatalog, refreshEliCatalog } from "./eli-catalog.js";

const API = "https://api.sejm.gov.pl/eli";
// A scripted ELI: two in-force announcements of consolidated texts (an older and a newer one of the same act) and a regulation.
function eli(calls: string[]) {
  const replies: Record<string, unknown> = {
    [`${API}/acts/search?publisher=DU&title=jednolitego&type=Obwieszczenie&inForce=1&limit=500&offset=0`]: {
      items: [
        { ELI: "DU/2024/100", announcementDate: "2024-01-10" },
        { ELI: "DU/2025/1490", announcementDate: "2025-10-01" },
        { ELI: "DU/2026/50", announcementDate: "2026-01-05" }
      ]
    },
    [`${API}/acts/DU/2024/100`]: { references: { "Tekst jednolity dla aktu": [{ id: "DU/2001/1371" }] } },
    [`${API}/acts/DU/2025/1490`]: { references: { "Tekst jednolity dla aktu": [{ id: "DU/2001/1371" }] } },
    [`${API}/acts/DU/2026/50`]: { references: { "Tekst jednolity dla aktu": [{ id: "DU/2016/1850" }] } },
    [`${API}/acts/DU/2001/1371`]: { title: "Ustawa z dnia 6 września 2001 r. o transporcie drogowym", type: "Ustawa", inForce: "IN_FORCE", references: { "Nowelizacje po tekście jednolitym": [{ id: "DU/2026/300" }] } },
    [`${API}/acts/DU/2016/1850`]: { title: "Rozporządzenie Ministra Zdrowia z dnia 7 listopada 2016 r. w sprawie recept", type: "Rozporządzenie", inForce: "IN_FORCE", references: {} }
  };
  return async (url: string) => {
    calls.push(url);
    const body = replies[url];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body };
  };
}

describe("ELI catalogue of every in-force act with a consolidated text", () => {
  it("takes the newest t.j. per base act, the amendments after it and the DR modules", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lex-catalog-"));
    const calls: string[] = [];
    const { catalog, complete } = await refreshEliCatalog({ directory, fetcher: eli(calls), gapMs: 0, mapDomains: (id) => (id === "DU/2025/1490" ? ["dr-09-budownictwo-srodowisko-energia-transport"] : []) });
    expect(complete).toBe(true);
    expect(catalog.acts["DU/2001/1371"]).toMatchObject({ tj: "DU/2025/1490", amendmentsAfter: ["DU/2026/300"], domainSource: "MAP" });
    expect(catalog.acts["DU/2016/1850"]).toMatchObject({ tj: "DU/2026/50", domains: ["dr-10-zdrowie-farmacja-zywnosc-rolnictwo"], domainSource: "TITLE" });
    expect(catalogRefs(catalog).map((act) => act.tj).sort()).toEqual(["DU/2025/1490", "DU/2026/50"]);
    expect(catalogDue(catalog, Date.parse(catalog.builtAt!) + 1_000)).toBe(false);
    // The next day: only the list is read again; nothing changed, nothing else is fetched.
    calls.length = 0;
    await refreshEliCatalog({ directory, fetcher: eli(calls), gapMs: 0 });
    expect(calls).toHaveLength(1);
  });

  it("continues an interrupted build where it stopped", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lex-catalog-"));
    const first: string[] = [];
    const part = await refreshEliCatalog({ directory, fetcher: eli(first), gapMs: 0, maxRequests: 3 });
    expect(part.complete).toBe(false);
    expect(Object.keys(loadCatalog(directory).notices)).toHaveLength(2);
    const second: string[] = [];
    const rest = await refreshEliCatalog({ directory, fetcher: eli(second), gapMs: 0 });
    expect(rest.complete).toBe(true);
    // The list again, the one announcement not read, the two base acts — not the two read before.
    expect(second).toHaveLength(4);
    expect(Object.keys(rest.catalog.acts).sort()).toEqual(["DU/2001/1371", "DU/2016/1850"]);
  });

  it("assigns DR modules by the issuing minister and the subject", () => {
    expect(domainsByTitle("Rozporządzenie Ministra Finansów z dnia 1 marca 2026 r. w sprawie deklaracji podatkowych")).toEqual(["dr-06-podatki-finanse-publiczne-aml"]);
    expect(domainsByTitle("Ustawa z dnia 26 czerwca 1974 r. Kodeks pracy")[0]).toBe("dr-04-prawo-pracy-zus-swiadczenia");
    expect(domainsByTitle("Ustawa z dnia 8 marca 1990 r. o samorządzie gminnym")[0]).toBe("dr-08-samorzad-terytorialny-prawo-lokalne");
    expect(domainsByTitle("Ustawa o czymś zupełnie innym")).toEqual(["dr-05-prawo-administracyjne-sadowoadministracyjne"]);
  });
});
