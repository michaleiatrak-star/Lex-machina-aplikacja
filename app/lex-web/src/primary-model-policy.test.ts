import { describe, expect, it } from "vitest";
import { PROVIDER_GROUPS, preferredSourceForGroup, providerGroupOf, sourceForGroup } from "./primary-model-policy";

describe("one provider in the selectors, its connection chosen in settings", () => {
  it("five entries instead of nine", () => {
    expect(PROVIDER_GROUPS.map((item) => item.id)).toEqual(["openai", "anthropic", "xai", "google", "local"]);
    expect(providerGroupOf("anthropic-account")).toBe("anthropic");
    expect(providerGroupOf("anthropic")).toBe("anthropic");
    expect(sourceForGroup("google", "account")).toBe("google-account");
  });

  it("the remembered connection, else a connected account, else a saved key, else the account", () => {
    expect(preferredSourceForGroup("openai", "api", { accountConnected: true })).toBe("openai");
    expect(preferredSourceForGroup("openai", undefined, { accountConnected: true, apiConfigured: true })).toBe("openai-account");
    expect(preferredSourceForGroup("openai", undefined, { apiConfigured: true })).toBe("openai");
    expect(preferredSourceForGroup("openai", undefined, {})).toBe("openai-account");
    expect(preferredSourceForGroup("local", "api", {})).toBe("local");
  });
});
