import { describe, expect, it } from "vitest";
import { nextAutoNumber, validateNumbering } from "./invoice-numbering.js";
describe("invoice numbering", () => {
    it("resets the counter monthly and pads it", () => {
        const settings = validateNumbering({ pattern: "FV {NR}/{MM}/{RRRR}", reset: "monthly", padding: 3 });
        const existing = ["FV 001/09/2026", "FV 002/09/2026", "FV 007/10/2026", "FV 1/10/2026", "inny-numer"];
        expect(nextAutoNumber(existing, settings, "2026-09-15")).toBe("FV 003/09/2026");
        expect(nextAutoNumber(existing, settings, "2026-10-01")).toBe("FV 008/10/2026");
        expect(nextAutoNumber(existing, settings, "2026-11-01")).toBe("FV 001/11/2026");
    });
    it("resets yearly across months and never resets without a period", () => {
        const yearly = validateNumbering({ pattern: "{RR}-{MM}-{NR}", reset: "yearly" });
        expect(nextAutoNumber(["26-01-5", "26-09-9", "25-12-40"], yearly, "2026-10-03")).toBe("26-10-10");
        const never = validateNumbering({ pattern: "F/{NR}", reset: "never" });
        expect(nextAutoNumber(["F/41", "F/9"], never, "2027-01-01")).toBe("F/42");
    });
    it("rejects patterns that would repeat numbers", () => {
        expect(() => validateNumbering({ pattern: "FV {MM}/{RRRR}", reset: "monthly" })).toThrow("NUMBERING_PATTERN_NR_REQUIRED");
        expect(() => validateNumbering({ pattern: "FV {NR}/{RRRR}", reset: "monthly" })).toThrow("NUMBERING_PATTERN_MONTH_REQUIRED");
        expect(() => validateNumbering({ pattern: "FV {NR}", reset: "yearly" })).toThrow("NUMBERING_PATTERN_YEAR_REQUIRED");
        expect(() => validateNumbering({ pattern: "FV {NR}/{XX}", reset: "never" })).toThrow("NUMBERING_PATTERN_UNKNOWN_TOKEN");
        expect(() => validateNumbering({ pattern: "FV (NR)", reset: "never" })).toThrow("NUMBERING_PATTERN_NR_REQUIRED");
    });
});
