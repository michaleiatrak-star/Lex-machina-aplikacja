import { describe, expect, it } from "vitest";
import { PROVISION_ANCHOR, provisionPreview, provisionReference, unitRange } from "../src/core-law-preview.js";
import type { CoreActRecord } from "../src/core-law-index.js";

const ARTICLE_233 =
  "Art. 233. § 1. Kto, składając zeznanie mające służyć za dowód w postępowaniu sądowym, zeznaje nieprawdę lub zataja prawdę,\npodlega karze.\n§ 2. Warunkiem odpowiedzialności jest uprzedzenie zeznającego.\n§ 3. Nie podlega karze, kto nie wiedząc o prawie odmowy zeznania.";

const record: CoreActRecord = {
  eli: "DU/2025/383",
  title: "Kodeks karny",
  type: null,
  status: null,
  promulgation: null,
  textSource: "pdf",
  fetchedAt: "2026-10-01T08:00:00Z",
  sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf",
  articleOrder: ["233"],
  articles: { "233": ARTICLE_233 },
  articleAnchors: { "233": "page=54" },
  text: ARTICLE_233
};

const index = {
  currentRecord: (eli: string) => (eli === "DU/2025/383" ? record : null),
  resolve: (act: string) => (/kk/i.test(act) ? { eli: "DU/2025/383", consolidated: true, labels: [], domains: [], notes: [] } : null)
};

describe("provision preview from the local ELI copy", () => {
  it("reads the act, article and unit from the claim and the source URL", () => {
    expect(provisionReference("Art. 233 § 2 KK", "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=54")).toEqual({
      act: "KK",
      eli: "DU/2025/383",
      article: "233",
      unit: "§ 2"
    });
    expect(provisionReference("art. 6 ust. 1 ustawy o VAT")).toMatchObject({ article: "6", unit: "ust. 1", act: "ustawy o VAT" });
    expect(provisionReference("II KK 1/24")).toBeNull();
  });

  it("marks and anchors the cited unit, and the whole article without a unit", () => {
    const range = unitRange(ARTICLE_233, "§ 2")!;
    expect(ARTICLE_233.slice(range.start, range.end)).toBe("§ 2. Warunkiem odpowiedzialności jest uprzedzenie zeznającego.\n");
    const preview = provisionPreview(index, "Art. 233 § 2 KK", "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=54")!;
    expect(preview.anchor).toBe(PROVISION_ANCHOR);
    expect(preview.html).toContain(`<mark id="${PROVISION_ANCHOR}">§ 2. Warunkiem`);
    expect(preview.html).toContain("text.pdf#page=54");
    expect(preview.unitFound).toBe(true);
    const whole = provisionPreview(index, "art. 233 KK")!;
    expect(whole.html).toContain(`<mark id="${PROVISION_ANCHOR}">Art. 233.`);
  });

  it("escapes the text and reports an article missing from the copy", () => {
    const html = provisionPreview(
      { ...index, currentRecord: () => ({ ...record, articles: { "233": "Art. 233. <script>x</script>" } }) },
      "art. 233 KK"
    )!.html;
    expect(html).not.toContain("<script>");
    expect(provisionPreview(index, "art. 999 KK")).toBeNull();
    expect(provisionPreview(index, "Art. 233 § 9 KK")!.unitFound).toBe(false);
  });
});
