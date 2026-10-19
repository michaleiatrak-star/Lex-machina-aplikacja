import { describe, expect, it } from "vitest";
import { isOfficialLegalSourceUrl } from "../src/legal-source-verifier.js";
import { classifyKnownLegalSourceUrl } from "../src/legal-source-policy.js";

describe("Monitor Polski: dziennik urzędowy najwyższej rangi", () => {
  it("strona Monitora Polskiego jest źródłem urzędowym R1 dla weryfikacji", () => {
    for (const url of ["https://monitorpolski.gov.pl/MP/2026/512", "https://www.monitorpolski.gov.pl/mp/2026/512/akt.pdf"]) {
      expect(isOfficialLegalSourceUrl(url)).toBe(true);
      expect(classifyKnownLegalSourceUrl(url)).toBe("R1");
    }
  });
});
