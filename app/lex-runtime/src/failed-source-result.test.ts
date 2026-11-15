import { describe, expect, it } from "vitest";
import { failedSourceResult } from "./session-executor.js";

describe("wynik odmowy lub awarii źródła nie jest kotwicą urzędową", () => {
  it("OUT_OF_SCOPE, weryfikacja sn.pl, niedostępność: porażka; trafienie: nie", () => {
    expect(failedSourceResult(JSON.stringify({ status: "OUT_OF_SCOPE", signature: "SDI 8/12", reason: "HTTP_403" }))).toBe(true);
    expect(failedSourceResult(JSON.stringify({ status: "SOURCE_UNAVAILABLE", error: "SOURCE_RECENTLY_UNAVAILABLE" }))).toBe(true);
    expect(failedSourceResult("SN_WERYFIKACJA_WYMAGANA: sygn. SDI 8/12")).toBe(true);
    expect(failedSourceResult(JSON.stringify({ status: "VERIFIED", signature: "SDI 8/12", text: "…" }))).toBe(false);
    expect(failedSourceResult(JSON.stringify({ status: "OK", results: [{ signature: "II CSKP 89/26" }] }))).toBe(false);
  });
});
