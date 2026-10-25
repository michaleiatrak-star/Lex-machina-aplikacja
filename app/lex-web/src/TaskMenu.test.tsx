import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DETERMINISTIC_ACTIONS } from "./chat-routing";
import { TaskMenu } from "./TaskMenu";

describe("TaskMenu", () => {
  it("lists automatic work and the kinds of work in the demo's groups", () => {
    const html = renderToStaticMarkup(
      <TaskMenu actions={DETERMINISTIC_ACTIONS} selected={null} pinned={false} developerMode={false} onSelect={() => undefined} />
    );
    expect(html).toContain("Zadanie: Automatycznie");
    for (const group of ["Dokumenty i fakty", "Pisma i przygotowanie", "Przepisy i orzeczenia", "Podsumowania"]) expect(html).toContain(group);
    for (const action of DETERMINISTIC_ACTIONS) expect(html).toContain(`<strong>${action.label}</strong>`);
    expect(html).not.toContain("analizator-umow-v1");
  });

  it("after the first message shows the pinned kind of work without a menu", () => {
    const pleading = DETERMINISTIC_ACTIONS.find((action) => action.id === "PROCESS_PLEADING")!;
    const html = renderToStaticMarkup(
      <TaskMenu actions={DETERMINISTIC_ACTIONS} selected={pleading} pinned developerMode={false} onSelect={() => undefined} />
    );
    expect(html).toContain("Zadanie: Pismo procesowe");
    expect(html).not.toContain("<details");
  });

  it("names the router and the executive skills in developer mode", () => {
    const html = renderToStaticMarkup(
      <TaskMenu actions={DETERMINISTIC_ACTIONS} selected={null} pinned={false} developerMode onSelect={() => undefined} />
    );
    expect(html).toContain("Zadanie: Automatyczny — prawny router");
    expect(html).toContain("Mechaniczny — wybierz skill wykonawczy");
    expect(html).toContain("analizator-umow-v1");
  });
});

