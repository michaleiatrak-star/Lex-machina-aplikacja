import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnomalyJournalSection } from "./AnomalyJournalSection.js";

// Settings → Aplikacja i utrzymanie: the anomaly journal folds (counts in the heading,
// filters and tables on demand).
describe("ustawienia: dziennik nieprawidłowości", () => {
  it("dziennik nieprawidłowości jest zwinięty, nagłówek z licznikami w podsumowaniu", () => {
    const html = renderToStaticMarkup(<AnomalyJournalSection user={{ userId: "u1", appRole: "ADMIN" } as never} />);
    expect(html).toMatch(/^<details class="anomaly-journal"><summary class="maintenance-heading">/);
    expect(html).not.toContain("<details class=\"anomaly-journal\" open");
    expect(html).toContain("Dziennik nieprawidłowości");
    expect(html).toContain("0 błędów · 0 ostrzeżeń");
  });
});
