import { describe, expect, it } from "vitest";
import type { CaseFileAccess } from "./case-file-tool-runtime.js";
import {
  IndependentReviewToolRuntime,
  MAX_REVIEW_ROUNDS,
  checkIsolation,
  newAuthorMarker,
  parseVerdict,
  reviewableDraft,
  reviewerInstructions
} from "./independent-review.js";

const draft = `${"Wnoszę o zasądzenie kwoty 12 000 zł wraz z odsetkami. ".repeat(10)}\n\nUzasadnienie: pozwany nie zapłacił faktury nr 1/2026.`;

function caseFiles(): CaseFileAccess {
  return {
    caseId: "case-1",
    listDocuments: async () => [
      { documentId: "doc_aaaaaaaaaaaaaaaaaaaaaaaa", totalPages: 2, chunks: 1 },
      { documentId: "doc_bbbbbbbbbbbbbbbbbbbbbbbb", totalPages: 1, chunks: 1 }
    ],
    search: async () => [],
    readChunks: async (documentId) => ({
      totalPages: 1,
      chunks: [{ index: 1, pageStart: 1, pageEnd: 1, text: documentId.startsWith("doc_a") ? "Faktura nr 1/2026 na 12 000 zł." : "Pismo pozwanego: zapłaciłem 5 000 zł przelewem." }]
    }),
    sharedKey: () => true
  };
}

function fakeGateway(answer = "| ATAK-1 | ISTOTNA | ... |\nPEER-UWAGI — brak dowodu doręczenia wezwania.") {
  const calls: Array<{ systemPrompt?: string; messages: Array<{ role: string; content: string }>; accountContinuity?: string }> = [];
  return {
    calls,
    gateway: {
      stream: async (_provider: unknown, params: { systemPrompt?: string; messages: Array<{ role: string; content: string }>; accountContinuity?: string }) => {
        calls.push(params);
        return { fullText: answer } as never;
      }
    }
  };
}

function runtime(marker: string, gateway: ReturnType<typeof fakeGateway>["gateway"]) {
  return new IndependentReviewToolRuntime({
    gateway: gateway as never,
    provider: "anthropic",
    model: "claude-test",
    caseFiles: caseFiles(),
    aliasText: (_id, text) => text,
    marker,
    reviewerInstructions: "Recenzent."
  });
}

describe("independent review (Gauntlet II.4, T16/T17)", () => {
  it("cuts the working part of the draft", () => {
    const { text, cutWorkingPart } = reviewableDraft(`${draft}\n\n## CZĘŚĆ ROBOCZA\nNasza najmocniejsza teza to...`);
    expect(cutWorkingPart).toBe(true);
    expect(text).not.toContain("najmocniejsza");
  });

  it("is BLIND: one fresh message, no account continuity, the author's marker absent, all documents read by the app", async () => {
    const marker = newAuthorMarker();
    const fake = fakeGateway();
    const review = runtime(marker, fake.gateway);
    expect(review.systemPromptAppendix()).toContain(marker);
    const [result] = await review.runTools([{ id: "t1", name: "independent_review", input: { draft } }]);
    const body = JSON.parse(result!.content);
    expect(body).toMatchObject({ status: "OK", isolation: "BLIND", verdict: "PEER-UWAGI", documentsSeen: 2 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.messages).toHaveLength(1);
    expect(fake.calls[0]!.accountContinuity).toBe("none");
    // The opponent's document reaches the reviewer although the author never selected it.
    expect(fake.calls[0]!.messages[0]!.content).toContain("zapłaciłem 5 000 zł");
    expect(JSON.stringify(fake.calls[0])).not.toContain(marker);
  });

  it("is NON_BLIND when the author's marker reaches the reviewer (T16)", async () => {
    const marker = newAuthorMarker();
    const fake = fakeGateway();
    const [result] = await runtime(marker, fake.gateway).runTools([
      { id: "t1", name: "independent_review", input: { draft: `${draft}\nZnacznik sesji autora: ${marker}` } }
    ]);
    const body = JSON.parse(result!.content);
    expect(body.isolation).toBe("NON_BLIND");
    expect(body.isolationReasons).toContain("AUTHOR_MARKER_LEAKED");
  });

  it("starts a fresh call for each round and stops after the limit (T17, II.8)", async () => {
    const fake = fakeGateway("PEER-OK");
    const review = runtime(newAuthorMarker(), fake.gateway);
    const results = [];
    for (let round = 0; round <= MAX_REVIEW_ROUNDS; round += 1) {
      results.push(JSON.parse((await review.runTools([{ id: `t${round}`, name: "independent_review", input: { draft } }]))[0]!.content));
    }
    expect(fake.calls).toHaveLength(MAX_REVIEW_ROUNDS);
    expect(fake.calls.every((call) => call.messages.length === 1)).toBe(true);
    expect(results.at(-1)).toMatchObject({ status: "BLOCKED", error: "MAX_REVIEW_ROUNDS" });
  });

  it("flags passed history and parses verdicts", () => {
    expect(checkIsolation({ systemPrompt: "x", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }, "M").reasons).toContain("HISTORY_PASSED");
    expect(parseVerdict("Werdykt: **PEER-STOP** — termin")).toBe("PEER-STOP");
    expect(parseVerdict("brak")).toBe("UNKNOWN");
  });

  it("builds the reviewer's instructions from the skills, adapted to a call without tools", () => {
    const text = reviewerInstructions((resource) =>
      resource.endsWith("recenzent-niezalezny.md")
        ? "---\nname: recenzent-niezalezny\n---\nJesteś drugim prawnikiem."
        : "# MOD\n## 3. Protokół\nROLA 1\n## 4. Raport\nformat\n## 5. Integracja\npipeline"
    );
    expect(text).toContain("Jesteś drugim prawnikiem.");
    expect(text).toContain("ROLA 1");
    expect(text).not.toContain("pipeline");
    expect(text).not.toContain("name: recenzent");
    expect(text).toContain("DO SPRAWDZENIA W ELI");
  });
});
