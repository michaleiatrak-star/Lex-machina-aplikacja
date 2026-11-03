import { describe, expect, it } from "vitest";
import { recordingMediaType } from "./api.js";
import { documentFailure, TRANSCRIPTION_MODEL_MISSING } from "./document-errors.js";
import { ApiError } from "./api.js";
import { progressLabel } from "./processing-progress.js";

describe("nagrania: typ pliku, błędy, postęp", () => {
  it("typ nagrania po rozszerzeniu, niezależnie od nazwy z przeglądarki", () => {
    expect(recordingMediaType("Rozprawa 12.10.M4A")).toBe("audio/mp4");
    expect(recordingMediaType("film.mkv")).toBe("video/x-matroska");
    expect(recordingMediaType("pismo.pdf")).toBeNull();
  });

  it("brak modelu transkrypcji: jasna instrukcja zamiast ponawiania", () => {
    const failure = documentFailure(new ApiError("DOCUMENT_REVIEW_FAILED", 422, undefined, undefined, "TRANSCRIPTION_MODEL_MISSING"));
    expect(failure.message).toBe(TRANSCRIPTION_MODEL_MISSING);
    expect(failure.retryable).toBe(false);
  });

  it("postęp transkrypcji w minutach nagrania", () => {
    expect(progressLabel({ stage: "TRANSCRIPTION", done: 75, total: 600 })).toBe("Transkrypcja nagrania: 1:15 z 10:00");
  });
});

describe("plik chroniony hasłem", () => {
  it("prośba o hasło i złe hasło: pole hasła zamiast ponawiania", () => {
    const required = documentFailure(new ApiError("DOCUMENT_PASSWORD_REQUIRED", 422));
    expect(required.password).toBe(true);
    expect(required.retryable).toBe(false);
    expect(required.message).toContain("hasło nie jest nigdzie zapisywane");
    expect(documentFailure(new ApiError("DOCUMENT_PASSWORD_INVALID", 422)).message).toContain("Hasło nie pasuje");
  });
});
