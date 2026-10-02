import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollapsibleCaseSection } from "./CollapsibleCaseSection.js";

const form = <button type="button">Zapisz wpis</button>;

describe("CollapsibleCaseSection", () => {
  it("is collapsed to its header when there are no entries", () => {
    const html = renderToStaticMarkup(
      <CollapsibleCaseSection
        eyebrow="Terminarz sprawy"
        title="Spotkania, posiedzenia i terminy"
        count={0}
        loading={false}
        resetKey="case-1"
        addLabel="Dodaj termin"
        addForm={form}
      >
        {null}
      </CollapsibleCaseSection>
    );
    expect(html).not.toContain("<details class=\"chat-card matter-schedule-card matter-collapsible\" open");
    expect(html).toContain("brak wpisów");
    expect(html).not.toContain("matter-schedule-list");
    expect(html).toContain("Zapisz wpis");
  });

  it("shows existing entries open and keeps the add form behind a toggle", () => {
    const html = renderToStaticMarkup(
      <CollapsibleCaseSection
        eyebrow="Osoby i organizacje"
        title="Kontakty w sprawie"
        count={2}
        loading={false}
        resetKey="case-1"
        addLabel="Dodaj kontakt"
        addForm={form}
      >
        <div className="matter-schedule-item">Jan Kowalski</div>
      </CollapsibleCaseSection>
    );
    expect(html).toMatch(/<details class="chat-card matter-schedule-card matter-collapsible" open/);
    expect(html).toContain("Jan Kowalski");
    expect(html).toContain(">2<");
    expect(html).toMatch(/<details class="matter-add-entry"><summary>Dodaj kontakt<\/summary>/);
  });

  it("opens to show an error even without entries", () => {
    const html = renderToStaticMarkup(
      <CollapsibleCaseSection
        eyebrow="Terminarz sprawy"
        title="Spotkania, posiedzenia i terminy"
        count={0}
        loading={false}
        error="Brak dostępu"
        resetKey="case-1"
        addLabel="Dodaj termin"
      >
        {null}
      </CollapsibleCaseSection>
    );
    expect(html).toContain("Brak dostępu");
  });
});
