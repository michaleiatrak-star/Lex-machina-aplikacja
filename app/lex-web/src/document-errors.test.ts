import { describe, expect, it } from "vitest";
import { ApiError } from "./api.js";
import { documentFailure } from "./document-errors.js";

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
});
