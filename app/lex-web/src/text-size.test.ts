import { afterEach, describe, expect, it, vi } from "vitest";
import { readChatTextSize, saveChatTextSize } from "./text-size";

afterEach(() => vi.unstubAllGlobals());

describe("chat text size", () => {
  it("remembers the choice and falls back to standard for anything else", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    expect(readChatTextSize()).toBe("standard");
    saveChatTextSize("larger");
    expect(readChatTextSize()).toBe("larger");
    store.set("lex.chatTextSize", "huge");
    expect(readChatTextSize()).toBe("standard");
  });

  it("works without storage (private window)", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(readChatTextSize()).toBe("standard");
    expect(() => saveChatTextSize("large")).not.toThrow();
  });
});
