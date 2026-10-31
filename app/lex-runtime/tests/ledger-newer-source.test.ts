import { describe, expect, it } from "vitest";
import { VerificationLedger } from "../src/verification-ledger.js";

const base = { kind: "statute" as const, sourceTier: "R1" as const, fetchedAt: "2026-10-31T16:40:00Z", toolCallId: "t" };

describe("a provision read in two consolidated texts", () => {
  it("the newer text's verification stands over the older text's doubt (live B02-P01)", () => {
    const ledger = new VerificationLedger();
    ledger.add({ ...base, claim: "art. 119 § 1 KW", status: "VERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/1372/text.pdf", verificationMethod: "file_read" } as never);
    ledger.add({ ...base, claim: "art. 119 § 1 KW", status: "UNVERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2023/2119/text.html", verificationMethod: "web_fetch" } as never);
    expect(ledger.latest("art. 119 § 1 KW")?.status).toBe("VERIFIED");
  });

  it("a doubt from the newer text still wins over an older verification", () => {
    const ledger = new VerificationLedger();
    ledger.add({ ...base, claim: "art. 119 § 1 KW", status: "VERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2023/2119/text.html", verificationMethod: "web_fetch" } as never);
    ledger.add({ ...base, claim: "art. 119 § 1 KW", status: "UNVERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/1372/text.pdf", verificationMethod: "file_read" } as never);
    expect(ledger.latest("art. 119 § 1 KW")?.status).toBe("UNVERIFIED");
  });
});
