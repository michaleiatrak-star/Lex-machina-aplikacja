import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeDashboard } from "./HomeDashboard.js";

const user = { userId: "u1", loginName: "jan", displayName: "Jan", appRole: "ADMIN" } as never;
const item = (caseId: string, displayName: string, role: string) =>
  ({ caseId, displayName, role, createdAt: "2026-11-04T10:00:00.000Z", updatedAt: "2026-11-04T11:00:00.000Z", archivedAt: null }) as never;
const props = {
  user,
  cases: [item("c1", "Najem lokalu", "OWNER"), item("c2", "Spadek", "VIEWER")],
  modelLabel: "",
  modelStatus: "",
  refreshToken: 0,
  onOpenCase: () => undefined,
  onOpenCalendar: () => undefined,
  onOpenFirm: () => undefined,
  onOpenModels: () => undefined,
  onNewCase: () => undefined
};

describe("Start: sprawy od najnowszych", () => {
  it("właściciel sprawy zmienia jej nazwę z karty startowej; inne role nie", () => {
    const html = renderToStaticMarkup(<HomeDashboard {...props} onRenameCase={async () => undefined} />);
    expect(html).toContain('aria-label="Zmień nazwę sprawy Najem lokalu"');
    expect(html).not.toContain("Zmień nazwę sprawy Spadek");
  });

  it("bez obsługi zmiany nazwy - bez przycisku", () => {
    expect(renderToStaticMarkup(<HomeDashboard {...props} />)).not.toContain("Zmień nazwę sprawy");
  });
});
