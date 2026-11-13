import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CaseLawDatabase, SAOS_DUMP, saosRecord, syncSaos } from "./case-law-db.js";
const item = (id, signature, date, extra = {}) => ({
    id,
    courtType: "COMMON",
    courtCases: [{ caseNumber: signature }],
    judgmentType: "SENTENCE",
    judgmentDate: date,
    judges: [{ name: "Anna Nowak" }],
    keywords: ["kara umowna"],
    textContent: `<p>Wyrok w sprawie ${signature}: kara umowna za zwłokę nie należy się, gdy odbiór nastąpił przed terminem.</p>`,
    division: { name: "I Wydział Cywilny", court: { name: "Sąd Okręgowy w Krakowie" } },
    modificationDate: `${date}T10:00:00.000`,
    ...extra
});
// A scripted SAOS dump: 2019 has two pages, 2020 one, later years nothing.
function dump(calls, pages) {
    return async (url) => {
        calls.push(url);
        const query = new URL(url).searchParams;
        const key = query.get("sinceModificationDate") ? `since:${query.get("pageNumber")}` : `${query.get("judgmentStartDate")?.slice(0, 4)}:${query.get("pageNumber")}`;
        const items = pages[key] ?? [];
        const next = pages[key.replace(/\d+$/u, (n) => String(Number(n) + 1))];
        return { ok: true, status: 200, json: async () => ({ items, links: [{ rel: "self" }, ...(next ? [{ rel: "next" }] : [])] }) };
    };
}
describe("local case-law database (SAOS first)", () => {
    const pages = {
        "2019:0": [item(1, "I C 10/19", "2019-03-01", { referencedCourtCases: [{ caseNumber: "II CSK 5/15" }], referencedRegulations: [{ journalYear: 1964, journalEntry: 16, journalTitle: "Kodeks cywilny" }] })],
        "2019:1": [item(2, "II CSK 5/15", "2019-06-01")],
        "2020:0": [item(3, "I ACa 7/20", "2020-02-01", { lowerCourtJudgments: [{ caseNumber: "I C 10/19" }] })]
    };
    it("reads year by year from the oldest, resumes an interrupted run from its cursor, then only changes", async () => {
        const db = new CaseLawDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "lex-caselaw-")));
        const now = () => new Date("2020-12-31T00:00:00.000Z");
        const first = [];
        const part = await syncSaos(db, { fetcher: dump(first, pages), maxPages: 1, gapMs: 0, now, firstYear: 2019 });
        expect(part).toMatchObject({ pages: 1, stored: 1, cursor: { phase: "FULL", year: 2019, page: 1 } });
        const second = [];
        const rest = await syncSaos(db, { fetcher: dump(second, pages), gapMs: 0, now, firstYear: 2019 });
        expect(second[0]).toContain(`${SAOS_DUMP}?pageSize=100&pageNumber=1&judgmentStartDate=2019-01-01`);
        expect(rest.cursor.phase).toBe("INCREMENTAL");
        expect(db.count("SAOS")).toBe(3);
        const third = [];
        await syncSaos(db, { fetcher: dump(third, pages), gapMs: 0, now, firstYear: 2019 });
        expect(third).toHaveLength(1);
        expect(third[0]).toContain("sinceModificationDate=");
        db.close();
    });
    it("keeps cards with their links, finds them by signature and text, and says who cites them", async () => {
        const db = new CaseLawDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "lex-caselaw-")));
        await syncSaos(db, { fetcher: dump([], pages), gapMs: 0, now: () => new Date("2020-12-31T00:00:00.000Z"), firstYear: 2019 });
        const [held] = db.bySignature("i  c 10 / 19");
        expect(held.card).toMatchObject({ source: "SAOS", court: "Sąd Okręgowy w Krakowie", judges: ["Anna Nowak"], url: "https://www.saos.org.pl/judgments/1" });
        expect(held.text).toContain("odbiór nastąpił przed terminem");
        const links = db.related(held.card.id);
        expect(links.cites).toEqual(expect.arrayContaining([{ kind: "CITES_CASE", target: "II CSK 5/15", label: null }, { kind: "CITES_ACT", target: "DU/1964/16", label: "Kodeks cywilny" }]));
        expect(links.citedBy).toEqual([{ id: "SAOS:3", signatures: ["I ACa 7/20"] }]);
        if (db.fts)
            expect(db.search("odbior przed terminem").map((card) => card.id).length).toBeGreaterThan(0);
        db.close();
    });
    it("does not rewrite a document whose version is the same", () => {
        const db = new CaseLawDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "lex-caselaw-")));
        const record = saosRecord(item(9, "III C 1/21", "2021-01-01"));
        expect(db.upsert(record.card, record.text, record.links)).toBe(true);
        expect(db.upsert(record.card, record.text, record.links)).toBe(false);
        expect(db.upsert({ ...record.card, modified: "2021-02-01T00:00:00.000" }, record.text, record.links)).toBe(true);
        db.close();
    });
});
