import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPart, continuationBlock, isComplete, joinParts, parsePart, validPlan, withPart, type LongDocumentPlan, type LongDocumentState } from "../src/long-document.js";

// Real outputs of the 16.10.2026 test (Claude, fictitious data): a 45-paragraph regulation in 3
// parts and a ~20-page claim in 5 parts; both passed. Then the same parts with errors put in.
const FIXTURES = path.resolve(__dirname, "fixtures/long-document");
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const regulationPlan = validPlan(JSON.parse(read("regulamin-plan.json")))!;
const claimPlan = validPlan(JSON.parse(read("pozew-plan.json")))!;
const regulation = [1, 2, 3].map((k) => read(`regulamin-${k}.txt`));
const claim = [1, 2, 3, 4, 5].map((k) => read(`pozew-${k}.txt`));

function run(plan: LongDocumentPlan, answers: string[]) {
  let state: LongDocumentState = { id: "t", plan, parts: [], updatedAt: "2026-10-16T10:00:00.000Z" };
  const problems: string[][] = [];
  for (const answer of answers) {
    const part = parsePart(answer)!;
    const check = checkPart(part, plan, state.parts);
    problems.push(check.problems);
    if (check.ok) state = withPart(state, part, "2026-10-16T10:00:00.000Z");
  }
  return { state, problems };
}

describe("długie pismo w częściach: prawdziwe wyniki testu", () => {
  it("regulamin 45 § w 3 częściach: bez błędów, całość z 45 paragrafami", () => {
    const { state, problems } = run(regulationPlan, regulation);
    expect(problems).toEqual([[], [], []]);
    expect(isComplete(state)).toBe(true);
    const whole = joinParts(state);
    expect([...whole.matchAll(/@SEKCJA: § (\d+)\./gu)].map((match) => Number(match[1]))).toEqual(Array.from({ length: 45 }, (_, index) => index + 1));
    expect(whole).not.toMatch(/\[(?:KONIEC )?CZĘŚCI?\b/u);
  });

  it("pozew ~20 stron w 5 częściach: bez błędów (sekcje, punkty 1–72, załączniki)", () => {
    const { state, problems } = run(claimPlan, claim);
    expect(problems).toEqual([[], [], [], [], []]);
    expect(isComplete(state)).toBe(true);
  });
});

describe("długie pismo w częściach: wykrywanie błędów", () => {
  const second = (plan: LongDocumentPlan, parts: string[], index: number, broken: string) => {
    const answers = [...parts];
    answers[index] = broken;
    return run(plan, answers).problems[index]!.join(" | ");
  };
  it.each([
    ["powtórzony § z wcześniejszej części", () => second(regulationPlan, regulation, 2, regulation[2]!.replace("@SEKCJA: § 31.", "@SEKCJA: § 20. Duplikat\n1. Treść.\n@SEKCJA: § 31.")), /§ 20 powtórzony/u],
    ["brakujący §", () => second(regulationPlan, regulation, 1, regulation[1]!.replace(/@SEKCJA: § 17\.[\s\S]*?(?=@SEKCJA: § 18\.)/u, "")), /brakuje § 17/u],
    ["podpis w środkowej części", () => second(regulationPlan, regulation, 1, regulation[1]!.replace("[KONIEC CZĘŚCI 2/3]", "@PODPIS:\nZarząd\n[KONIEC CZĘŚCI 2/3]")), /podpis przed ostatnią/u],
    ["ucięta część (bez znacznika końca)", () => second(regulationPlan, regulation, 2, regulation[2]!.slice(0, regulation[2]!.length / 2)), /znacznika końca/u],
    ["załącznik spoza planu", () => second(claimPlan, claim, 1, claim[1]!.replace(/załącznik nr \d+/u, "załącznik nr 99")), /załącznika nr 99/u],
    ["punkty zaczęte od nowa", () => second(claimPlan, claim, 2, claim[2]!.replace(/^23\. /mu, "1. ")), /punktów 23|zaczyna się od/u],
    ["brak sekcji z planu", () => second(claimPlan, claim, 3, claim[3]!.replace(/@SEKCJA: 6\. Odsetki/u, "Odsetki")), /brak sekcji „III\.6/u]
  ])("%s", (_name, problems, pattern) => {
    expect(problems()).toMatch(pattern);
  });
});

describe("plan i blok kontynuacji", () => {
  it("plan z luką w numeracji między częściami jest odrzucony", () => {
    expect(validPlan({ tytul: "x", czesci: [{ czesc: 1, paragrafy: [1, 10] }, { czesc: 2, paragrafy: [12, 20] }] })).toBeNull();
    expect(validPlan({ tytul: "x", czesci: [{ czesc: 1 }] })).toBeNull();
  });

  it("plan w pierwszej części odczytany z bloku plan-pisma", () => {
    const answer = "Pismo jest długie i powstanie w 2 częściach.\n```plan-pisma\n" + JSON.stringify({ tytul: "Regulamin", czesci: [{ czesc: 1, paragrafy: [1, 2] }, { czesc: 2, paragrafy: [3, 4] }] }) + "\n```\n[CZĘŚĆ 1/2]\n@SEKCJA: § 1. A\n1. x.\n@SEKCJA: § 2. B\n1. y.\n[KONIEC CZĘŚCI 1/2]";
    const part = parsePart(answer)!;
    expect(part.plan?.czesci.length).toBe(2);
    expect(part.text).toBe("@SEKCJA: § 1. A\n1. x.\n@SEKCJA: § 2. B\n1. y.");
  });

  it("blok kolejnej części: plan, ostatni numer, koniec poprzedniej części, poprawki", () => {
    const state = withPart({ id: "t", plan: regulationPlan, parts: [], updatedAt: "x" }, parsePart(regulation[0]!)!, "x");
    const block = continuationBlock(state, 2, ["brakuje § 17 z planu tej części"]);
    expect(block).toContain("CZĘŚĆ 2 Z 3");
    expect(block).toContain("Ostatni paragraf poprzednich części: § 15.");
    expect(block).toContain("[CZĘŚĆ 2/3]");
    expect(block).toContain("POPRAW poprzednią wersję tej części: brakuje § 17");
  });
});
