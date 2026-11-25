import { describe, expect, it } from "vitest";
import { computeDeadline, daysOff, easterSunday, nonWorkingReason, termEnd, termLabel } from "./deadline-calculator.js";

describe("deadline calculator", () => {
  it("dates Easter", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
  });

  it("lists movable days off and 24 December from 2025", () => {
    const days = daysOff(2026).map((day) => day.date);
    expect(days).toContain("2026-04-06");
    expect(days).toContain("2026-05-24");
    expect(days).toContain("2026-06-04");
    expect(days).toContain("2026-12-24");
    expect(daysOff(2024).map((day) => day.date)).not.toContain("2024-12-24");
  });

  it("moves an end on a holiday to the next working day (delivery 28.10.2026, two weeks)", () => {
    const result = computeDeadline({ event: "2026-10-28", amount: 2, unit: "WEEKS" });
    expect(result.nominalEnd).toBe("2026-11-11");
    expect(result.end).toBe("2026-11-12");
    expect(result.steps.some((step) => step.basis === "art. 115 KC")).toBe(true);
    expect(computeDeadline({ event: "2026-10-28", amount: 14, unit: "DAYS" }).end).toBe("2026-11-12");
  });

  it("counts from the portal delivery fiction", () => {
    const result = computeDeadline({ event: "2026-11-02", amount: 1, unit: "WEEKS", portalPlaced: true });
    expect(result.from).toBe("2026-11-16");
    expect(result.end).toBe("2026-11-23");
    expect(result.steps[0]!.basis).toBe("art. 131¹a § 2 KPC");
  });

  it("moves past Saturday and Sunday", () => {
    const result = computeDeadline({ event: "2026-11-07", amount: 1, unit: "WEEKS" });
    expect(result.nominalEnd).toBe("2026-11-14");
    expect(result.end).toBe("2026-11-16");
  });

  it("ends a month term on the last day of a shorter month", () => {
    expect(termEnd("2026-01-31", 1, "MONTHS")).toBe("2026-02-28");
    expect(termEnd("2024-01-31", 1, "MONTHS")).toBe("2024-02-29");
    expect(termEnd("2026-11-30", 3, "MONTHS")).toBe("2027-02-28");
    expect(termEnd("2024-02-29", 1, "YEARS")).toBe("2025-02-28");
    expect(computeDeadline({ event: "2026-01-31", amount: 1, unit: "MONTHS" }).end).toBe("2026-03-02");
  });

  it("crosses Christmas", () => {
    expect(computeDeadline({ event: "2026-12-10", amount: 2, unit: "WEEKS" }).end).toBe("2026-12-28");
    expect(computeDeadline({ event: "2024-12-10", amount: 2, unit: "WEEKS" }).end).toBe("2024-12-24");
  });

  it("names the day and the term", () => {
    expect(nonWorkingReason("2026-11-11")).toBe("Narodowe Święto Niepodległości");
    expect(nonWorkingReason("2026-11-12")).toBeNull();
    expect(termLabel(2, "WEEKS")).toBe("2 tygodnie");
    expect(termLabel(14, "DAYS")).toBe("14 dni");
    expect(termLabel(5, "MONTHS")).toBe("5 miesięcy");
    expect(termLabel(22, "YEARS")).toBe("22 lata");
  });

  it("refuses a bad date or amount", () => {
    expect(() => computeDeadline({ event: "2026-02-30", amount: 1, unit: "DAYS" })).toThrow("DEADLINE_DATE_INVALID");
    expect(() => computeDeadline({ event: "2026-02-10", amount: 0, unit: "DAYS" })).toThrow("DEADLINE_AMOUNT_INVALID");
  });
});
