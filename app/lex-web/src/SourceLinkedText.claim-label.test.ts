import { describe, expect, it } from "vitest";
import { verifiedClaimLabel } from "./SourceLinkedText.js";

const PAGE = "https://api.sejm.gov.pl/eli/acts/DU/2026/468/text.pdf#page=92";
const sources = ["art. 477^9 § 1 KPC", "art. 477^8 KPC", "art. 477^9 § 3 KPC", "art. 477^8 § 2 pkt 1 KPC"].map((claim) => ({ claim, url: PAGE }));

describe("verifiedClaimLabel: kilka przepisów z jednej strony ELI", () => {
  it("bierze przepis powołany w wierszu z indeksem górnym i jednostką (test 500, C03-016)", () => {
    expect(verifiedClaimLabel(PAGE, "Wyjątek dotyczy niewielkiego spóźnienia: art. 477^9 § 3 KPC ✅ ", sources)).toBe("art. 477^9 § 3 KPC");
    expect(verifiedClaimLabel(PAGE, "Sprawę rozpozna sąd rejonowy: art. 477⁸ § 2 pkt 1 KPC ✅ ", sources)).toBe("art. 477^8 § 2 pkt 1 KPC");
    expect(verifiedClaimLabel(PAGE, "Odwołanie wnosi się w terminie miesiąca: art. 477^9 §1 KPC ✅ ", sources)).toBe("art. 477^9 § 1 KPC");
  });

  it("§ 1 nie pasuje do § 12; bez pełnego powołania zostaje dopasowanie po numerze", () => {
    const own = [{ claim: "art. 5 § 1 KC", url: "u" }, { claim: "art. 7 KC", url: "u" }];
    expect(verifiedClaimLabel("u", "zob. art. 5 § 12 KC, a dalej art. 7 KC ", own)).toBe("art. 7 KC");
    expect(verifiedClaimLabel("u", "zob. art. 5 KC ", own)).toBe("art. 5 § 1 KC");
  });
});
