import { describe, expect, it } from "vitest";
import { criminalDocument, criminalMatter } from "../src/matter-signals.js";

// A witness or expert cautioned in a protocol is not a criminal case (live case 2026-11-22).
describe("cautions of witnesses and experts are not criminal signals", () => {
  it("a protocol of a civil or labour hearing stays non-criminal", () => {
    for (const protocol of [
      "Świadek uprzedzony o odpowiedzialności karnej za fałszywe zeznania z art. 233 § 1 kk zeznaje: pracowałem jako koordynator.",
      "Świadek pouczony o treści art. 233 k.k. oraz o prawie odmowy zeznań. Zeznaje: nie pamiętam.",
      "Biegły uprzedzony o odpowiedzialności karnej z art. 233 § 4 k.k. za złożenie fałszywej opinii. Opinię podtrzymuje.",
      "Pouczono świadka o odpowiedzialności karnej za składanie fałszywych zeznań. Świadek zeznaje."
    ]) {
      expect(criminalDocument(protocol), protocol).toBe(false);
      expect(criminalMatter(protocol), protocol).toBe(false);
    }
  });

  it("real criminal cases stay criminal", () => {
    expect(criminalDocument("AKT OSKARŻENIA przeciwko Janowi K. oskarżonemu o czyn z art. 278 § 1 k.k.")).toBe(true);
    expect(criminalDocument("Wyrok: oskarżonego uznaje za winnego czynu z art. 233 § 1 k.k.")).toBe(true);
    expect(criminalMatter("Zostałem oskarżony o kradzież")).toBe(true);
    expect(criminalMatter("Świadek złożył fałszywe zeznania z art. 233 kk, chcę zawiadomić prokuraturę")).toBe(true);
    expect(criminalDocument("Świadek uprzedzony o odpowiedzialności karnej. Postanowienie o przedstawieniu zarzutów podejrzanemu.")).toBe(true);
  });
});
