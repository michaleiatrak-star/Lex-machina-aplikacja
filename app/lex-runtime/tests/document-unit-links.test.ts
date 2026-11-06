import { describe, expect, it } from "vitest";
import { processDocumentCitationMarkers } from "../src/document-citations.js";

const agreement = {
  documentId: "doc_poroz",
  selectedByUser: true,
  totalPages: 2,
  chunks: [
    {
      index: 0,
      pageStart: 1,
      pageEnd: 1,
      text: "Porozumienie stron\nzawarte w dniu 9 października 2024 r.\n2. W okresie od dnia 9 października 2024 r. do dnia 31 października 2024r. Pracodawca zwalnia Pracownika z obowiązku świadczenia pracy z zachowaniem prawa do wynagrodzenia.\n5. Za każde nieuprawnione naruszenie każda ze stron zobowiązana będzie do zapłaty kary w kwocie\n5.000,00 zł"
    },
    { index: 1, pageStart: 2, pageEnd: 2, text: "10. Na mocy niniejszego porozumienia Pracownik, zrzeka się wszystkich roszczeń przeszłych i przyszłych względem Pracodawcy.\n11. Pracownik po ustaniu stosunku pracy" }
  ]
};
const demand = {
  documentId: "doc_wezw",
  selectedByUser: true,
  totalPages: 1,
  chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: "WEZWANIE\nnaruszenia dotyczyły pkt. 6 i pkt 11 a i b porozumienia" }]
};

describe("a reference to a numbered unit of a case document is linked (user report 2026-11-06)", () => {
  it("pkt 2, 5 i 10: each to its page, the unit highlighted", () => {
    const result = processDocumentCitationMarkers("Pkt 10 znosi korzyść pracownika z pkt 2, 5 i 10 tego porozumienia.", [agreement as never, demand as never]);
    const byUnit = Object.fromEntries(result.citations.map((citation) => [citation.label, citation]));
    expect(Object.keys(byUnit).sort()).toEqual(["porozumienie, pkt 10, s. 2", "porozumienie, pkt 2, s. 1", "porozumienie, pkt 5, s. 1"]);
    const five = byUnit["porozumienie, pkt 5, s. 1"]!;
    expect(five.contextText.slice(five.highlightStart, five.highlightEnd)).toMatch(/^5\. Za każde nieuprawnione naruszenie każda ze stron[\s\S]*5\.000,00 zł$/u);
    const ten = byUnit["porozumienie, pkt 10, s. 2"]!;
    expect(ten.contextText.slice(ten.highlightStart, ten.highlightEnd)).toBe("10. Na mocy niniejszego porozumienia Pracownik, zrzeka się wszystkich roszczeń przeszłych i przyszłych względem Pracodawcy.");
    // One link per unit and paragraph.
    expect(result.citations).toHaveLength(3);
    expect(result.text).not.toContain("[[LEXDOC:");
  });

  it("a statute's unit and a unit no single document has stay unlinked", () => {
    const result = processDocumentCitationMarkers("Wezwanie powołuje art. 187 ust. 1 pkt 3 KPC; pkt 3 KPC dotyczy pozwu. Pkt 99 nie istnieje.", [agreement as never]);
    expect(result.citations).toHaveLength(0);
  });

  it("an amount, a date, a § and an exhibit of a pleading or a demand: linked where they are (user report 2026-11-06)", () => {
    const demandText = {
      documentId: "doc_wezw",
      selectedByUser: true,
      totalPages: 1,
      chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: "WEZWANIE DO ZAPŁATY\nKatowice, dnia 3 grudnia 2024 roku\nwzywam Pana do zapłaty kwoty 60.000,00 zł w terminie 3 dni" }]
    };
    const pleading = {
      documentId: "doc_odp",
      selectedByUser: true,
      totalPages: 3,
      chunks: [{ index: 2, pageStart: 3, pageEnd: 3, text: "Wnoszę o dopuszczenie dowodu z dokumentów:\nZałącznik nr 3 – umowa najmu z 1.02.2024 r.\n§ 4 Kaucja wynosi 2 400 zł" }]
    };
    const answer = "Wezwanie z 3 grudnia 2024 r. żąda 60 000 zł. Pozwany powołuje załącznik nr 3, a § 4 umowy określa kaucję. Art. 484 § 2 KC pozwala miarkować karę.";
    const result = processDocumentCitationMarkers(answer, [demandText as never, pleading as never]);
    const labels = result.citations.map((citation) => citation.label);
    expect(labels).toEqual(["wezwanie, 3 grudnia 2024, s. 1", "wezwanie, 60 000 zł, s. 1", "dokument, załącznik nr 3, s. 3", "dokument, § 4, s. 3"]);
    const money = result.citations[1]!;
    expect(money.contextText.slice(money.highlightStart, money.highlightEnd)).toBe("60.000,00 zł");
    // "art. 484 § 2 KC" is a statute: no link.
    expect(result.citations.some((citation) => citation.label.startsWith("§ 2"))).toBe(false);
  });
});
