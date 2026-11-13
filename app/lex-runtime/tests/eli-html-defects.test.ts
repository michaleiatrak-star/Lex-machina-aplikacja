import { describe, expect, it } from "vitest";
import { withoutTrailingStructure } from "../src/legal-source-verifier.js";

// Cases of legal-cite-pl testy/wady_html_eli.py (b6113a5), as text after the HTML is read.
describe("ELI consolidated text defects at the end of an article", () => {
  it("structure heading of the next part and its title are cut", () => {
    expect(withoutTrailingStructure("Art. 15. Sąd właściwy pozostaje właściwy.\nRozdział 1\nWłaściwość rzeczowa")).toBe("Art. 15. Sąd właściwy pozostaje właściwy.");
    expect(withoutTrailingStructure("Art. 316. § 2. Podrobione znaki należy usunąć.\nCZĘŚĆ WOJSKOWA")).toBe("Art. 316. § 2. Podrobione znaki należy usunąć.");
  });
  it("a stray journal note is cut, the text stays", () => {
    expect(withoutTrailingStructure("Art. 430. Kto na własny rachunek powierza wykonanie czynności.\n(Dz. U. poz. 1638).")).toBe("Art. 430. Kto na własny rachunek powierza wykonanie czynności.");
  });
  it("an ordinary last line is kept", () => {
    const text = "Art. 701. Siedemset jeden.\n2) wykonanie umowy.";
    expect(withoutTrailingStructure(text)).toBe(text);
  });
});

describe("ELI consolidated text: 'l' and '1' swapped in an article number", () => {
  it("art. 589l printed as 5891 and art. 611s as 61ls are found; a real number is not swapped", async () => {
    const { articleSection } = await import("../src/legal-source-verifier.js");
    const text = "Art. 589k. K.\nArt. 5891. Wykonuje niezwłocznie.\nArt. 589m. M.\nArt. 611r. R.\nArt. 61ls. Ustaleń z Trybunałem dokonuje Minister.\nArt. 611t. T.\nArt. 701. Siedemset jeden.";
    expect(articleSection("art. 589l k.p.k.", text)).toContain("Wykonuje niezwłocznie.");
    expect(articleSection("art. 611s k.p.k.", text)).toContain("Trybunałem");
    expect(articleSection("art. 701 k.p.k.", text)).toBe("Art. 701. Siedemset jeden.");
    expect(articleSection("art. 70l k.p.k.", text)).toBeNull();
  });
});
