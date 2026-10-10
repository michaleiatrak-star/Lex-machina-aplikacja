import { describe, expect, it } from "vitest";
import { todayWarsaw } from "../src/warsaw-date.js";

describe("todayWarsaw", () => {
  it("liczy dzisiejszą datę w czasie polskim, nie w UTC", () => {
    // 00:30 czasu letniego w Polsce to jeszcze poprzedni dzień w UTC.
    expect(todayWarsaw("2026-06-30T22:30:00.000Z")).toBe("2026-07-01");
    // Czas zimowy: UTC+1.
    expect(todayWarsaw(Date.parse("2026-11-04T23:30:00.000Z"))).toBe("2026-11-05");
    expect(todayWarsaw(new Date("2026-11-04T22:59:00.000Z"))).toBe("2026-11-04");
  });
});
