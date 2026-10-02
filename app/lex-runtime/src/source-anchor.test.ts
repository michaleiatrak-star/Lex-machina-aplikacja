import { describe, expect, it } from "vitest";
import {
  anchoredUrl,
  htmlArticleAnchors,
  htmlUnitFragment,
  pdfArticleAnchors,
  pdfArticlePage,
  statuteUnitPath,
  verificationMarker,
  verificationSourceLink
} from "./source-anchor.js";

// Struktura jak w text.html ELI (shared/tools/test_eli_art_extract.py): część 1 obwieszczenia
// przytacza „Art. 22.” ustawy zmieniającej, część 2 to tekst jednolity.
const OBWIESZCZENIE = `
<section id="part_1"><div class="part" id="_001"><h2 class="part">Treść obwieszczenia</h2>
 <div class="unit unit_pass" id="pass_2" data-id="pass_2"><div class="unit-inner">
  <div class="unit unit_arti" id="pass_2-pint_2-arti_22" data-id="arti_22"><h3>Art.&nbsp;22.</h3></div>
 </div></div>
</div></section>
<section id="part_2"><div class="part" id="_002"><h2 class="part"><span>Załącznik</span>&nbsp;-&nbsp;Tekst jednolity ustawy</h2>
 <div class="unit unit_arti" id="bran_DRUGI-chpt_I-arti_22" data-id="arti_22"><h3>Art.&nbsp;22.</h3>
  <div class="unit unit_para" id="bran_DRUGI-chpt_I-arti_22-para_1" data-id="para_1"><h3>§&nbsp;1.</h3></div>
  <div class="unit unit_para" id="bran_DRUGI-chpt_I-arti_22-para_1_1" data-id="para_1_1"><h3>§&nbsp;1<sup>1</sup>.</h3></div>
 </div>
 <div class="unit unit_arti" id="bran_DRUGI-chpt_I-arti_36_a" data-id="arti_36_a"><h3>Art.&nbsp;36a.</h3>
  <div class="unit unit_pass" id="bran_DRUGI-chpt_I-arti_36_a-pass_2" data-id="pass_2"><h3>2.</h3>
   <div class="unit unit_pint" id="bran_DRUGI-chpt_I-arti_36_a-pass_2-pint_1" data-id="pint_1"><h3>1)</h3></div>
  </div>
 </div>
 <div class="unit unit_arti" id="bran_DRUGI-chpt_I-arti_77" data-id="arti_77"><h3>Art. 77.</h3></div>
 <div class="unit unit_arti" id="bran_DRUGI-chpt_II-arti_77" data-id="arti_77"><h3>Art. 77.</h3></div>
</div></section>`;

describe("ELI source anchors", () => {
  it("parses the unit path of a statute citation", () => {
    expect(statuteUnitPath("art. 22 § 1¹ pkt 2 lit. a KP")).toEqual([
      { kind: "arti", ids: ["22"] },
      { kind: "para", ids: ["1_1"] },
      { kind: "pint", ids: ["2"] },
      { kind: "lett", ids: ["a"] }
    ]);
    expect(statuteUnitPath("§ 5 rozporządzenia")).toBeNull();
  });

  it("anchors the unit in the consolidated text, never the quoted amending act", () => {
    expect(htmlUnitFragment(OBWIESZCZENIE, "art. 22 KP")).toBe("bran_DRUGI-chpt_I-arti_22");
    expect(htmlUnitFragment(OBWIESZCZENIE, "art. 22 § 1 KP")).toBe(
      "bran_DRUGI-chpt_I-arti_22-para_1"
    );
    expect(htmlUnitFragment(OBWIESZCZENIE, "art. 36a ust. 2 pkt 1")).toBe(
      "bran_DRUGI-chpt_I-arti_36_a-pass_2-pint_1"
    );
    // Brak § 9: kotwica na artykule.
    expect(htmlUnitFragment(OBWIESZCZENIE, "art. 22 § 9")).toBe("bran_DRUGI-chpt_I-arti_22");
  });

  it("gives no anchor when the article is ambiguous or absent", () => {
    expect(htmlUnitFragment(OBWIESZCZENIE, "art. 77")).toBeUndefined();
    expect(htmlUnitFragment(OBWIESZCZENIE, "art. 500")).toBeUndefined();
    expect(htmlArticleAnchors(OBWIESZCZENIE, ["22", "36a", "77"])).toEqual({
      "22": "bran_DRUGI-chpt_I-arti_22",
      "36a": "bran_DRUGI-chpt_I-arti_36_a"
    });
  });

  it("finds the PDF page of the article heading", () => {
    const pages = [
      "OBWIESZCZENIE ... art. 233 ustawy zmieniającej",
      "Rozdział XXX\nArt. 232. Kto...\nArt. 233. § 1. Kto, składając zeznanie...",
      "Art. 234. Kto przed organem..."
    ];
    expect(pdfArticlePage(pages, "art. 233 § 1 KK")).toBe(2);
    expect(pdfArticlePage(pages, "art. 234 KK")).toBe(3);
    expect(pdfArticlePage(pages, "art. 999 KK")).toBeUndefined();
    expect(pdfArticleAnchors(pages)).toEqual({
      "232": "page=2",
      "233": "page=2",
      "234": "page=3"
    });
  });

  it("puts the anchored link into the VER marker", () => {
    const sourceUrl = "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf";
    const record = {
      status: "VERIFIED",
      sourceUrl,
      sourceAnchorUrl: anchoredUrl(sourceUrl, "page=97")!,
      fetchedAt: "2026-10-02T10:00:00.000Z"
    };
    expect(verificationMarker(record)).toBe(`✅ [VER: ${sourceUrl}#page=97, 2026-10-02]`);
    // Kotwica innego adresu niż źródło nie jest używana.
    expect(
      verificationSourceLink({ sourceUrl, sourceAnchorUrl: "https://example.org/x#page=1" })
    ).toBe(sourceUrl);
    expect(anchoredUrl(sourceUrl, "a b")).toBeUndefined();
  });
});
