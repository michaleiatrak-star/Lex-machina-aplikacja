import { describe, expect, it } from "vitest";
import { emailLinkFromHash } from "./ServerAuthPanels.js";

describe("links from server mode e-mails", () => {
  it("reads the verification and the password reset link", () => {
    const token = "a".repeat(43);
    expect(emailLinkFromHash(`#weryfikacja=${token}`)).toEqual({ kind: "verify", token });
    expect(emailLinkFromHash(`#reset-hasla=${token}`)).toEqual({ kind: "reset", token });
  });

  it("ignores anything else", () => {
    expect(emailLinkFromHash("")).toBeNull();
    expect(emailLinkFromHash("#weryfikacja=krotki")).toBeNull();
    expect(emailLinkFromHash(`#inne=${"a".repeat(43)}`)).toBeNull();
    expect(emailLinkFromHash(`#reset-hasla=${"a".repeat(43)}<script>`)).toBeNull();
  });
});
