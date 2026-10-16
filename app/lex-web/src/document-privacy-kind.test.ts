import { describe, expect, it } from "vitest";
import { suggestionKind } from "./DocumentPrivacyPanel";

describe("suggestion kind label", () => {
  it("a firm's name (masked with a PERSON token) is shown as a firm", () => {
    expect(suggestionKind({ kind: "PERSON", firm: "TEXT" })).toBe("FIRMA");
    expect(suggestionKind({ kind: "PERSON", firm: "REGISTRY" })).toBe("FIRMA");
    expect(suggestionKind({ kind: "PERSON" })).toBe("PERSON");
  });
});
