import { describe, expect, it } from "vitest";
import { euAct, euApplicationRule, euArticle, verifyEuArticle } from "../src/eu-law-verifier.js";

describe("akt UE z powołania", () => {
  it.each([
    ["RODO", "32016R0679"],
    ["art. 6 GDPR", "32016R0679"],
    ["AI Act", "32024R1689"],
    ["rozporządzenie (UE) 2016/679", "32016R0679"],
    ["dyrektywy 2008/48/WE", "32008L0048"],
    ["rozporządzenia (WE) nr 593/2008", "32008R0593"],
    ["rozporządzenie (UE) nr 1215/2012", "32012R1215"],
    ["dyrektywa 93/13/EWG", "31993L0013"],
    ["32022R2065", "32022R2065"]
  ])("%s -> %s", (reference, celex) => {
    expect(euAct(reference)?.celex).toBe(celex);
  });

  it("akty polskie zostają przy ELI", () => {
    for (const reference of ["KC", "Kodeks pracy", "ustawa o ochronie danych osobowych", "Dz.U. 2026 poz. 1245", "rozporządzenie Ministra Finansów z dnia 1 marca 2026 r."]) {
      expect(euAct(reference)).toBeNull();
    }
  });
});

const NEW = '<div class="eli-subdivision" id="art_6"><p class="oj-ti-art">Artykuł 6</p><div class="eli-title"><p class="oj-sti-art">Zgodność</p></div><div><p class="oj-normal">1.   Przetwarzanie jest zgodne z prawem.</p></div><div><p class="oj-normal">2.   Państwa członkowskie mogą.</p></div></div><div class="eli-subdivision" id="art_7"><p class="oj-ti-art">Artykuł 7</p></div>';
const OLD = '<p class="title-article-norm">Artykuł 25</p><p class="norm">1.  Jeżeli strony uzgodniły…</p><p class="title-article-norm">Artykuł 26</p><p class="norm">Inny.</p>';
const LAST = '<div class="eli-subdivision" id="art_113"><p class="title-article-norm">Artykuł 113</p><p>Wejście w życie i rozpoczęcie stosowania</p><p>Niniejsze rozporządzenie stosuje się od dnia 2 sierpnia 2026 r. Jednak rozdziały I i II stosuje się od dnia 2 lutego 2025 r.</p></div>';

describe("artykuł z tekstu Cellar", () => {
  it("nowy układ (eli-subdivision) i starszy (tytuł artykułu)", () => {
    expect(euArticle(NEW, "6")).toMatch(/Artykuł 6\nZgodność\n1\. Przetwarzanie/u);
    expect(euArticle(NEW, "6")).not.toContain("Artykuł 7");
    expect(euArticle(OLD, "25")).toMatch(/Artykuł 25\n1\. Jeżeli strony/u);
    expect(euArticle(OLD, "25")).not.toContain("Inny");
    expect(euArticle(OLD, "27")).toBeNull();
  });

  it("reguła stosowania etapami z ostatniego artykułu", () => {
    expect(euApplicationRule(NEW + LAST)).toMatch(/stosuje się od dnia 2 lutego 2025/u);
    expect(euApplicationRule(NEW)).toBeNull();
  });
});

function cellar(options: { inForce: string; versions: string[]; text: string }) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    if (input.includes("sparql")) {
      const query = new URLSearchParams(String(init?.body)).get("query") ?? "";
      const bindings = query.includes("STRSTARTS")
        ? options.versions.map((c) => ({ c: { value: c } }))
        : [{ inforce: { value: options.inForce }, title: { value: "Rozporządzenie" }, ...(options.inForce === "false" ? { end: { value: "2018-05-24" } } : {}) }];
      return new Response(JSON.stringify({ results: { bindings } }), { headers: { "content-type": "application/json" } });
    }
    return new Response(options.text, { headers: { "content-type": "application/xhtml+xml" } });
  };
}

describe("weryfikacja artykułu UE", () => {
  const base = { act: { celex: "32016R0679", name: "RODO" }, toolCallId: "t", today: "2026-10-16", now: "2026-10-16T10:00:00.000Z" };

  it("najnowsza wersja skonsolidowana do dziś; jednostka sprawdzona", async () => {
    const fetcher = cellar({ inForce: "true", versions: ["02016R0679-20160504", "02016R0679-20991231"], text: NEW });
    const ok = await verifyEuArticle({ ...base, fetcher, claim: "art. 6 ust. 2 RODO" });
    expect(ok.record.status).toBe("VERIFIED");
    expect(ok.version).toBe("02016R0679-20160504");
    expect(ok.laterVersions).toEqual(["02016R0679-20991231"]);
    expect(ok.record.sourceUrl).toBe("https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:02016R0679-20160504");
    expect((await verifyEuArticle({ ...base, fetcher, claim: "art. 6 ust. 9 RODO" })).record.status).toBe("UNVERIFIED");
    expect((await verifyEuArticle({ ...base, fetcher, claim: "art. 99 RODO" })).record.evidence).toMatch(/nie ma artykułu 99/u);
  });

  it("akt uchylony: bez VER", async () => {
    const result = await verifyEuArticle({ ...base, act: { celex: "31995L0046", name: "95/46" }, fetcher: cellar({ inForce: "false", versions: [], text: NEW }), claim: "art. 6 dyrektywy 95/46/WE" });
    expect(result.record.status).toBe("UNVERIFIED");
    expect(result.record.evidence).toMatch(/koniec obowiązywania 2018-05-24/u);
  });
});
