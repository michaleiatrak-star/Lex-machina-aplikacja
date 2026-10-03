import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderAdapter, ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { mergeThreadEvidence } from "../src/thread-evidence.js";
import type { VerificationRecord } from "../src/verification-ledger.js";
import {
  droppedMessageCount,
  queryWithSummary,
  summaryForDroppedHistory,
  type ThreadSummary
} from "../src/thread-summary.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const thread = Array.from({ length: 6 }, (_, index) => ({
  messageId: `message_${String(index).padStart(16, "0")}`,
  role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
  content: `wiadomość ${index}`
}));
const NOTE = "[Wcześniejsza część rozmowy pominięta (4 wiadomości) — nie mieści się w oknie modelu.]";

describe("summary of omitted thread messages", () => {
  it("reads the client's note and puts the summary in its place", () => {
    const query = `${NOTE}\n\nUżytkownik: wiadomość 4\n\nUżytkownik: pytanie`;
    expect(droppedMessageCount(query)).toBe(4);
    expect(droppedMessageCount("Użytkownik: pytanie")).toBeNull();
    const summary: ThreadSummary = { schemaVersion: 1, text: "## Fakty\n- x", coveredMessages: 4, coveredUntilMessageId: thread[3]!.messageId, updatedAt: "t" };
    const next = queryWithSummary(query, summary);
    expect(next).not.toContain("pominięta");
    expect(next).toContain("[Streszczenie wcześniejszej części rozmowy (4 wiadomości)");
    expect(next).toContain("## Fakty\n- x\n[Koniec streszczenia]");
    expect(next.endsWith("Użytkownik: pytanie")).toBe(true);
  });

  it("reuses a stored summary, extends it with what it lacks, and starts over when the thread changed", async () => {
    const calls: Array<{ previous: string | undefined; messages: string[] }> = [];
    const summarize = async (previous: string | undefined, messages: Array<{ content: string }>) => {
      calls.push({ previous, messages: messages.map((message) => message.content) });
      return `S(${[previous ?? "", ...messages.map((message) => message.content)].join("|")})`;
    };
    const base = { thread, chunkChars: 1000, now: "2026-10-03T00:00:00Z", summarize };

    const first = await summaryForDroppedHistory({ ...base, dropped: 2, stored: null });
    expect(first).toMatchObject({ generated: true, summary: { coveredMessages: 2, coveredUntilMessageId: thread[1]!.messageId } });

    const same = await summaryForDroppedHistory({ ...base, dropped: 2, stored: first!.summary });
    expect(same!.generated).toBe(false);

    const edited = { ...first!.summary, text: "poprawione", editedByUser: true as const };
    const extended = await summaryForDroppedHistory({ ...base, dropped: 4, stored: edited });
    expect(calls.at(-1)).toEqual({ previous: "poprawione", messages: ["wiadomość 2", "wiadomość 3"] });
    expect(extended!.summary).toMatchObject({ coveredMessages: 4, editedByUser: true });

    const changed = await summaryForDroppedHistory({
      ...base,
      dropped: 4,
      stored: { ...first!.summary, coveredUntilMessageId: "message_ffffffffffffffff" }
    });
    expect(calls.at(-1)!.previous).toBeUndefined();
    expect(changed!.summary.coveredMessages).toBe(4);

    expect(await summaryForDroppedHistory({ ...base, dropped: 9, stored: null })).toBeNull();
  });

  it("summarizes in chunks that fit one call", async () => {
    const calls: number[] = [];
    await summaryForDroppedHistory({
      thread,
      dropped: 6,
      stored: null,
      chunkChars: 25,
      now: "t",
      summarize: async (_previous, messages) => {
        calls.push(messages.length);
        return "s";
      }
    });
    expect(calls).toEqual([2, 2, 2]);
  });
});

function registry(): LexSkillRegistry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-summary-"));
  roots.push(root);
  const result = new LexSkillRegistry(root);
  result.scan();
  return result;
}

const KC_RECORD: VerificationRecord = {
  claim: "art. 415 KC",
  kind: "statute",
  status: "VERIFIED",
  sourceUrl: "https://eli.gov.pl/a415",
  sourceTier: "R1",
  fetchedAt: "2026-10-01T10:00:00Z",
  temporalMode: "CURRENT",
  temporalFreshnessStatus: "CURRENT",
  currentEli: "DU/2026/795",
  actDescriptor: {
    id: "KC",
    title: "Kodeks cywilny",
    eli: "DU/2026/795",
    baseEli: "DU/1964/93",
    sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.html",
    sourceKind: "consolidated_text",
    registryAsOf: "2026-09-15"
  }
};

describe("summarizeThread", () => {
  it("sends the messages pseudonymized, without tools, and gives provisions their registry status", async () => {
    let params: ProviderStreamParams | undefined;
    const adapter: ProviderAdapter = {
      id: "openai",
      label: "summary",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        params = received;
        const token = /\[PII:EMAIL:\d{4}\]/.exec(String(received.messages[0]?.content))?.[0] ?? "?";
        return { fullText: `## Fakty\n- Kontakt: ${token}\n## Ustalenia prawne\n- Odpowiedzialność z art. 415 KC.\n- Zachowek: art. 991 KC.` };
      }
    };
    const providers = new ProviderRegistry();
    providers.register(adapter);
    const executor = new SafeSessionExecutor(
      registry(),
      new ProviderGateway(providers),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => ({
        status: "CURRENT",
        mode: "CURRENT",
        checkedAt: "2026-10-03T12:00:00Z",
        baseEli: "DU/1964/93",
        pinnedEli: "DU/2026/795",
        currentEli: "DU/2026/795",
        amendmentsAfter: []
      })
    );
    const text = await executor.summarizeThread({
      provider: "openai",
      model: "test",
      messages: [
        { role: "user", content: "Pisałem z adresu jan.kowalski@example.com w sprawie szkody." },
        { role: "assistant", content: "Podstawą jest art. 415 KC." }
      ],
      threadEvidence: mergeThreadEvidence(null, [KC_RECORD], [], "t")
    });
    expect(String(params?.messages[0]?.content)).not.toContain("jan.kowalski@example.com");
    expect(params?.tools).toBeUndefined();
    expect(params?.accountContinuity).toBe("none");
    expect(text).toContain("jan.kowalski@example.com");
    const lines = text.split("\n");
    expect(lines.find((line) => line.includes("art. 415 KC"))).toContain("https://eli.gov.pl/a415");
    expect(lines.find((line) => line.includes("art. 991 KC"))).toContain("NIEWERYFIKOWANE");
  });
});
