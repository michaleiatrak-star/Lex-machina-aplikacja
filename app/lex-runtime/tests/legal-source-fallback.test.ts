import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LegalSourceFallbackStore, withSourceFallback } from "../src/legal-source-fallback.js";

const found = JSON.stringify({ status: "FOUND", celex: "32016R0679", tytul: "RODO", obowiazuje: true });
const failed = JSON.stringify({ status: "ERROR", detail: "fetch failed" });

describe("kopia awaryjna EUR-Lex", () => {
  it("zapamiętuje odpowiedź FOUND i podaje ją z datą, gdy źródło zawodzi", () => {
    const store = new LegalSourceFallbackStore(fs.mkdtempSync(path.join(os.tmpdir(), "lex-eu-")));
    const args = { celex: "32016R0679" };
    expect(withSourceFallback(store, "eurlex_lookup", args, found)).toBe(found);

    for (const outage of [failed, null]) {
      const copy = JSON.parse(withSourceFallback(store, "eurlex_lookup", args, outage)!);
      expect(copy).toMatchObject({ status: "FOUND", tytul: "RODO", kopia_lokalna: true });
      expect(copy.uwaga).toMatch(/^KOPIA LOKALNA — dane pobrane \d{4}-\d{2}-\d{2}; źródło chwilowo niedostępne/u);
    }
  });

  it("bez kopii przekazuje błąd, a innych narzędzi nie dotyka", () => {
    const store = new LegalSourceFallbackStore(fs.mkdtempSync(path.join(os.tmpdir(), "lex-eu-")));
    expect(withSourceFallback(store, "eurlex_lookup", { celex: "31993L0013" }, failed)).toBe(failed);
    expect(withSourceFallback(store, "eurlex_lookup", { celex: "31993L0013" }, null)).toBeNull();
    expect(withSourceFallback(store, "saos_search", { fraza: "x" }, failed)).toBe(failed);
  });
});
