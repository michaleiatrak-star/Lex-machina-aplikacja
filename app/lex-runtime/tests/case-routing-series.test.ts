import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { report, type Case, type Outcome } from "../src/benchmark-cases.js";
import { TurnRouter } from "../src/routing-benchmark.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const router = new TurnRouter(CORPUS);

// Full case descriptions (kazusy): series 2 (cases-1000) and series 3 (cases-s3-1000, short and
// long, multi-domain, with a suggested answer, non-legal). Series 3 before its fixes
// (2026-10-10): non-legal gate 26.4%, DR accepted 81.4%, executive 80.7%, criminal 73.0%.
function measure(file: string, holdout?: boolean) {
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", file), "utf8")) as Case[];
  const cases = holdout === undefined ? all : all.filter((item) => Boolean(item.holdout) === holdout);
  const outcomes: Outcome[] = cases.map((item) => {
    const got = router.route(item.q);
    return { legal: got.legal, domains: got.domains, executive: got.executive, criminal: got.criminal };
  });
  const value = report(cases, outcomes, cases.map(() => 0));
  const share = (bucket: { total: number; ok: number }) => bucket.ok / bucket.total;
  return { value, share };
}

describe("case routing, series 3", () => {
  const { value, share } = measure("cases-s3-1000.json");

  it("keeps every legal case on the legal path and answers most non-legal ones without it", () => {
    expect(share(value.gate.legalKept)).toBe(1);
    expect(share(value.gate.nonLegalSkipped)).toBeGreaterThanOrEqual(0.68);
  });

  it("routes the domain, the executive skill and the criminal qualifier", () => {
    expect(share(value.drAccepted)).toBeGreaterThanOrEqual(0.8);
    expect(share(value.executive)).toBeGreaterThanOrEqual(0.88);
    expect(share(value.criminal.detected)).toBeGreaterThanOrEqual(0.8);
    expect(share(value.criminal.noFalse)).toBeGreaterThanOrEqual(0.94);
  });

  it("holds on the control set it was not tuned on", () => {
    const control = measure("cases-s3-1000.json", true);
    expect(share(control.value.gate.legalKept)).toBe(1);
    expect(share(control.value.executive)).toBeGreaterThanOrEqual(0.84);
    expect(share(control.value.drAccepted)).toBeGreaterThanOrEqual(0.79);
  });
});

describe("case routing, series 2", () => {
  const { value, share } = measure("cases-1000.json");

  it("does not lose what series 2 reached", () => {
    expect(share(value.gate.legalKept)).toBe(1);
    expect(share(value.drAccepted)).toBeGreaterThanOrEqual(0.72);
    expect(share(value.executive)).toBeGreaterThanOrEqual(0.92);
    expect(share(value.criminal.detected)).toBeGreaterThanOrEqual(0.88);
  });
});
