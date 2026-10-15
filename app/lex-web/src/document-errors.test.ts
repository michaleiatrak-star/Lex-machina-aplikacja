import { describe, expect, it } from "vitest";
import { ApiError } from "./api.js";
import { documentFailure, privacyConfirmFailure } from "./document-errors.js";

describe("document failures in plain Polish", () => {
  it("an empty body (macOS transport) is a retryable message, the code only in details", () => {
    const failure = documentFailure(new ApiError("DOCUMENT_BODY_REQUIRED", 400));
    expect(failure.message).toMatch(/^Plik dotarł do programu pusty/u);
    expect(failure.message).not.toContain("DOCUMENT_BODY_REQUIRED");
    expect(failure).toMatchObject({ code: "DOCUMENT_BODY_REQUIRED", retryable: true });
  });

  it("an unsupported type is not retryable; an unknown code still gets a sentence", () => {
    expect(documentFailure(new ApiError("UNSUPPORTED_DOCUMENT_MEDIA_TYPE", 415)).retryable).toBe(false);
    const unknown = documentFailure(new ApiError("SOMETHING_NEW", 500));
    expect(unknown.message).toMatch(/^Nie udało się odczytać pliku\./u);
    expect(unknown.code).toBe("SOMETHING_NEW");
  });

  it("OCR models left incomplete by an installation cut short: finish the installation, no retry", () => {
    const description = "Error: OCR_MODELS_INCOMPLETE: PP-OCRv6_medium_det, PP-OCRv6_medium_rec";
    const failure = documentFailure(new ApiError("DOCUMENT_REVIEW_FAILED", 422, undefined, undefined, description));
    expect(failure.message).toMatch(/^Instalacja programu nie została dokończona/u);
    expect(failure.message).toContain("Uruchom instalator");
    expect(failure.retryable).toBe(false);
  });

  it("a failed confirmation of the privacy preview says why in Polish", () => {
    const overlap = privacyConfirmFailure(new ApiError("DOCUMENT_PRIVACY_FINALIZATION_FAILED", 422, undefined, "OVERLAPPING_PRIVACY_DIRECTIVES"));
    expect(overlap).toMatch(/^Nie zatwierdzono: dwa Twoje zaznaczenia nachodzą na siebie/u);
    expect(privacyConfirmFailure(new ApiError("DOCUMENT_PRIVACY_FINALIZATION_FAILED", 422))).toContain("Kod: DOCUMENT_PRIVACY_FINALIZATION_FAILED");
  });
});

