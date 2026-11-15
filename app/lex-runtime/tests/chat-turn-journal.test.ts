import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ChatTurnJournal, errorCode, modelKindOf, PhaseClock, slowChatTurns, stepName, summarizeChatTurns, type ChatTurnRecord } from "../src/chat-turn-journal.js";

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
  it("kroki wewnątrz etapów: narzędzia i rundy poprawcze osobno, bez danych sprawy; długie tury z krokami", () => {
    let now = 0;
    const clock = new PhaseClock(() => now);
    clock.mark("MODEL", "model claude-x");
    now = 60_000;
    clock.mark("MODEL", "narzędzie verify_legal_sources");
    now = 300_000;
    clock.mark("MODEL", "kontrola zgodności powołanych tekstów: II CSKP 89/26, Jan Kowalski");
    now = 700_000;
    clock.mark("SKILLS", "dr-02-prawo-cywilne-rodzinne-gospodarcze/modules/mod-KC-spadki.md");
    now = 710_000;
    clock.mark("MODEL", "narzędzie verify_legal_sources");
    now = 760_000;
    clock.close();
    expect(clock.phasesMs).toEqual({ MODEL: 750_000, SKILLS: 10_000 });
    expect(clock.stepsMs).toEqual({
      "MODEL · kontrola zgodności powołanych tekstów": 400_000,
      "MODEL · narzędzie verify_legal_sources": 290_000,
      "MODEL · model claude-x": 60_000,
      "SKILLS · wczytanie skilli": 10_000
    });
    expect(JSON.stringify(clock.stepsMs)).not.toMatch(/Kowalski|89\/26/u);
    expect(stepName("PREPARE", "pliki w kontekście: 3")).toBe("PREPARE · pliki w kontekście");
    const base = { modelKind: "api" as const, provider: "anthropic", attachments: 0, phasesMs: {}, status: "OK" as const };
    const slow = slowChatTurns([
      { ...base, at: "1", path: "a", totalMs: 30_000 },
      { ...base, at: "2", path: "b", totalMs: 870_000, stepsMs: clock.stepsMs },
      { ...base, at: "3", path: "c", totalMs: 200_000 }
    ]);
    expect(slow.map((turn) => turn.at)).toEqual(["3", "2"]);
    expect(slow[1]!.steps[0]).toEqual({ step: "MODEL · kontrola zgodności powołanych tekstów", ms: 400_000 });
  });
});
