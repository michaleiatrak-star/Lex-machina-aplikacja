import { describe, expect, it } from "vitest";
import { applyPleadingChatReply, pleadingChatReply } from "../src/process-pleading-chat-reply.js";
import { acceptProcessPleadingStart, createProcessPleadingState, markProcessCheckpointReady } from "../src/process-pleading-state.js";

const CASE = `case_${"a".repeat(32)}`;

describe("odpowiedzi w czacie przesuwające pipeline pisma (jak w czacie ze skillem)", () => {
  it("rozpoznaje akceptację, „daj mi dokument” i odpowiedzi zmieniające wynik", () => {
    for (const text of ["a", "a)", "tak", "Tak, akceptuję", "ok", "zatwierdzam", "kontynuuj", "a — wczytaj checklistę i rozpocznij"]) expect(pleadingChatReply(text), text).toBe("ACCEPT");
    for (const text of ["ok trzymaj to i daj mi dokument", "daj mi gotowy plik", "przygotuj od razu pismo", "wygeneruj teraz plik", "dokończ bez zatrzymywania", "resztę etapów automatycznie"]) expect(pleadingChatReply(text), text).toBe("FINISH");
    for (const text of ["popraw ścieżkę B", "porzuć ścieżkę D", "tak, ale dodaj zarzut przedawnienia", "modyfikuj: bez wątku D"]) expect(pleadingChatReply(text), text).toBe("REVISE");
    for (const text of ["nie", "Jaki jest termin na zażalenie?", "czy dodać zarzut przedawnienia?", "zatrzymaj", "Przygotuj pismo procesowe w tej sprawie."]) expect(pleadingChatReply(text), text).toBeNull();
  });

  it("„a” akceptuje start, „tak” potwierdza etap, „daj mi dokument” potwierdza i przechodzi w AUTO", () => {
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
    expect(finish.state.mode).toBe("AUTO");
    expect(finish.state.history.at(-1)).toMatchObject({ type: "MODE_SWITCHED" });
    expect(finish.note).toContain("pozostałe etapy przebiegną automatycznie");

    // "daj mi dokument" at the start or without a waiting step does not move the pipeline.
    expect(applyPleadingChatReply(createProcessPleadingState(CASE, "CHECKPOINT"), "daj mi dokument").state.stage).toBe("CG_ACCEPTANCE");
    expect(applyPleadingChatReply(confirmed.state, "daj mi dokument").state.mode).toBe("CHECKPOINT");

    const revised = applyPleadingChatReply(state, "porzuć ścieżkę D");
    expect(revised.state.checkpoints["CP-1a"]).toBe("OPEN");
    expect(revised.state.pendingCheckpoint).toBeNull();
    expect(revised.revision).toEqual({ checkpoint: "CP-1a", remarks: "porzuć ścieżkę D" });

    const unchanged = applyPleadingChatReply(state, "Jaki jest termin na zażalenie?");
    expect(unchanged.state.revision).toBe(state.revision);
    expect(unchanged.note).toBeNull();
  });
});
