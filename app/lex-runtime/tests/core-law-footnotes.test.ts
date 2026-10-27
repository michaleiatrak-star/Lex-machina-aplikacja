import { describe, expect, it } from "vitest";
import {
  articleFootnotes,
  articleWording,
  extractPageFootnotes,
  protectPointLabels,
  noteDate,
  stripTrailingHeadings
} from "../src/core-law-footnotes.js";
import { joinLineItems } from "../src/pdf-text-extractor.js";

// Jak KP t.j. 2026/1245, art. 94: pkt 2b w dwóch brzmieniach, pkt 2c dodany, data w odnośniku 6.
const NOTES = {
  "6": "W brzmieniu ustalonym przez art. 1 pkt 1 lit. a ustawy z dnia 19 czerwca 2026 r. (Dz. U. poz. 1046) , która wejdzie w życie z dniem 5 listopada 2026 r.",
  "25": "W tym brzmieniu obowiązuje do wejścia w życie zmiany, o której mowa w odnośniku 26 .",
  "26": "W brzmieniu ustalonym przez art. 1 pkt 4 lit. a ustawy, o której mowa w odnośniku 6 .",
  "27": "Dodany przez art. 1 pkt 4 lit. b ustawy, o której mowa w odnośniku 6 ."
};
const ART_94 = [
  "Art. 94. Pracodawca jest obowiązany w szczególności:",
  "2a) organizować pracę;",
  "2b) 25 ) przeciwdziałać dyskryminacji w zatrudnieniu;",
  "2b) 26 ) przeciwdziałać wszelkiemu nierównemu traktowaniu oraz mobbingowi;",
  "2c) 27 ) przeciwdziałać naruszaniu godności pracownika;",
  "3) (uchylony)"
].join("\n");

describe("odnośniki t.j. z PDF", () => {
  it("przypisy z dołu strony wychodzą z treści; wiersz z wielką literą bez zwrotu odnośnika zostaje", () => {
    const { pages, footnotes } = extractPageFootnotes([
      "Art. 5. Tekst (Dz. U. z późn. zm. 3) ).\n3) Zmiany tekstu jednolitego wymienionej ustawy zostały ogłoszone\nw Dz. U. poz. 1.",
      "Art. 6. Definicje 2):\n2) Skarb Państwa – osoba prawna;"
    ]);
    expect(pages).toEqual(["Art. 5. Tekst (Dz. U. z późn. zm. 3) ).", "Art. 6. Definicje 2):\n2) Skarb Państwa – osoba prawna;"]);
    expect(footnotes["3"]).toBe("Zmiany tekstu jednolitego wymienionej ustawy zostały ogłoszone w Dz. U. poz. 1.");
  });

  it("znacznik „25 )” znika z treści, punkt „1)” zostaje", () => {
    expect(articleFootnotes("2b) 25 ) przeciwdziałać", NOTES)).toEqual({ text: "2b) przeciwdziałać", notes: ["25"] });
    expect(articleFootnotes("§ 2. 1) coś", { "1": "Zmiany" }).notes).toEqual([]);
  });

  it("data z odesłania „o której mowa w odnośniku 6”", () => {
    expect(noteDate(NOTES["26"], NOTES)).toBe("2026-11-05");
  });

  it("przez odesłanie data ustawy, nie data jednostki dopisana po średniku (u.ś.p. t.j. 2026/854, art. 17)", () => {
    const notes = {
      "4": "Dodany przez art. 13 pkt 1 ustawy z dnia 18 grudnia 2025 r. o zmianie ustawy o systemie ubezpieczeń społecznych oraz niektórych innych ustaw (Dz. U. z 2026 r. poz. 26), która weszła w życie z dniem 13 kwietnia 2026 r.; wejdzie w życie z dniem 1 stycznia 2027 r.",
      "6": "Dodany przez art. 13 pkt 2 lit. b ustawy, o której mowa w odnośniku 4.",
      "7": "Dodany przez art. 13 pkt 2 lit. b ustawy, o której mowa w odnośniku 4 ; wejdzie w życie z dniem 1 stycznia 2027 r."
    };
    expect(noteDate(notes["4"], notes)).toBe("2027-01-01");
    expect(noteDate(notes["6"], notes)).toBe("2026-04-13");
    expect(noteDate(notes["7"], notes)).toBe("2027-01-01");
    const article = "Art. 17. 1. Ubezpieczony traci prawo do zasiłku chorobowego.\n1a. 6 ) Pracą zarobkową jest każda czynność.\n1d. 7 ) Jeżeli jednak praca zarobkowa może być wykonywana.\n2. Zasiłek chorobowy nie przysługuje.";
    const wording = articleWording(article, notes, "2026-10-23");
    expect(wording.text).toContain("Pracą zarobkową");
    expect(wording.text).not.toContain("Jeżeli jednak");
    expect(wording.pending).toEqual([{ from: "2027-01-01", text: expect.stringContaining("Jeżeli jednak") }]);
  });

  it("podaje brzmienie obowiązujące w danym dniu; nowe i dodane jednostki czekają w pending", () => {
    const now = articleWording(ART_94, NOTES, "2026-10-12");
    expect(now.unresolved).toBe(false);
    expect(now.text).toContain("przeciwdziałać dyskryminacji");
    expect(now.text).not.toContain("mobbingowi");
    expect(now.text).not.toContain("2c)");
    expect(now.pending.map((item) => item.from)).toEqual(["2026-11-05", "2026-11-05"]);

    const later = articleWording(ART_94, NOTES, "2026-11-05");
    expect(later.text).toContain("mobbingowi");
    expect(later.text).toContain("2c) przeciwdziałać naruszaniu");
    expect(later.text).not.toContain("dyskryminacji w zatrudnieniu");
    expect(later.pending).toEqual([]);
  });

  it("bez daty w odnośniku brzmienia nie wybiera (unresolved)", () => {
    const notes = { ...NOTES, "6": "W brzmieniu ustalonym przez ustawę (Dz. U. poz. 1046)." };
    expect(articleWording(ART_94, notes, "2026-10-12").unresolved).toBe(true);
  });

  it("nagłówek rozdziału po artykule nie należy do artykułu", () => {
    expect(stripTrailingHeadings("Art. 6. Treść.\nTYTUŁ II\nOsoby\nDZIAŁ I\nOsoby fizyczne")).toBe("Art. 6. Treść.");
    expect(stripTrailingHeadings("Art. 23. Treść.\nRozdział II\nMiejsce zamieszkania")).toBe("Art. 23. Treść.");
  });
});

describe("łączenie elementów wiersza PDF", () => {
  const item = (str: string, x: number, width: number, eol = false) => ({ str, transform: [10, 0, 0, 10, x, 700], width, hasEOL: eol });
  it("wyraz rozbity przez pdf.js na dwa elementy bez odstępu wraca w całości; zwykły odstęp zostaje", () => {
    expect(joinLineItems([item("osoby ubezwłas", 100, 60), item("nowol-", 160, 25, true), item("nione", 50, 20)])).toBe("osoby ubezwłasnowol-\nnione");
    expect(joinLineItems([item("ustawa", 100, 30), item("kodeks", 133, 30)])).toBe("ustawa kodeks");
  });

  // Wiersz jak w ekstraktorze: odstępy zwinięte do jednej spacji.
  const line = (items: unknown[]) => joinLineItems(items).replace(/\s+/g, " ");
  it("pdf.js 4.x: stykające się elementy tej samej czcionki („Art” + „.”, „4” + „3a.”) bez spacji", () => {
    expect(line([item("Art", 72, 15), item(".", 87, 2.5), item(" ", 89.5, 2.5), item("21.", 92, 12.5)])).toBe("Art. 21.");
    expect(line([item("Art.", 72, 17.5), item(" ", 89.5, 2.5), item("4", 92, 5), item("3a.", 97, 12.5)])).toBe("Art. 43a.");
  });

  it("indeks górny i nawias znacznika odnośnika nie są doklejane („Art. 6 1 .”, „25 )”)", () => {
    const sup = (str: string, x: number, width: number) => ({ str, transform: [6.5, 0, 0, 6.5, x, 704], width, hasEOL: false });
    expect(line([item("Art. 6", 72, 25), sup("1", 97, 3.3), item(" .", 100.3, 5)])).toBe("Art. 6 1 .");
    expect(line([item("2b)", 72, 12), sup("25", 84, 6.6), sup(")", 90.6, 2.2)])).toBe("2b) 25 )");
  });
});

describe("zapis pdf.js 4.x w przypisach i znacznikach", () => {
  it("numer przypisu oddzielony od nawiasu w bloku drobnego druku („1 ) Niniejsza…”)", () => {
    const page = ["Art. 12. Nie mają zdolności do czynności prawnych.", "\u20631 ) Niniejsza ustawa wdraża dyrektywę 2000/31/WE."].join("\n");
    const { pages, footnotes } = extractPageFootnotes([page]);
    expect(pages[0]).toBe("Art. 12. Nie mają zdolności do czynności prawnych.");
    expect(footnotes["1"]).toBe("Niniejsza ustawa wdraża dyrektywę 2000/31/WE.");
  });

  it("znacznik sklejony z etykietą i po „(uchylony)” wybiera brzmienie (u.ś.u.d.e. art. 10)", () => {
    const notes = {
      "3": "Ze zmianą wprowadzoną przez ustawę, która wejdzie w życie z dniem 10 listopada 2024 r.",
      "8": "Obowiązuje do wejścia w życie zmiany, o której mowa w odnośniku 9.",
      "9": "Przez art. 26 pkt 3 ustawy, o której mowa w odnośniku 3."
    };
    const page = ["Art. 10. 8) 1. Zakazane jest przesyłanie informacji.", "2. Zgoda odbiorcy.", "Art. 10. (uchylony) 9)", "\u20638) Obowiązuje do wejścia w życie zmiany, o której mowa w odnośniku 9."].join("\n");
    const { pages } = extractPageFootnotes([page]);
    expect(pages[0]).toContain("(uchylony) 9 )");
    expect(articleWording(pages[0]!, notes, "2026-10-12").text.trim()).toBe("Art. 10. (uchylony)");
    expect(articleWording(pages[0]!, notes, "2024-10-01").text).toContain("Zakazane jest przesyłanie");
  });

  it("§ 1 w wierszu nagłówka artykułu dostaje swój odnośnik (KPC t.j. 2026/468, art. 131[1a])", () => {
    const notes = {
      "28": "W tym brzmieniu obowiązuje do wejścia w życie zmiany, o której mowa w odnośniku 29.",
      "29": "W brzmieniu ustalonym przez art. 1 pkt 11 lit. a ustawy, o której mowa w odnośniku 11 ; wejdzie w życie z dniem 1 czerwca 2026 r.",
      "30": "Dodany przez art. 1 pkt 11 lit. b ustawy, o której mowa w odnośniku 11 ; wejdzie w życie z dniem 1 czerwca 2026 r."
    };
    const text = [
      "Art. 131 [ 1a ] . § 1. 28 ) W razie niemożności doręczenia sąd doręcza pisma sądowe.",
      "§ 1. 29 ) W razie niemożności doręczenia sąd doręcza pisma sądowe oraz odpisy pism.",
      "§ 1 [ 1 ] . 30 ) Oświadczenie o wyborze sposobu doręczeń.",
      "§ 2. Pismo uznaje się za doręczone."
    ].join("\n");
    const now = articleWording(text, notes, "2026-10-27");
    expect(now.unresolved).toBe(false);
    expect(now.text).toBe("Art. 131 [ 1a ] . § 1. W razie niemożności doręczenia sąd doręcza pisma sądowe oraz odpisy pism.\n§ 1 [ 1 ] . Oświadczenie o wyborze sposobu doręczeń.\n§ 2. Pismo uznaje się za doręczone.");
    const before = articleWording(text, notes, "2026-05-01");
    expect(before.text).toBe("Art. 131 [ 1a ] . § 1. W razie niemożności doręczenia sąd doręcza pisma sądowe.\n§ 2. Pismo uznaje się za doręczone.");
    expect(before.pending.map((p) => p.from)).toEqual(["2026-06-01", "2026-06-01"]);
  });

  it("punkt „12 )” ze spacją nie jest znacznikiem odnośnika 12 (O.p. t.j. 2026/622, art. 3)", () => {
    const notes = { "12": "Aktualną wysokość kwoty na dany rok ogłasza minister." };
    const text = ["Art. 3. Ilekroć w ustawie jest mowa o:", "11) (uchylony)", "12 ) (uchylony)", "13) dokumencie elektronicznym – rozumie się dokument."].join("\n");
    expect(protectPointLabels(text)).toContain("\n12) (uchylony)\n");
    expect(articleFootnotes(text, notes).text).toContain("\n12) (uchylony)\n");
    expect(articleWording(text, notes, "2026-10-27").text).toContain("\n12) (uchylony)\n");
    expect(protectPointLabels("Art. 5. Kwota wynosi\n12 ) 100 zł.")).toContain("12 ) 100 zł.");
  });

  it("odnośnik zdania w środku paragrafu zostawia brzmienie nierozstrzygnięte (KPK t.j. 2026/490, art. 505)", () => {
    const notes = {
      "5": "Zdanie pierwsze w tym brzmieniu obowiązuje do wejścia w życie zmiany, o której mowa w odnośniku 6.",
      "6": "Zdanie pierwsze ze zmianą wprowadzoną przez art. 82 pkt 1 ustawy; wejdzie w życie z dniem 1 października 2029 r."
    };
    const text = "Art. 505. § 1. 5 ) Odpis wyroku nakazowego doręcza się. 6 ) Kopię wyroku nakazowego doręcza się.\n§ 2. Pouczenie.";
    expect(articleWording(text, notes, "2026-10-27").unresolved).toBe(true);
  });
});
