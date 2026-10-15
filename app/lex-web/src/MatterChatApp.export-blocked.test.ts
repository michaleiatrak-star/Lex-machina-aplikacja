import { describe, expect, it } from "vitest";
import { ApiError } from "./api.js";
import { checkpointHeldNotice, exportBlockedMessage } from "./MatterChatApp.js";

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

  it("HYBRID-VAL przed plikiem: przyczyny słowami zamiast kodu", () => {
    const error = new ApiError("TOKENIZED_DOCUMENT_HYBRID_BLOCKED:OPEN_PLACEHOLDER,SOURCE_SESSION_BLOCKED_EVENT", 422);
    expect(exportBlockedMessage(error)).toBe(
      "Dokument nie został zapisany: walidacja HYBRID-VAL przed plikiem wykazała, że zostały niewypełnione pola ([UZUPEŁNIJ] lub ⬛); w rozmowie, z której powstaje dokument, był zablokowany krok. Popraw treść w rozmowie i wygeneruj dokument ponownie."
    );
  });

  it("etap z odmówionym krokiem: komunikat zamiast błędu serwera", () => {
    expect(checkpointHeldNotice(["read_legal_resource:analizator-umow-v1/references/brak.md"])).toBe(
      "Etap nie został zamknięty: w tej turze odmówiono kroku (read_legal_resource:analizator-umow-v1/references/brak.md). Odpowiedź poniżej jest robocza; powtórz etap, aby zamknąć go z pełnym śladem audytu."
    );
  });
});
