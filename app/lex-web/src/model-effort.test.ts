import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_EFFORT, parseModelEffort } from "./model-effort";

describe("model effort", () => {
  it("is medium unless the user chose otherwise", () => {
    expect(DEFAULT_MODEL_EFFORT).toBe("medium");
    expect(parseModelEffort(null)).toBe("medium");
    expect(parseModelEffort("high")).toBe("high");
    expect(parseModelEffort("max")).toBe("medium");
  });
});
