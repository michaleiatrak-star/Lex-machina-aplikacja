import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { foreignElement } from "../src/domain-module-map.js";
import { runRoutingBenchmark, TurnRouter, type RoutingCase } from "../src/routing-benchmark.js";

// 10 000 messages composed from matters, frames and topics written apart from
// routing-5000 (build-routing-10000.py): the holdout of the chat routing. DR choice is
// a hint the model may override; its floor guards against regressions, the gate,
// the criminal qualifier and the executive skill must hold as on routing-5000.
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "routing-10000.json"), "utf8")) as RoutingCase[];
const rate = (bucket: { total: number; ok: number }) => bucket.ok / bucket.total;

describe("routing of 10 000 chat messages (holdout)", () => {
  const report = runRoutingBenchmark(new TurnRouter(CORPUS), cases);

  it("has the corpus", () => {
    expect(cases).toHaveLength(10_000);
  });

  it("keeps every legal message legal and skips legal skills for the rest", () => {
    expect(report.failures.filter((item) => item.expected === "prawne").map((item) => item.q)).toEqual([]);
    expect(rate(report.legalGate.trivialSkipped)).toBe(1);
    expect(rate(report.legalGate.nonLegalLoadedSkills)).toBeGreaterThanOrEqual(0.995);
  });

  it("chooses the executive skill and requires the criminal qualifier", () => {
    expect(rate(report.executive)).toBeGreaterThanOrEqual(0.995);
    expect(rate(report.criminal.truePositive)).toBe(1);
    expect(rate(report.criminal.falsePositive)).toBeGreaterThanOrEqual(0.99);
  });

  it("does not lose domain hints it gives today", () => {
    expect(rate(report.domainTop2)).toBeGreaterThanOrEqual(0.655);
  });
});

describe("foreign element", () => {
  it.each(["pracowałem w Norwegii", "firma z Czech", "sąd w Monachium", "zagraniczny wyrok", "mieszka w USA"])("%s", (text) => {
    expect(foreignElement(text)).toBe(true);
  });
  it.each(["Cześć, mam pytanie", "czesne na studiach", "danie główne", "włosy", "włoski orzech", "indywidualna interpretacja"])("not: %s", (text) => {
    expect(foreignElement(text)).toBe(false);
  });
});
