import { describe, expect, it } from "vitest";
import { familyModuleActive } from "./jurisdiction.js";
describe("moduły rodzin prawa tylko w swoich jurysdykcjach", () => {
    it("Polska: common law i nordyckie nieaktywne, chyba że pytanie dotyczy prawa takiego państwa", () => {
        expect(familyModuleActive("shared/RODZINA-PRAWA-COMMON-LAW.md", "przedstaw art. 245 kodeksu karnego", "PL")).toBe(false);
        expect(familyModuleActive("shared/RODZINA-PRAWA-NORDYCKIE.md", "przedstaw art. 245 kodeksu karnego", "PL")).toBe(false);
        expect(familyModuleActive("shared/RODZINA-PRAWA-COMMON-LAW.md", "Jak wygląda odpowiedzialność za zniesławienie w prawie angielskim?", "PL")).toBe(true);
        expect(familyModuleActive("shared/RODZINA-PRAWA-NORDYCKIE.md", "Umowa o pracę w Szwecji a polska", "PL")).toBe(true);
        expect(familyModuleActive("shared/DISCLAIMER.md", "", "PL")).toBe(true);
    });
    it("w swojej jurysdykcji aktywne", () => {
        expect(familyModuleActive("RODZINA-PRAWA-COMMON-LAW.md", "", "IE")).toBe(true);
        expect(familyModuleActive("RODZINA-PRAWA-NORDYCKIE.md", "", "SE")).toBe(true);
        expect(familyModuleActive("RODZINA-PRAWA-NORDYCKIE.md", "", "IE")).toBe(false);
    });
});
