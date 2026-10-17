import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionExecutionResponse } from "./api.js";
import { PipelineChoices, letterDocumentPlan, longDocumentType, pipelineChoiceMessage } from "./MatterChatApp.js";
import { autoAdvanceDecision, autoAdvanceNote } from "./workflow-auto-advance.js";

const ID = "0f6c1d8e-2b7a-4c39-9f51-3a2b1c0d9e8f";
const turn = (long: Partial<NonNullable<SessionExecutionResponse["longDocument"]>>, extra: Record<string, unknown> = {}) =>
  ({
    status: "DRAFT_PRESENTABLE",
    answer: "**Część 1 z 3 — Regulamin**\n\n@SEKCJA: § 1.",
    finalization: "PASS",
    verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
    taskSkill: "pisma-proste-v2",
    longDocument: { id: ID, title: "Regulamin", part: 1, parts: 3, ok: true, problems: [], complete: false, next: 2, ...long },
    ...extra
  }) as unknown as SessionExecutionResponse;

describe("długie pismo w częściach: czat", () => {
  it("część zaakceptowana: następna część automatycznie, z opisem w wątku", () => {
    const decision = autoAdvanceDecision(turn({}), null, 0);
    expect(decision).toMatchObject({ advance: true, message: "Kontynuuj: napisz część 2 z 3.", label: "część 2 z 3" });
    expect(autoAdvanceNote(turn({}), decision)).toBe("Długie pismo „Regulamin”: część 1 z 3 sprawdzona i zapisana. Następnie: część 2 z 3 — uruchamiam automatycznie.");
  });

  it("część odrzucona: jedna automatyczna poprawa z problemami, druga czeka na użytkownika", () => {
    const failed = turn({ part: 2, ok: false, problems: ["brak § 16"], next: 2 });
    const first = autoAdvanceDecision(failed, 1, 1);
    expect(first).toMatchObject({ advance: true, message: "Popraw część 2 z 3." });
    expect(autoAdvanceNote(failed, first)).toContain("Część 2 odrzucona przez walidację: brak § 16.");
    const again = autoAdvanceDecision(failed, 1, 2, first.advance ? first.meta : undefined);
    expect(again).toEqual({ advance: false, reason: "NO_PROGRESS" });
    expect(autoAdvanceNote(failed, again)).toContain("Poprawa nie pomogła");
  });

  it("komplet: koniec łańcucha i jeden plik z całości; żadnego pliku z pojedynczej części", () => {
    const complete = turn({ part: 3, complete: true, next: null });
    expect(autoAdvanceDecision(complete, 2, 3)).toEqual({ advance: false, reason: "COMPLETE" });
    expect(letterDocumentPlan(complete as never)).toEqual({ documentType: "letter", stage: "FINAL", longDocumentId: ID });
    expect(letterDocumentPlan(turn({}) as never)).toBeNull();
    expect(letterDocumentPlan(turn({ part: 3, complete: true, next: null }, { taskSkill: "analizator-umow-v1" }) as never)).toBeNull();
    expect(longDocumentType("pisma-procesowe-v3")).toBe("pleading");
    expect(longDocumentType("analizator-umow-v1")).toBe("contract");
  });

  it("przyciski: Kontynuuj prosi o część, Generuj dokument dla kompletu", () => {
    expect(pipelineChoiceMessage({ skill: "pisma-proste-v2", kind: "CONTINUE", reason: "Część 2 z 3" })).toBe("Kontynuuj: napisz część 2 z 3.");
    expect(pipelineChoiceMessage({ skill: "pisma-proste-v2", kind: "CONTINUE", reason: "Popraw część 2 z 3: brak § 16" })).toBe("Popraw część 2 z 3.");
    const html = renderToStaticMarkup(
      <PipelineChoices
        next={{ skill: "pisma-proste-v2", reason: "jeden plik z 3 części", choices: [{ skill: "pisma-proste-v2", kind: "DOCUMENT", reason: "jeden plik z 3 części", longDocumentId: ID }] }}
        auto={false}
        disabled={false}
        onChoose={() => undefined}
        onLongDocument={() => undefined}
      />
    );
    expect(html).toContain("Generuj dokument");
    expect(html).toContain("jeden plik z 3 części");
  });

  it("część zablokowana przez bramki: automatyczna poprawa z listą powołań", () => {
    const blocked = turn({ part: 3, ok: false, problems: ["art. 43a KC: niezweryfikowany w ELI"], next: 3 }, { status: "BLOCKED", answer: "" });
    expect(autoAdvanceDecision(blocked, 2, 3)).toMatchObject({ advance: true, message: "Popraw część 3 z 3." });
    expect(autoAdvanceDecision({ status: "BLOCKED", answer: "" } as never, null, 0)).toEqual({ advance: false, reason: "NO_WORKFLOW" });
  });
});
