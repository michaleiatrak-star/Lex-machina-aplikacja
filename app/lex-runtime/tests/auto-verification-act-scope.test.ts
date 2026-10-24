import { describe, expect, it } from "vitest";
import { planAutomaticLegalVerification } from "../src/gate-i-auto-verification.js";
import { VerificationLedger } from "../src/verification-ledger.js";

// The act of an article is the one named right after it: "art. 6 … RODO" on a line that also
// has "art. 415 KC" was verified as art. 6 KC and got KC's ✅ next to the RODO provision.
describe("akt powołanego artykułu w automatycznej weryfikacji", () => {
  it("akt UE do weryfikacji UE, akt nazwany słownie bez cudzego skrótu z wiersza", () => {
    const text = "Podstawą jest art. 6 ust. 1 lit. f RODO, a także art. 5 AI Act oraz art. 10 ust. 2 dyrektywy 2008/48/WE i art. 415 KC, art. 4 ustawy o VAT.";
    const calls = planAutomaticLegalVerification(text, new VerificationLedger()).calls.map((call) => [call.input.claim, call.input.act]);
    // Powołanie z ustępem (test 500: "art. 6 ust. 4 ustawy o ..." wykrywane jako samo "art. 6"):
    // weryfikator UE sprawdza też ustęp (claimedUnitState).
    expect(calls).toEqual([
      ["art. 6 ust. 1", "32016R0679"],
      ["art. 5", "32024R1689"],
      ["art. 10 ust. 2", "32008L0048"],
      ["art. 415 KC", "KC"]
    ]);
  });

  it("artykuł bez aktu w wierszu z jednym skrótem nadal dostaje ten skrót", () => {
    const calls = planAutomaticLegalVerification("Zgodnie z art. 415 i art. 361 KC sprawca odpowiada.", new VerificationLedger()).calls.map((call) => call.input.act);
    expect(calls).toEqual(["KC", "KC"]);
  });

  it("artykuł bez aktu nie przejmuje skrótu innego artykułu z dalszej części wiersza (C12-018)", () => {
    const plan = (text: string) =>
      planAutomaticLegalVerification(text, new VerificationLedger()).calls.map((call) => [call.input.claim, call.input.act]);
    expect(plan("Zapis jest sprzeczny z art. 6 ust. 4 i nie wiąże (art. 58 § 1 i § 3 k.c.).")).toEqual([["art. 58 § 1 KC", "KC"]]);
    // Akt przed artykułem w tym samym wierszu nadal się liczy.
    expect(plan("Według KC art. 58 § 1 dotyczy nieważności.").map(([, act]) => act)).toEqual(["KC"]);
  });
});

describe("bramka końcowa: akt UE po artykule nie dostaje skrótu polskiego aktu z odpowiedzi", async () => {
  const { detectLegalReferences } = await import("../src/finalization-gate.js");
  it("art. 5 AI Act zostaje bez KC; art. 481 § 1 dostaje jedyny akt odpowiedzi", () => {
    const claims = detectLegalReferences("Szkoda: art. 415 KC.\n\nZakazane praktyki określa art. 5 AI Act.\n\nOdsetki: art. 481 § 1.")
      .filter((reference) => reference.kind === "statute")
      .map((reference) => reference.claim);
    expect(claims).toEqual(["art. 415 KC", "art. 5", "art. 481 § 1 KC"]);
  });
});
