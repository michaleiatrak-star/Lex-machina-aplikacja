import { describe, expect, it } from "vitest";
import { compactActAbbreviations, expandProfessionActAbbreviations } from "./legal-act-abbreviations.js";
import { collapseRepeatedVerMarkers } from "./finalization-gate.js";
import { wsdRegisterSignature, wsdPageNames } from "./courts/wsd-portal.js";
describe("RD 121/26: skróty ustaw zawodowych, znaczniki, rejestr WSD", () => {
    it("PrAdw i u.r.p. po artykule są nazwą aktu; definicja „dalej: PrAdw” zostaje", () => {
        expect(expandProfessionActAbbreviations("art. 91 ust. 2 PrAdw oraz art. 95n pkt 1 PrAdw (dalej: PrAdw)")).toBe("art. 91 ust. 2 Prawa o adwokaturze oraz art. 95n pkt 1 Prawa o adwokaturze (dalej: PrAdw)");
        expect(expandProfessionActAbbreviations("art. 91 ust. 2 ⚠️ [NIEWERYFIKOWANE] PrAdw")).toBe("art. 91 ust. 2 ⚠️ [NIEWERYFIKOWANE] Prawa o adwokaturze");
        expect(expandProfessionActAbbreviations("art. 95n Prawa o adwokaturze (Dz.U. 2024 poz. 1564) PrAdw")).toBe("art. 95n Prawa o adwokaturze (Dz.U. 2024 poz. 1564)");
        expect(compactActAbbreviations("art. 64 u.r.p. i art. 233 k.k.")).toBe("art. 64 ustawy o radcach prawnych i art. 233 KK");
    });
    it("dwa znaczniki VER tego samego przepisu obok siebie: jeden, pełniejszy; różne przepisy zostają", () => {
        expect(collapseRepeatedVerMarkers("art. 460 KPK ✅ [VER: art. 460 KPK, 2026-11-15] ✅ [VER: art. 460 KPK, 2026-11-15, STAN NA 2026-10-14]")).toBe("art. 460 KPK ✅ [VER: art. 460 KPK, 2026-11-15, STAN NA 2026-10-14]");
        const two = "✅ [VER: art. 7 KPK, 2026-11-15] ✅ [VER: art. 4 KPK, 2026-11-15]";
        expect(collapseRepeatedVerMarkers(two)).toBe(two);
    });
    it("rejestr WSD przyjmuje sygnatury WSD oraz SN w sprawach adwokatów (SDI, DSI)", () => {
        expect(wsdRegisterSignature("SDI 9/12")).toEqual({ prefix: "SDI", number: "9/12" });
        expect(wsdRegisterSignature("WSD 127/12")).toEqual({ prefix: "WSD", number: "127/12" });
        expect(wsdRegisterSignature("II CSK 1/12")).toBeNull();
        expect(wsdPageNames("... Sygnatura: SDI 9/12 Tagi ...", "9/12", "SDI")).toBe(true);
        expect(wsdPageNames("... Sygnatura: WSD 9/12 ...", "9/12", "SDI")).toBe(false);
    });
});
