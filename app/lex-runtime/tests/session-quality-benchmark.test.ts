import { describe, expect, it } from "vitest";
import {
  compareSummaries,
  conversationQuery,
  reportMarkdown,
  scoreTurn,
  summarizeScores,
  validateSessionQualityCorpus
} from "../src/session-quality-benchmark.js";
import { droppedMessageCount } from "../src/thread-summary.js";
import { SESSION_QUALITY_CORPUS_V1 } from "../src/session-quality-corpus.js";

const corpus = validateSessionQualityCorpus(SESSION_QUALITY_CORPUS_V1);

describe("session quality benchmark", () => {
  it("has a valid corpus across domains with multi-message threads", () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(15);
    expect(new Set(corpus.cases.map((item) => item.domain)).size).toBeGreaterThanOrEqual(12);
    expect(corpus.cases.filter((item) => item.turns.length > 1).length).toBeGreaterThanOrEqual(5);
    expect(corpus.cases.flatMap((item) => item.turns.slice(1)).every((turn) => turn.mustRecall?.length)).toBe(true);
  });

  it("scores verification, completeness, acts and continuity", () => {
    const turn = {
      question: "W jakim terminie przedawnia się roszczenie?",
      expectedActs: ["KC"],
      topics: [["przedawni"], ["lat"], ["kara umowna"]],
      mustRecall: [["samochod"]],
      expectedProvisions: ["art. 415 KC"]
    };
    const score = scoreTurn("kc", 1, turn, {
      status: "DRAFT_PRESENTABLE",
      answer: [
        "Roszczenie o naprawienie szkody za uszkodzony samochód przedawnia się z upływem lat. ✅ [VER: https://eli.gov.pl/a, 2026-10-03]",
        "Podstawa: art. 415 KC ✅ [VER: https://eli.gov.pl/b, 2026-10-03]",
        "Art. 999 KC ⚠️ [NIEWERYFIKOWANE]"
      ].join("\n"),
      timeMs: 12_000,
      usage: { inputTokens: 1000, outputTokens: 200, modelCalls: 2, unmeteredCalls: 0 }
    });
    expect(score).toMatchObject({
      blocked: false,
      verifiedMarkers: 2,
      unverifiedMarkers: 1,
      topicCoverage: 2 / 3,
      actCoverage: 1,
      recall: 1,
      provisionsVerified: 1,
      inputTokens: 1000
    });
    expect(score.verificationRate).toBeCloseTo(2 / 3);
    expect(scoreTurn("kc", 0, turn, { status: "BLOCKED", answer: "", timeMs: 1 }).score).toBe(0);
    expect(
      scoreTurn("kc", 0, turn, {
        status: "DRAFT_PRESENTABLE",
        answer: "x",
        timeMs: 1,
        usage: { inputTokens: 0, outputTokens: 0, modelCalls: 1, unmeteredCalls: 1 }
      }).inputTokens
    ).toBeNull();
  });

  it("builds the client's query and marks omitted messages so the runtime summarizes them", () => {
    const history = Array.from({ length: 6 }, (_, index) => ({
      role: (index % 2 ? "assistant" : "user") as "user" | "assistant",
      content: "x".repeat(400)
    }));
    const query = conversationQuery(history, "Co dalej?", 1500);
    expect(query.startsWith("__LEX_SKILLS_V1__ ")).toBe(true);
    expect(droppedMessageCount(query)).toBe(3);
    expect(conversationQuery([], "Pierwsze pytanie", 1500).endsWith("\nPierwsze pytanie")).toBe(true);
  });

  it("compares two runs and flags regressions", () => {
    const base = summarizeScores([
      scoreTurn("a", 0, corpus.cases[0]!.turns[0]!, { status: "DRAFT_PRESENTABLE", answer: "wina szkoda związek przyczynowy odszkodowanie k.c.", timeMs: 1000 })
    ]);
    const worse = { ...base, topicCoverage: base.topicCoverage - 0.3, blockedRate: 0.2 };
    const comparison = compareSummaries(base, worse);
    expect(comparison.find((item) => item.metric === "topicCoverage")?.regression).toBe(true);
    expect(comparison.find((item) => item.metric === "blockedRate")?.regression).toBe(true);
    expect(comparison.find((item) => item.metric === "score")?.regression).toBe(false);
    expect(reportMarkdown({ provider: "p", model: "m", corpus, scores: [], summary: worse, comparison })).toContain("| topicCoverage |");
  });
});

describe("benchmark error codes", () => {
  it("names the gate or provider failure behind a turn", async () => {
    const { errorCode } = await import("../src/session-quality-benchmark.js");
    expect(errorCode('HTTP_409:{"error":"CONTRACT_STATE_REQUIRED"}')).toBe("CONTRACT_STATE_REQUIRED");
    expect(errorCode('HTTP_502:{"error":"PROVIDER_EXECUTION_FAILED","provider":"openai","reason":"ACCOUNT_SESSION_NOT_SUBSCRIPTION_AUTH"}')).toBe(
      "PROVIDER_EXECUTION_FAILED/ACCOUNT_SESSION_NOT_SUBSCRIPTION_AUTH"
    );
  });
});
