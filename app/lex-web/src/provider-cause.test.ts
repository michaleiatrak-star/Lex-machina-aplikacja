import { describe, expect, it } from "vitest";
import { plainErrorMessage } from "./developer-mode.js";

describe("a provider failure in plain words", () => {
  it("names the limit, the key, an outage or a lost connection from the provider's own error", () => {
    expect(plainErrorMessage("PROVIDER_EXECUTION_FAILED", "ChatGPT odrzucił. Szczegóły: 429 Too Many Requests", "PROVIDER_UNCODED_FAILURE")).toMatch(/limitu/u);
    expect(plainErrorMessage("PROVIDER_EXECUTION_FAILED", "Szczegóły: Incorrect API key provided", "PROVIDER_UNCODED_FAILURE")).toMatch(/klucz API/u);
    expect(plainErrorMessage("PROVIDER_EXECUTION_FAILED", "Szczegóły: 529 overloaded_error", "PROVIDER_UNCODED_FAILURE")).toMatch(/przeciążona/u);
    expect(plainErrorMessage("PROVIDER_EXECUTION_FAILED", "Szczegóły: socket hang up", "PROVIDER_UNCODED_FAILURE")).toMatch(/przerwane/u);
    expect(plainErrorMessage("PROVIDER_EXECUTION_FAILED", "Szczegóły: something else", "PROVIDER_UNCODED_FAILURE")).toBe("Model nie przygotował odpowiedzi. Spróbuj ponownie albo wybierz inny model.");
  });
});
