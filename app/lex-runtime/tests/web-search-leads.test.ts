import { describe, expect, it } from "vitest";
import { classifyWebSearchHits, webSearchLeads } from "../src/web-search.js";

// Results from a search engine, LEX/Legalis and law portals are leads (signatures, amendments,
// dates of entry into force), each verified at its official source by the gradation of sources.

describe("leads in web search results", () => {
  it("extracts signatures with the tool that verifies them, Dz.U. references with ELI and dates of entry into force", () => {
    const leads = webSearchLeads(
      "Wyrok SN z 12 maja 2021 r., II CSKP 89/21; wyrok NSA I OSK 1234/20. Nowelizacja Dz. U. z 2025 r. poz. 1085 wchodzi w życie z dniem 23 sierpnia 2025 r."
    );
    expect(leads.signatures?.map((item) => item.signature)).toEqual(["II CSKP 89/21", "I OSK 1234/20"]);
    expect(leads.signatures?.[0]?.verifyWith).toMatch(/verify_case_reference/u);
    expect(leads.signatures?.[1]?.verifyWith).toMatch(/CBOSA.*bez awansu/u);
    expect(leads.journals).toEqual([{ citation: "Dz.U. 2025 poz. 1085", eli: "DU/2025/1085" }]);
    expect(leads.entryIntoForce?.[0]).toMatch(/^wchodzi w życie z dniem 23 sierpnia 2025 r/u);
    expect(webSearchLeads("Ogólny artykuł o prawie najmu.")).toEqual({});
  });

  it("LEX and Legalis results are leads to verify, never sources; official hosts keep their verifiers", () => {
    const [lex, portal, sn] = classifyWebSearchHits([
      { title: "II CSKP 89/21 - wyrok SN", url: "https://sip.lex.pl/orzeczenia-i-pisma-urzedowe/orzeczenia-sadow/ii-cskp-89-21", snippet: "Teza: ..." },
      { title: "Nowelizacja kodeksu", url: "https://www.openlex.pl/news/x", snippet: "Dz. U. z 2026 r. poz. 533, obowiązuje od 1 stycznia 2027 r." },
      { title: "Wyrok", url: "https://www.sn.pl/sites/orzecznictwo/x.pdf", snippet: "" }
    ]);
    expect(lex!.sourceTier).toBe("R2B");
    expect(lex!.nextStep).toMatch(/do not cite it.*verify each at the official source/u);
    expect(lex!.leads?.signatures?.[0]?.signature).toBe("II CSKP 89/21");
    expect(portal!.sourceTier).toBe("R2B");
    expect(portal!.nextStep).toMatch(/^Lead, not a source/u);
    expect(portal!.leads?.journals?.[0]?.eli).toBe("DU/2026/533");
    expect(portal!.leads?.entryIntoForce?.[0]).toMatch(/^obowiązuje od 1 stycznia 2027/u);
    expect(sn!.sourceTier).toBe("R2A");
    expect(sn!.leads).toBeUndefined();
  });
});
