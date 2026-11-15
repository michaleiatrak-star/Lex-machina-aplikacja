import { afterEach, describe, expect, it, vi } from "vitest";
import { LegalFederationToolRuntime } from "./legal-federation-tool-runtime.js";
import { clearOutagesForTest, isOutage, markOutage, recentOutage } from "./source-outage.js";

afterEach(() => clearOutagesForTest());

describe("źródło bez odpowiedzi nie jest pytane ponownie przez kilka minut", () => {
  it("limit czasu i błąd połączenia to awaria; weryfikacja antybotowa, 403 i odmowa polityki nie", () => {
    expect(isOutage("SAOS: po 3 próbach przekroczony limit czasu")).toBe(true);
    expect(isOutage("TypeError: fetch failed (ECONNRESET)")).toBe(true);
    expect(isOutage("HTTP_503 orzeczenia.nsa.gov.pl")).toBe(true);
    expect(isOutage("SN_WERYFIKACJA_WYMAGANA HTTP_403 captcha")).toBe(false);
    expect(isOutage("LAW_SOURCE_VERIFICATION_REQUIRED:sip.lex.pl")).toBe(false);
    expect(isOutage("CASE_DATA_FORBIDDEN")).toBe(false);
    markOutage("SAOS", 0);
    expect(recentOutage("saos", 60_000)).toBe(4);
    expect(recentOutage("saos", 5 * 60_000 + 1)).toBe(0);
  });

  it("federacja: druga próba tego samego źródła po limicie czasu wraca od razu, inne źródła działają", async () => {
    const runtime = new LegalFederationToolRuntime();
    const execute = vi
      .spyOn(runtime as unknown as { execute: (call: unknown) => Promise<string> }, "execute")
      .mockImplementation(async (call) => {
        if ((call as { input: { source: string } }).input.source === "saos") throw new Error("SAOS_TIMEOUT: po 3 próbach przekroczony limit czasu");
        return JSON.stringify({ status: "OK", results: [] });
      });
    const call = (id: string, source: string) => ({ id, name: "search_federated_legal_sources", input: { source, query: "SDI 8/12" } });
    const [first] = await runtime.runTools([call("a", "saos")]);
    expect(JSON.parse(first!.content).status).toBe("SOURCE_UNAVAILABLE");
    const [again, other] = await runtime.runTools([call("b", "saos"), call("c", "sn")]);
    expect(JSON.parse(again!.content)).toMatchObject({ status: "SOURCE_UNAVAILABLE", error: "SOURCE_RECENTLY_UNAVAILABLE" });
    expect(JSON.parse(other!.content).status).toBe("OK");
    // saos asked once, sn once: the repeated saos call never reached the connector.
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
