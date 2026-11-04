import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ChatTurnJournal, errorCode, modelKindOf, PhaseClock, summarizeChatTurns, type ChatTurnRecord } from "../src/chat-turn-journal.js";

describe("dziennik czasu tur czatu", () => {
  it("etapy z kolejnych zgłoszeń, kod błędu bez treści, rodzaj modelu", () => {
    let now = 0;
    const clock = new PhaseClock(() => now);
    clock.mark("PREPARE");
    now = 3000;
    clock.mark("ROUTING");
    now = 3100;
    clock.mark("MODEL");
    now = 40_000;
    clock.close();
    expect(clock.phasesMs).toEqual({ PREPARE: 3000, ROUTING: 100, MODEL: 36_900 });
    expect(errorCode(new Error("LOCAL_MODEL_HTTP_RESPONSE_TIMEOUT: Jan Kowalski"))).toBe("LOCAL_MODEL_HTTP_RESPONSE_TIMEOUT");
    expect(modelKindOf("openai", "local/bielik-11b-v3-q4km")).toBe("local");
    expect(modelKindOf("anthropic", "claude-x")).toBe("api");
  });

  it("podsumowanie ścieżek: mediana, 95%, błędy; plik ograniczony do 500 tur", () => {
    const base = { at: "x", modelKind: "local" as const, provider: "openai", attachments: 0, phasesMs: { MODEL: 1000 } };
    const records: ChatTurnRecord[] = [10, 20, 30, 40, 100].map((s, i) => ({ ...base, path: "pisma", totalMs: s * 1000, status: i === 4 ? "ERROR" : "OK" }));
    const [row] = summarizeChatTurns(records);
    expect(row).toMatchObject({ path: "pisma", turns: 5, errors: 1, p50Ms: 30_000, p95Ms: 100_000, maxMs: 100_000, phasesP50Ms: { MODEL: 1000 } });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-turns-"));
    try {
      const journal = new ChatTurnJournal(path.join(dir, "chat-turns.jsonl"));
      for (let i = 0; i < 510; i += 1) journal.append({ ...base, path: "p", totalMs: i, status: "OK" });
      expect(journal.records()).toHaveLength(500);
      expect(journal.summary().turns).toBe(500);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
