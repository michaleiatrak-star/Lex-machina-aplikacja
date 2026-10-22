import { describe, expect, it } from "vitest";
import { chronologyBlock, chronologyFromAnswer, queryWithChronology } from "../src/case-chronology.js";
import { latestUserTurn, parseSkillSelectionEnvelope, threadUserText } from "../src/skill-selection.js";

const TIMELINE = "## Oś czasu\n- 9.10.2024: porozumienie z pracownikiem\n- 3.12.2024: wezwanie do zapłaty 60 000 zł";

describe("oś czasu sprawy w pamięci", () => {
  it("zapisuje wynik chronologii (raport CHRONOLOGY_V1 albo skill chronologii w AUTO), nie inne odpowiedzi", () => {
    expect(chronologyFromAnswer({ answer: TIMELINE, status: "DRAFT_PRESENTABLE", reportClosed: true, now: "2026-10-15T10:00:00.000Z" })).toEqual({
      text: TIMELINE,
      updatedAt: "2026-10-15T10:00:00.000Z",
      source: "CHRONOLOGY_V1"
    });
    expect(chronologyFromAnswer({ answer: TIMELINE, status: "DRAFT_PRESENTABLE", taskSkill: "chronologia-sprawy-v1" })?.source).toBe("AUTO");
    expect(chronologyFromAnswer({ answer: TIMELINE, status: "DRAFT_PRESENTABLE", taskSkill: "analiza-sadowa-v6" })).toBeNull();
    expect(chronologyFromAnswer({ answer: TIMELINE, status: "BLOCKED", reportClosed: true })).toBeNull();
  });

  it("trafia do późniejszej pracy przed rozmową, jako wynik asystenta, bez zmiany prośby użytkownika", () => {
    const saved = { text: TIMELINE, updatedAt: "2026-10-15T10:00:00.000Z", source: "CHRONOLOGY_V1" as const };
    const first = "Przygotuj odpowiedź na pozew.";
    const block = chronologyBlock(saved, first)!;
    const query = queryWithChronology(`__LEX_SKILLS_V1__ {"auto":true}\n${first}`, block);
    expect(query.startsWith('__LEX_SKILLS_V1__ {"auto":true}\n\nAsystent: [Oś czasu sprawy zapisana w sprawie 2026-10-15')).toBe(true);
    expect(latestUserTurn(parseSkillSelectionEnvelope(query).query)).toBe(first);
    expect(latestUserTurn(query)).toBe(first);
    expect(threadUserText(query)).not.toContain("porozumienie z pracownikiem");
    // A thread that still carries the same timeline gets no second copy.
    expect(chronologyBlock(saved, `Użytkownik: zrób chronologię\n\nAsystent: ${TIMELINE}`)).toBeNull();
  });
});

describe("case memory before the latest user turn (prompt cache)", () => {
  it("keeps the earlier conversation first and unchanged", async () => {
    const { queryWithChronology } = await import("../src/case-chronology.js");
    const query = "Użytkownik: pierwsze pytanie\n\nAsystent: odpowiedź\n\nUżytkownik: drugie pytanie";
    const withMemory = queryWithChronology(query, "[Rejestr]");
    expect(withMemory.startsWith("Użytkownik: pierwsze pytanie\n\nAsystent: odpowiedź\n\n")).toBe(true);
    expect(withMemory.endsWith("Asystent: [Rejestr]\n\nUżytkownik: drugie pytanie")).toBe(true);
    expect(queryWithChronology("jedno pytanie", "[Rejestr]")).toBe("Asystent: [Rejestr]\n\nUżytkownik: jedno pytanie");
  });
});
