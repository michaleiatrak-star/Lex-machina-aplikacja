import { describe, expect, it } from "vitest";
import { amendmentMentionsArticle } from "../src/temporal-source-freshness.js";

// "art. 385¹" in an amending act read with NFKC was "art. 3851" and the claim "art. 385¹" was
// cut to "385": a change of art. 385¹ was not seen as touching it (a false CURRENT).
const body = (text: string) => text.toLocaleLowerCase("pl");

describe("nowelizacja artykułu z indeksem górnym", () => {
  it("zmiana art. 385^1 dotyczy art. 385^1, nie art. 385 ani 3851", () => {
    const change = body("1) w art. 385^1 § 1 otrzymuje brzmienie:");
    expect(amendmentMentionsArticle(change, "385^1")).toBe(true);
    expect(amendmentMentionsArticle(change, "385")).toBe(false);
    expect(amendmentMentionsArticle(change, "3851")).toBe(false);
  });

  it("zmiana art. 385 nie dotyczy art. 385^1; zakres 385^1–385^3 obejmuje 385^2", () => {
    expect(amendmentMentionsArticle(body("w art. 385 § 2 otrzymuje brzmienie:"), "385^1")).toBe(false);
    expect(amendmentMentionsArticle(body("uchyla się art. 385^1–385^3"), "385^2")).toBe(true);
    expect(amendmentMentionsArticle(body("uchyla się art. 385^1–385^3"), "385a")).toBe(false);
  });
});
