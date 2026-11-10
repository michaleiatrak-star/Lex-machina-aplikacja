import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollapsibleCaseSection } from "./CollapsibleCaseSection.js";

const form = <button type="button">Zapisz wpis</button>;

describe("CollapsibleCaseSection", () => {
  it("is one compact row with the add button when there are no entries", () => {
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
    expect(html).toContain("matter-compact-row");
    expect(html).toContain("brak wpisów");
    expect(html).toContain("+ Dodaj");
    expect(html).not.toContain(">Pokaż<");
    // The form and the list open in a window, not in the card.
    expect(html).not.toContain("Zapisz wpis");
    expect(html).not.toContain("matter-schedule-list");
  });

  it("shows the number of entries and a button to open them", () => {
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
    expect(html).toContain(">2<");
    expect(html).toContain(">Pokaż<");
    expect(html).not.toContain("Jan Kowalski");
  });

  it("shows an error in the row", () => {
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
