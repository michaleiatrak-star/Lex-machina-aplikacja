import { describe, expect, it } from "vitest";
import { knownContextWindow } from "../src/providers/model-catalog.js";
import { accountModelList, mainLineModel } from "../src/providers/model-families.js";

describe("0.1.101: windows of hosted models and the account's newest models", () => {
  it("uses the 1M window of current Claude models, also through the account session", () => {
    expect(knownContextWindow("anthropic", "claude-opus-5-5")).toBe(1_000_000);
    expect(knownContextWindow("anthropic", "account/anthropic/claude-fable-5-2")).toBe(1_000_000);
    expect(knownContextWindow("anthropic", "account/anthropic/default")).toBe(1_000_000);
    expect(knownContextWindow("anthropic", "claude-haiku-4-5")).toBe(200_000);
    // No guess for a line the documentation does not name.
    expect(knownContextWindow("openai", "gpt-5.5")).toBeUndefined();
  });

  it("builds the account's choice from the provider's list: the two newest of each main line", () => {
    const listed = ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5", "claude-fable-5-2", "claude-fable-5-1", "claude-fable-5"].map((id) => ({
      provider: "anthropic" as const,
      id,
      displayName: id,
      selectable: true
    }));
    const ids = accountModelList("anthropic", listed).map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1"]));
    expect(ids).not.toContain("claude-opus-4-8");
    expect(ids).not.toContain("claude-haiku-5-5");
    expect(accountModelList("anthropic", null).map((item) => item.id)).toContain("claude-fable-5-2");
    expect(mainLineModel("anthropic", "claude-sonnet-5-5")).toBe(true);
    expect(mainLineModel("anthropic", "claude-haiku-5-5")).toBe(false);
  });
});

import { transliteratedName } from "../src/witness-statements.js";
import { factRows } from "../src/fact-matrix.js";

describe("0.1.101: the same witness in another transliteration (A6, A8)", () => {
  it("keys Jurij / Yurii / Yuriy as one name", () => {
    expect(transliteratedName("Yurii Lenk")).toBe(transliteratedName("Jurij Lenk"));
    expect(transliteratedName("Yuriy Lenk")).toBe(transliteratedName("Jurij Lenk"));
    expect(transliteratedName("Anna Nowak")).not.toBe(transliteratedName("Anna Kowal"));
  });

  it("a name in another transliteration is not a difference of the matrix", () => {
    const fact = (record: string, value: string) => ({ topic: "świadek", attribute: "imię i nazwisko", value, record, quote: value, documentId: record, chunkIndex: 0 });
    const [row] = factRows([fact("D01", "Jurij Lenk"), fact("D02", "Yurii Lenk")]);
    expect(row!.differs).toBe(false);
  });
});
