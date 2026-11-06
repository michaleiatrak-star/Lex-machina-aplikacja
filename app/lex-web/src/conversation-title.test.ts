import { describe, expect, it } from "vitest";
import { conversationTitle } from "./conversation-title.js";

describe("an individual user's conversation title", () => {
  it("drops the greeting and keeps the first question", () => {
    expect(conversationTitle("Hej, ile wynosi w tym roku wartość mienia przy wykroczeniu max ? Czy zmieniła się?")).toBe(
      "Ile wynosi w tym roku wartość mienia przy wykroczeniu max ?"
    );
  });
  it("cuts a long question at a word", () => {
    const title = conversationTitle("Sąsiad od trzech miesięcy zalewa mi łazienkę i nie chce zapłacić za remont sufitu ani ścian w kuchni");
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
    expect(title.startsWith("Sąsiad od trzech miesięcy")).toBe(true);
  });
  it("a greeting alone is a new conversation", () => {
    expect(conversationTitle("Dzień dobry!")).toBe("Nowa rozmowa");
  });
});
