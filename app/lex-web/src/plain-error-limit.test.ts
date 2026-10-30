import { describe, expect, it } from "vitest";
import { plainErrorMessage } from "./developer-mode.js";

describe("plan limit of the model account", () => {
  it("says when the limit renews (RD 121/26)", () => {
    const text = plainErrorMessage("PROVIDER_EXECUTION_FAILED", "ACCOUNT_SESSION_CAPACITY:anthropic:1:You've hit your 5-hour limit · resets 12:30am (UTC)", "ACCOUNT_SESSION_CAPACITY");
    expect(text).toBe("Wyczerpany limit konta modelu. Odnowi się: 12:30am (UTC). Do tego czasu wybierz inny model albo klucz API.");
    expect(plainErrorMessage("PROVIDER_EXECUTION_FAILED", "Rate limited", "ACCOUNT_SESSION_CAPACITY")).toContain("Odczekaj kilka minut");
  });
});
