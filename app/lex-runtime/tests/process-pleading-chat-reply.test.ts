import { describe, expect, it } from "vitest";
import { applyPleadingChatReply, pleadingChatReply, pleadingContinuationQuery, PLEADING_CONTINUATION } from "../src/process-pleading-chat-reply.js";
import { acceptProcessPleadingStart, createProcessPleadingState, markProcessCheckpointReady } from "../src/process-pleading-state.js";

const CASE = `case_${"a".repeat(32)}`;

describe("odpowiedzi w czacie przesuwające pipeline pisma (jak w czacie ze skillem)", () => {
  it("rozpoznaje akceptację, „daj mi dokument” i odpowiedzi zmieniające wynik", () => {
    for (const text of ["a", "a)", "tak", "Tak, akceptuję", "ok", "zatwierdzam", "a — wczytaj checklistę i rozpocznij", "a) Tak, akceptuję — wczytaj checklistę i rozpocznij", "a) Akceptuję pismo jako DRAFT (bez tych kroków)"]) expect(pleadingChatReply(text), text).toBe("ACCEPT");
    for (const text of ["ok trzymaj to i daj mi dokument", "daj mi gotowy plik", "przygotuj od razu pismo", "wygeneruj teraz plik", "dokończ bez zatrzymywania", "resztę etapów automatycznie"]) expect(pleadingChatReply(text), text).toBe("FINISH");
    for (const text of ["popraw ścieżkę B", "porzuć ścieżkę D", "tak, ale dodaj zarzut przedawnienia", "modyfikuj: bez wątku D", "Modyfikuj: porzuć ścieżkę E", "Uwagi: brak zarzutu przedawnienia"]) expect(pleadingChatReply(text), text).toBe("REVISE");
    for (const text of ["nie", "Jaki jest termin na zażalenie?", "czy dodać zarzut przedawnienia?", "zatrzymaj", "Przygotuj pismo procesowe w tej sprawie.", "kontynuuj", "dalej"]) expect(pleadingChatReply(text), text).toBeNull();
  });

  it("„a” akceptuje start, „tak” potwierdza etap, „daj mi dokument” potwierdza etap bez pomijania reszty (ZAKAZ-CP, ZAKAZ-12)", () => {
    let state = createProcessPleadingState(CASE, "CHECKPOINT");
    const start = applyPleadingChatReply(state, "a");
    expect(start.state.stage).toBe("W1");
    expect(start.note).toBe("Twoja odpowiedź: start pisma zaakceptowany.");

    state = markProcessCheckpointReady(acceptProcessPleadingStart(createProcessPleadingState(CASE, "CHECKPOINT")), "CP-1a");
    const confirmed = applyPleadingChatReply(state, "tak");
    expect(confirmed.state.checkpoints["CP-1a"]).toBe("CLOSED");
    expect(confirmed.state.mode).toBe("CHECKPOINT");

    const finish = applyPleadingChatReply(state, "ok trzymaj to i daj mi dokument");
    expect(finish.state.checkpoints["CP-1a"]).toBe("CLOSED");
    expect(finish.state.mode).toBe("CHECKPOINT");
    expect(finish.state.pendingCheckpoint).toBeNull();
    expect(finish.note).toContain("plik .docx powstanie dopiero po zamknięciu wszystkich etapów");
    expect(finish.note).toContain("ZAKAZ-CP, ZAKAZ-12");
    expect(finish.note).toMatch(/zostało \d+: CP-1b/);
    expect(finish.note).toContain("DRAFT — NIEZWERYFIKOWANY");

    // "daj mi dokument" at the start or without a waiting step does not move the pipeline.
    expect(applyPleadingChatReply(createProcessPleadingState(CASE, "CHECKPOINT"), "daj mi dokument").state.stage).toBe("CG_ACCEPTANCE");
    expect(applyPleadingChatReply(confirmed.state, "daj mi dokument").state.revision).toBe(confirmed.state.revision);

    const revised = applyPleadingChatReply(state, "porzuć ścieżkę D");
    expect(revised.state.checkpoints["CP-1a"]).toBe("OPEN");
    expect(revised.state.pendingCheckpoint).toBeNull();
    expect(revised.revision).toEqual({ checkpoint: "CP-1a", remarks: "porzuć ścieżkę D" });

    const unchanged = applyPleadingChatReply(state, "Jaki jest termin na zażalenie?");
    expect(unchanged.state.revision).toBe(state.revision);
    expect(unchanged.note).toBeNull();
  });

  it("wielkość liter i odpowiedzi „nie”, „b”, „C” jak w rozmowach ze skillem", () => {
    for (const text of ["A", "A)", "TAK", "Tak", "OK", "A) Tak, akceptuję — wczytaj checklistę i rozpocznij"]) expect(pleadingChatReply(text), text).toBe("ACCEPT");
    // An option other than a) or a refusal with its reason: the step runs again on it.
    for (const text of ["b", "B", "B) Nie — zakończ lub wyjaśnij wątpliwości", "c", "C", "d) wstrzymaj", "Nie, wolę ścieżkę D", "NIE — najpierw reklamacja"]) {
      expect(pleadingChatReply(text), text).toBe("REVISE");
    }
    // A bare "nie" says nothing to run on: the step waits (the app asks what to change).
    for (const text of ["Nie", "NIE", "nie.", "bez zmian?", "Czy termin minął?"]) expect(pleadingChatReply(text), text).toBeNull();
  });

  it("wybór b/C przy etapie do potwierdzenia wraca do modelu jak w rozmowie ze skillem", () => {
    const state = markProcessCheckpointReady(acceptProcessPleadingStart(createProcessPleadingState(CASE, "CHECKPOINT")), "CP-1a");
    for (const text of ["C", "b) Nie — zakończ"]) {
      const result = applyPleadingChatReply(state, text);
      expect(result.revision, text).toEqual({ checkpoint: "CP-1a", remarks: text });
      expect(result.note, text).toContain(`z Twoim wyborem «${text}»`);
      expect(result.state.pendingCheckpoint).toBeNull();
    }
    expect(applyPleadingChatReply(state, "Nie, wolę ścieżkę D").note).toContain("z Twoimi uwagami");
    // At the start the choice is not a step's revision (the start waits for "a").
    const start = createProcessPleadingState(CASE, "CHECKPOINT");
    expect(applyPleadingChatReply(start, "b").note).toBeNull();
  });

  it("krótka odpowiedź uruchamia etap jak „Kontynuuj” z panelu, z cytatem odpowiedzi", () => {
    const envelope = '__LEX_SKILLS_V1__ {"auto":false}';
    expect(pleadingContinuationQuery(`${envelope}\nPrzygotuj pismo.\n\nAsystent: Raport CP-1b?\n\nUżytkownik: tak`, "tak")).toBe(
      `${envelope}\nPrzygotuj pismo.\n\nAsystent: Raport CP-1b?\n\nUżytkownik: ${PLEADING_CONTINUATION} Odpowiedź użytkownika na poprzedni etap: «tak»`
    );
    expect(pleadingContinuationQuery(`${envelope}\nc`, "c")).toBe(`${envelope}\n${PLEADING_CONTINUATION} Odpowiedź użytkownika na poprzedni etap: «c»`);
  });
});
