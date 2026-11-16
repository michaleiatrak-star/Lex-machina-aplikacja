import { describe, expect, it } from "vitest";
import { credibilityGoals, statementPairs, witnessStatements } from "../src/witness-statements.js";
import { samePersonGroups } from "../src/privacy/identity-legend.js";

const MARCH = `Sygn. akt VII P 94/25
Dnia,17 marca 2026 r.
00:16:23
W tym miejscu stawił się świadek Yurii Kast.
Staje świadek – Yurii Kast
lat – 40, pouczony, zeznaje:
Powód był zatrudniony na początku jako informatyk, a później został rekruterem.
- Po rozwiązaniu umowy powód wysyłał mi wiadomości smsowo. Trwało to może 3 miesiące. Ostatnią wiadomość otrzymałem w zeszłym roku.
00:36:23
Świadka zwolniono o godz. 9:39.`;
const NOVEMBER = `Sygn. akt: XI P 27/26
Dnia 13 listopada 2026 r.
00:06:39      Świadek Jurij Kast - lat 41, pouczony, po odebraniu przyrzeczenia zeznaje:
           - Ja współpracowałem z powodem wówczas kiedy zajmował się rekrutacją pracowników, a później jako programista już nie.
           - Dostawałem wiadomości raz na miesiąc.
           - Ostatnią wiadomość od powoda dostałem na Whatsapp w marcu 2026r.
00:31:46   Sąd postanowił rozprawę odroczyć`;

describe("the same witness in two hearings (universal: no topics or words per case)", () => {
  it("one person across transliterations; a different given name stays another person", () => {
    const names: Record<string, string> = { A: "Yurii Kast", B: "Jurij Kast", C: "Anna Kast" };
    expect(samePersonGroups(["A", "B", "C"], (token) => names[token] ?? null)).toEqual([["A", "B"]]);
  });

  it("statements are taken from each record and paired by topic, the differences marked", () => {
    const march = witnessStatements("doc_march", 0, MARCH);
    const november = witnessStatements("doc_november", 0, NOVEMBER);
    expect([...march.keys()]).toEqual(["Yurii Kast"]);
    expect(march.get("Yurii Kast")!.every((item) => item.heading === "VII P 94/25, 17 marca 2026")).toBe(true);
    const pairs = statementPairs(new Map([["Kast", [...march.get("Yurii Kast")!, ...november.get("Jurij Kast")!]]]));
    const last = pairs.find((pair) => /Ostatnią wiadomość/u.test(pair.first.text) && /Ostatnią wiadomość/u.test(pair.second.text));
    expect(last?.differences.join(" ")).toContain("zeszlym roku");
    expect(last?.first.documentId).not.toBe(last?.second.documentId);
    const roles = pairs.find((pair) => /informatyk/u.test(pair.first.text) && /programista/u.test(pair.second.text));
    expect(roles).toBeTruthy();
    expect(credibilityGoals(pairs)[0]).toMatch(/^Wykazać sprzeczność lub niespójność zeznań świadka Kast w temacie: /u);
  });
});

describe("the testimony matrix: topics × records, facts taken from it", async () => {
  const { testimonyMatrix, matrixGoals } = await import("../src/witness-statements.js");
  const s = (documentId: string, heading: string, text: string) => ({ documentId, chunkIndex: 0, heading, text });
  const M = "VII P 94/25, 17 marca 2026";
  const N = "XI P 27/26, 13 listopada 2026";
  const statements = [
    s("m", M, "Po rozwiązaniu umowy powód wysyłał mi wiadomości smsowo, w których straszył mnie przepisami karnymi."),
    s("m", M, "Trwało to może 3 miesiące."),
    s("m", M, "Wynagrodzenie płatne jest 10-go każdego miesiąca na konto bankowe."),
    s("m", M, "Opłaty za zezwolenia ponosił wyłącznie prezes."),
    s("n", N, "Wysyłał na Whatsapp wiadomości że mamy jako świadkowie mówić prawdę."),
    s("n", N, "Dostawałem je raz na miesiąc."),
    s("n", N, "Na spotkaniu pracowników poinformowano o zakazie kontaktu."),
    s("n", N, "Po zwolnieniu zmieniono hasła dostępu.")
  ];
  const rows = testimonyMatrix(statements);

  it("a statement that continues the previous one stays in its topic; the topic heard in both records comes first", () => {
    const first = rows[0]!;
    expect(first.byRecord.map((column) => column.documentId).sort()).toEqual(["m", "n"]);
    const texts = first.byRecord.flatMap((column) => column.statements.map((item) => item.text));
    expect(texts).toContain("Trwało to może 3 miesiące.");
    expect(texts).toContain("Dostawałem je raz na miesiąc.");
    expect(first.differences.join(" ")).toContain("raz na miesiac");
  });

  it("one goal per topic heard in both records", () => {
    expect(matrixGoals("Kast", rows)).toHaveLength(rows.filter((row) => row.byRecord.length >= 2).length);
  });
});
