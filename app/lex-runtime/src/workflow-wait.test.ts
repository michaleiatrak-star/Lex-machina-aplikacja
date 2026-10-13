import { describe, expect, it } from "vitest";
import { WAITING_FOR_USER_MARKER, waitsForUser, withoutWaitingMarker } from "./workflow-wait.js";

describe("waiting-for-user marker", () => {
  it("is recognised only as its own line, also in Markdown emphasis", () => {
    expect(waitsForUser(`Podaj datę doręczenia nakazu.\n\n${WAITING_FOR_USER_MARKER}`)).toBe(true);
    expect(waitsForUser(`Pytanie?\n**${WAITING_FOR_USER_MARKER}**\n\nZastrzeżenie: ...`)).toBe(true);
    expect(waitsForUser(`W razie braków piszę „${WAITING_FOR_USER_MARKER}” na końcu.`)).toBe(false);
    expect(waitsForUser("Punkt CP-1a zakończony.")).toBe(false);
    expect(waitsForUser(undefined)).toBe(false);
  });

  it("the marker line is removed from what the user reads", () => {
    expect(withoutWaitingMarker(`Pytanie 1?\n\n${WAITING_FOR_USER_MARKER}\n\nZastrzeżenie.`)).toBe("Pytanie 1?\n\nZastrzeżenie.");
  });
});
