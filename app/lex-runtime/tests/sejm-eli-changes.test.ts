import { describe, expect, it } from "vitest";
import { affectedTrackedActs, eliSince, fetchEliChanges, nextEliSince } from "../src/eli-changes.js";
import { actName, billsAmending, latestStage, pendingAmendmentLine, placeLegislativeNotes, SejmPendingActs } from "../src/sejm-pending-acts.js";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const PROCESSES = [
  { number: "2416", documentTypeEnum: "BILL", title: "Poselski projekt ustawy o zmianie ustawy - Kodeks pracy oraz ustawy o świadczeniach pieniężnych" },
  { number: "900", documentTypeEnum: "BILL", title: "Rządowy projekt ustawy o zmianie ustawy - Kodeks karny wykonawczy" },
  { number: "901", documentTypeEnum: "BILL", passed: true, closureDate: "2026-05-01", title: "Rządowy projekt ustawy o zmianie ustawy - Kodeks cywilny" },
  { number: "17", documentTypeEnum: "DRAFT_RESOLUTION", title: "Projekt uchwały w sprawie zmiany Regulaminu Sejmu" }
];

describe("pending bills for cited acts (task 08.4a)", () => {
  it("names the act from its ELI title", () => {
    expect(actName("Ustawa z dnia 26 czerwca 1974 r. – Kodeks pracy")).toBe("kodeks pracy");
    expect(actName("Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług")).toBe("o podatku od towarów i usług");
  });

  it("finds a pending bill amending the act, not a passed one nor a longer act's", () => {
    expect(billsAmending("kodeks pracy", PROCESSES).map((item) => item.number)).toEqual(["2416"]);
    expect(billsAmending("kodeks cywilny", PROCESSES)).toEqual([]);
    expect(billsAmending("kodeks karny", PROCESSES, ["kodeks karny wykonawczy"])).toEqual([]);
  });

  it("gives a line with the print and the latest stage, and none for an act without a bill", async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith("/sejm/term")) return json([{ num: 10, current: true }]);
      if (url.includes("/processes?")) return json(PROCESSES);
      if (url.endsWith("/processes/2416")) return json({ stages: [{ stageName: "Skierowanie do I czytania", date: "2026-10-02" }, { stageName: "I czytanie w komisjach", date: "2026-11-05", children: [] }] });
      return new Response("", { status: 404 });
    };
    const source = new SejmPendingActs(fetcher as never);
    const found = await source.forActs(["Ustawa z dnia 26 czerwca 1974 r. – Kodeks pracy", "Ustawa z dnia 23 kwietnia 1964 r. – Kodeks cywilny"]);
    expect(found).toEqual([{ act: "kodeks pracy", name: "Kodeks pracy", number: "2416", term: 10, stage: "I czytanie w komisjach", stageDate: "2026-11-05" }]);
    expect(pendingAmendmentLine(found[0]!)).toContain("aktu Kodeks pracy — druk nr 2416 (10. kadencja), etap: I czytanie w komisjach (2026-11-05)");
  });

  it("places the note under the paragraph citing the act, not inside a table", () => {
    const text = "Podstawa: art. 94 k.p. ✅\ndalszy ciąg akapitu.\n\n| art. 94 k.p. | x |\n\nKoniec.";
    const out = placeLegislativeNotes(text, [{ anchors: ["art. 94 k.p."], line: "Prace legislacyjne: X" }]);
    expect(out).toBe("Podstawa: art. 94 k.p. ✅\ndalszy ciąg akapitu.\n\n> Prace legislacyjne: X\n\n| art. 94 k.p. | x |\n\nKoniec.");
    expect(placeLegislativeNotes("Bez powołań.", [{ anchors: ["art. 1"], line: "N" }])).toBe("Bez powołań.\n\n> N");
  });

  it("latest stage across children", () => {
    expect(latestStage([{ stageName: "A", date: "2026-01-01", children: [{ stageName: "B", date: "2026-03-01" }] }, { stageName: "C", date: "2026-02-01" }])).toEqual({ name: "A", date: "2026-03-01" });
    // Druk 384 (10. kadencja): after the first reading, a vote and a referral to committee, then nothing.
    const stage = latestStage([{ stageName: "Projekt wpłynął do Sejmu", date: "2024-03-21" }, { stageName: "I czytanie na posiedzeniu Sejmu", date: "2024-06-28", children: [{ stageName: "Skierowanie", date: "2024-06-28" }, { stageName: "Głosowanie", date: "2024-06-28" }] }]);
    expect(stage).toEqual({ name: "I czytanie na posiedzeniu Sejmu", date: "2024-06-28" });
    const line = pendingAmendmentLine({ act: "kodeks pracy", name: "Kodeks pracy", number: "384", term: 10, stage: stage!.name, stageDate: stage!.date }, Date.parse("2026-11-24"));
    expect(line).toContain("etap: I czytanie na posiedzeniu Sejmu, bez dalszych prac od 2024-06-28");
  });
});

describe("ELI changes feed (task 08.4b)", () => {
  it("pages /eli/changes/acts and marks the tracked acts it touches", async () => {
    const urls: string[] = [];
    const page = (offset: number) => (offset === 0 ? Array.from({ length: 500 }, (_, i) => ({ ELI: `DU/2026/${2000 + i}`, changeDate: "2026-11-20T09:00:00" })) : [
      { ELI: "DU/2026/1526", changeDate: "2026-11-21T10:00:00", references: { "Akty zmienione": [{ id: "DU/2025/1071" }] } },
      { ELI: "DU/2024/1061", changeDate: "2026-11-21T11:00:00" },
      { ELI: "DU/2026/9", changeDate: "2026-11-21T12:00:00", references: { "Podstawa prawna": [{ id: "DU/2023/1610" }] } }
    ]);
    const fetcher = async (url: string) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get("offset"));
      return json({ items: page(offset), totalCount: 503 });
    };
    const changed = await fetchEliChanges(eliSince("2026-11-20T00:00:00Z"), fetcher as never);
    expect(urls[0]).toContain("since=2026-11-20T00%3A00%3A00");
    expect(changed).toHaveLength(503);
    const tracked = [
      { eli: "DU/1974/141", currentEli: "DU/2025/1071" },
      { eli: "DU/1964/93", currentEli: "DU/2024/1061" },
      { eli: "DU/1997/553", currentEli: "DU/2023/1610" }
    ];
    expect(affectedTrackedActs(changed, tracked).sort()).toEqual(["DU/1964/93", "DU/1974/141"]);
    expect(nextEliSince(changed, "2026-11-24T08:00:00")).toBe("2026-11-21T12:00:00");
  });
});
