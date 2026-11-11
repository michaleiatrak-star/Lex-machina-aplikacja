import { describe, expect, it } from "vitest";
import { QUOTE_CONTRADICTS_UNIT, QUOTE_NOT_IN_UNIT, VerificationLedger } from "../src/verification-ledger.js";

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

  it("a paraphrased quote of the same text does not undo the provision's verification (art. 280 § 1 KK, 2026-11-11)", () => {
    const ledger = new VerificationLedger();
    const url = "https://api.sejm.gov.pl/eli/acts/DU/2026/1342/text.pdf";
    ledger.add({ ...base, claim: "art. 280 § 1 KK", status: "VERIFIED", sourceUrl: url, verificationMethod: "file_read" } as never);
    ledger.add({ ...base, claim: "art. 280 § 1 KK", status: "UNVERIFIED", sourceUrl: url, evidence: QUOTE_NOT_IN_UNIT, verificationMethod: "file_read" } as never);
    expect(ledger.latest("art. 280 § 1 KK")?.status).toBe("VERIFIED");
    // A quote with other words or numbers ("od 2 do 12 lat") still wins over the verification.
    ledger.add({ ...base, claim: "art. 280 § 1 KK", status: "UNVERIFIED", sourceUrl: url, evidence: QUOTE_CONTRADICTS_UNIT, verificationMethod: "file_read" } as never);
    expect(ledger.latest("art. 280 § 1 KK")?.status).toBe("UNVERIFIED");
    // Any other doubt from the same text still wins.
    ledger.add({ ...base, claim: "art. 280 § 1 KK", status: "UNVERIFIED", sourceUrl: url, evidence: "Ta jednostka jest w aktualnym tekście jednolitym uchylona.", verificationMethod: "file_read" } as never);
    expect(ledger.latest("art. 280 § 1 KK")?.status).toBe("UNVERIFIED");
  });
});
