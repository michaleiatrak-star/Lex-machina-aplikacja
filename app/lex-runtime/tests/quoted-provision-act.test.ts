import { describe, expect, it } from "vitest";
import { detectLegalReferences } from "../src/finalization-gate.js";

describe("the heading of a quoted provision", () => {
  it("keeps the act the answer gives that article, not the act its content names (live C07-010)", () => {
    const text = [
      "Tak, art. 300 KP istnieje i obowiązuje.",
      "",
      "> „Art. 300. W sprawach nieunormowanych przepisami prawa pracy do stosunku pracy stosuje się odpowiednio przepisy Kodeksu cywilnego, jeżeli nie są one sprzeczne z zasadami prawa pracy.”"
    ].join("\n");
    const claims = detectLegalReferences(text).filter((reference) => reference.kind === "statute").map((reference) => reference.claim);
    expect(claims).not.toContain("Art. 300 KC");
    expect(claims.filter((claim) => /300/u.test(claim)).every((claim) => / KP$/u.test(claim))).toBe(true);
  });

  it("an article named with its act in running text still takes that act", () => {
    const claims = detectLegalReferences("Zgodnie z art. 300 Kodeksu pracy stosuje się przepisy Kodeksu cywilnego.").map((reference) => reference.claim);
    expect(claims.some((claim) => /^art\. 300 KP$/iu.test(claim))).toBe(true);
  });
});
