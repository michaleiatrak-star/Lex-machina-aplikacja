import { describe, expect, it } from "vitest";
import {
  articleFootnotes,
  articleWording,
  extractPageFootnotes,
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
});
