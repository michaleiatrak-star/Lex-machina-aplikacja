import { describe, expect, it } from "vitest";
import { CASE_ACCESS_PAGE_SIZE, pageOf } from "./CaseAccessAdminPanel";

describe("Uprawnienia do spraw: 50 spraw na stronę", () => {
  const items = Array.from({ length: 123 }, (_, index) => index + 1);
  it("tnie listę na strony po 50 i podaje zakres", () => {
    expect(CASE_ACCESS_PAGE_SIZE).toBe(50);
    expect(pageOf(items, 0)).toMatchObject({ page: 0, pages: 3, from: 1, to: 50 });
    expect(pageOf(items, 2).items).toEqual(items.slice(100));
    expect(pageOf(items, 2)).toMatchObject({ from: 101, to: 123 });
  });
  it("strona poza zakresem (lista się skróciła) przechodzi na ostatnią; pusta lista ma jedną stronę", () => {
    expect(pageOf(items.slice(0, 60), 5)).toMatchObject({ page: 1, from: 51, to: 60 });
    expect(pageOf([], 3)).toMatchObject({ page: 0, pages: 1, from: 0, to: 0 });
  });
});
