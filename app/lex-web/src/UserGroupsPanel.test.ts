import { describe, expect, it } from "vitest";
import { groupShareSummary } from "./UserGroupsPanel.js";

describe("udostępnienie grupie: podsumowanie", () => {
  it("dodani i pominięci z powodem po polsku", () => {
    const names = new Map([["u1", "@anna"], ["u2", "@jan"], ["u3", "@ewa"]]);
    expect(groupShareSummary({ granted: ["u1"], skipped: [{ userId: "u2", reason: "ALREADY_HAS_ACCESS" }, { userId: "u3", reason: "TARGET_CRYPTO_NOT_READY" }] }, names)).toBe(
      "Dodano do sprawy: @anna. Pominięto: @jan (ma już dostęp), @ewa (nie zalogował się jeszcze ani razu (brak kluczy szyfrowania))."
    );
    expect(groupShareSummary({ granted: [], skipped: [] }, names)).toBe("Nikt nowy nie został dodany.");
  });
});
