import { describe, expect, it } from "vitest";
import { groupCoreLawActs } from "./CoreLawUpdatesSection.js";
import type { CoreLawActStatus } from "./api.js";

function act(eli: string, state: CoreLawActStatus["state"]): CoreLawActStatus {
  return {
    eli,
    title: eli,
    status: null,
    consolidated: true,
    labels: [],
    domains: [],
    textSource: "html",
    articleCount: 1,
    fetchedAt: "2026-10-01T00:00:00Z",
    lastError: null,
    relationsCheckedAt: null,
    currentEli: eli,
    amendmentsAfter: [],
    pendingConsolidated: null,
    pendingAmendments: [],
    state
  };
}

describe("karta przepisów (RAG)", () => {
  it("dzieli akty na aktualne i wymagające aktualizacji, najpierw te z gotową aktualizacją", () => {
    const groups = groupCoreLawActs([
      act("DU/2025/1", "CURRENT"),
      act("DU/2025/2", "CHECK_DUE"),
      act("DU/2025/3", "UPDATE_AVAILABLE"),
      act("DU/2025/4", "ERROR")
    ]);
    expect(groups.current.map((a) => a.eli)).toEqual(["DU/2025/1"]);
    expect(groups.needsUpdate.map((a) => a.eli)).toEqual(["DU/2025/3", "DU/2025/4", "DU/2025/2"]);
  });
});
