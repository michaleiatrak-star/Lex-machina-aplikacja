import { describe, expect, it } from "vitest";
import { SupremeCourtCaseVerifier, withSnSession, type CaseLawFetch } from "../src/case-law-verifier.js";
import { CaseLawSearchService } from "../src/case-law-search.js";
import { LEGAL_VERIFICATION_SYSTEM_APPENDIX, LegalVerificationToolRuntime, snVerificationNeeded } from "../src/verification-tool-runtime.js";
import { VerificationLedger } from "../src/verification-ledger.js";

// Błąd z czatu 2026-10-09: wyszukiwarka orzeczeń (konektor SN) otwierała okno weryfikacji
// sn.pl, a czat (search_case_law, verify_case_reference) nie: jego zapytania szły bez sesji
// zweryfikowanej przez użytkownika, a 403 Imperva kończyło się „blokadą techniczną”.
describe("sn.pl verification in the chat", () => {
  it("sends the verified session (cookies, its browser) to sn.pl only", async () => {
    const seen: Array<{ url: string; cookie: string | null; ua: string | null }> = [];
    const base: CaseLawFetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), cookie: headers.get("cookie"), ua: headers.get("user-agent") });
      return new Response("{}", { headers: { "content-type": "application/json" } });
    };
    const fetcher = withSnSession(base, () => ({ cookie: "incap_ses_1=abc; visid_incap_1=def", userAgent: "Mozilla/5.0 (X11; Linux) Test/1" }));
    await fetcher("https://sn.pl/index.php?x=1", { headers: { Cookie: "incap_ses_1=new; other=1", "User-Agent": "Mozilla/5.0 Default" } });
    await fetcher("https://www.saos.org.pl/api/search/judgments", { headers: { "User-Agent": "Mozilla/5.0 Default" } });
    expect(seen[0]!.cookie).toBe("incap_ses_1=new; visid_incap_1=def; other=1");
    expect(seen[0]!.ua).toBe("Mozilla/5.0 (X11; Linux) Test/1");
    expect(seen[1]!.cookie).toBeNull();
    expect(seen[1]!.ua).toBe("Mozilla/5.0 Default");
  });

  it("asks for the sn.pl verification window when sn.pl answers 403", async () => {
    const blocked: CaseLawFetch = async () => new Response("<html>Incapsula</html>", { status: 403, headers: { "content-type": "text/html" } });
    const runtime = new LegalVerificationToolRuntime(
      new VerificationLedger(),
      undefined,
      undefined,
      null,
      new SupremeCourtCaseVerifier(blocked),
      new CaseLawSearchService(blocked)
    );
    const [search] = await runtime.runTools([{ id: "1", name: "search_case_law", input: { source: "SN", query: "grupa przestępcza" } }]);
    expect(search!.content).toContain("SN_WERYFIKACJA_WYMAGANA");
    expect(search!.content).toMatch(/"reason":"SN_[A-Z_]*(?:HTTP_403|BOT_PROTECTION)"/);
    const [verify] = await runtime.runTools([
      { id: "2", name: "verify_case_reference", input: { claim: "wyrok SN", signature: "II KK 123/24", courtFamily: "SN" } }
    ]);
    expect(verify!.content).toContain("SN_WERYFIKACJA_WYMAGANA");
    expect(snVerificationNeeded("SN_SEARCH_HTTP_403")).toBe(true);
    expect(snVerificationNeeded("SN_SEARCH_HTTP_500")).toBe(false);
  });

  // Pokrycie SAOS: SN tylko do 2016, więc przy captchy sn.pl nowsze orzeczenia szuka się przez web_search.
  it("points to web_search and limits SAOS to SN rulings before 2017 when sn.pl needs a captcha", async () => {
    const blocked: CaseLawFetch = async () => new Response("<html>Incapsula</html>", { status: 403, headers: { "content-type": "text/html" } });
    const runtime = new LegalVerificationToolRuntime(
      new VerificationLedger(),
      undefined,
      undefined,
      null,
      new SupremeCourtCaseVerifier(blocked),
      new CaseLawSearchService(blocked)
    );
    const [search] = await runtime.runTools([{ id: "1", name: "search_case_law", input: { source: "SN", query: "grupa przestępcza" } }]);
    const instruction = String((JSON.parse(search!.content) as { instruction?: unknown }).instruction);
    expect(instruction).toContain("SN_WERYFIKACJA_WYMAGANA");
    expect(instruction).toContain("web_search");
    expect(instruction).toContain("only for SN rulings issued before 2017");
    expect(instruction).toContain("never conclude that the ruling does not exist");
    expect(instruction).not.toContain("it holds SN decisions with their text");
  });

  it("tells the model to find recent rulings with web_search, not SAOS", () => {
    expect(LEGAL_VERIFICATION_SYSTEM_APPENDIX).toContain("Topic search for recent rulings (SN after 2016, TK after 2015, KIO after 2018");
    expect(LEGAL_VERIFICATION_SYSTEM_APPENDIX).toContain("web_search (when available) with an abstract legal phrase, never case data");
    expect(LEGAL_VERIFICATION_SYSTEM_APPENDIX).toContain("signature known -> look it up by repertory in the official registry");
    expect(LEGAL_VERIFICATION_SYSTEM_APPENDIX).toContain("the thesis and any quote come only from the verified official text");
  });
});
