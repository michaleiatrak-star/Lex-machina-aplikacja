import { describe, expect, it } from "vitest";
import { ApiError } from "./api.js";
import { exportBlockedMessage } from "./MatterChatApp.js";

describe("odmowa zapisu pisma przez bramkę eksportu", () => {
  it("wymienia powołania i proponuje projekt, gdy są tylko niezweryfikowane", () => {
    const error = new ApiError(
      "READY_DOCUMENT_EXPORT_GATE_BLOCKED:UNVERIFIED_REFERENCE_REQUIRES_HUMAN_DECISION",
      422,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [{ claim: "art. 5 KC", status: "UNVERIFIED_MARKED", line: 1 }],
      true
    );
    expect(exportBlockedMessage(error)).toBe(
      "Pismo nie zostało zapisane: powołania bez potwierdzenia w źródle: art. 5 KC (niezweryfikowany w źródle). Możesz zapisać je jako projekt z tymi powołaniami wskazanymi w nagłówku."
    );
  });

  it("nie proponuje projektu przy blokadzie i milczy dla innych błędów", () => {
    const blocked = new ApiError(
      "FINAL_DOCUMENT_EXPORT_GATE_BLOCKED:G8_FINALIZATION_BLOCKED",
      422,
      undefined, undefined, undefined, undefined, undefined,
      [{ claim: "sygn. III CZP 1/20", status: "CASE_QUOTE_MISMATCH", line: 3 }],
      false
    );
    expect(exportBlockedMessage(blocked)).toContain("sygn. III CZP 1/20 (orzeczenie: cytat lub teza niepotwierdzone)");
    expect(exportBlockedMessage(blocked)).toContain("Popraw lub usuń te powołania");
    expect(exportBlockedMessage(new ApiError("PROVIDER_NOT_CONFIGURED", 503))).toBeNull();
  });
});
