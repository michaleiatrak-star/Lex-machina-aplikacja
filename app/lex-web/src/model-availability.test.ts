import { describe, expect, it } from "vitest";
import { noModelAvailable } from "./model-availability.js";

const none = { openai: false, anthropic: false, xai: false, google: false };
const account = (authenticated: boolean) => ({ authenticated } as never);

describe("no model the chat could use", () => {
  it("nothing configured, signed in or installed", () => {
    expect(noModelAvailable(none, { anthropic: account(false) }, false)).toBe(true);
  });
  it("any one source is enough", () => {
    expect(noModelAvailable({ ...none, openai: true }, {}, false)).toBe(false);
    expect(noModelAvailable(none, { anthropic: account(true) }, false)).toBe(false);
    expect(noModelAvailable(none, {}, true)).toBe(false);
  });
  it("not yet known is not none", () => {
    expect(noModelAvailable({ ...none, openai: undefined }, {}, false)).toBe(false);
    expect(noModelAvailable(none, {}, undefined)).toBe(false);
  });
});
