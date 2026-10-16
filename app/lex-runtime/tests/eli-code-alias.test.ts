import { describe, expect, it } from "vitest";
import { codeEli } from "../src/eli-act-descriptor.js";

describe("kodeksy po skrócie, gdy kopia lokalna ich nie zna", () => {
  it.each([
    ["KP", "DU/1974/141"],
    ["k.p.", "DU/1974/141"],
    ["Kodeks pracy", "DU/1974/141"],
    ["k.s.h.", "DU/2000/1037"],
    ["k.r.o.", "DU/1964/59"],
    ["k.p.a.", "DU/1960/168"],
    ["k.k.w.", "DU/1997/557"],
    ["k.k.s.", "DU/1999/930"],
    ["k.w.", "DU/1971/114"],
    ["p.p.s.a.", "DU/2002/1270"],
    ["ustawa o VAT", null]
  ])("%s -> %s", (act, eli) => {
    expect(codeEli(act)).toBe(eli);
  });
});
