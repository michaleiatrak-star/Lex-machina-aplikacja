import { describe, expect, it } from "vitest";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";
import { addressForms, whiteListForms, type RegistryFormsProvider } from "../src/privacy/registry-enrichment.js";

describe("firms in the anonymizer", () => {
  it("the user's 'Firma' mark is a firm token, the legal form stays in the text", async () => {
    const text = "Umowę zawarto z Mostbud sp. z o.o. w Lublinie.";
    const start = text.indexOf("Mostbud");
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault()).pseudonymize(text, [
      { start, end: start + "Mostbud".length, action: "PSEUDONYMIZE", kind: "FIRM" }
    ]);
    expect(result.text).not.toContain("Mostbud");
    expect(result.text).toContain("sp. z o.o.");
    expect(result.findings).toEqual([expect.objectContaining({ kind: "PERSON", firm: "TEXT", source: "USER" })]);
  });

  it("a firm matched in the VAT white list is marked as found in the register", async () => {
    const reply = {
      status: "FOUND",
      result: { tytul_lub_nazwa: "ZIELONY LAS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", adres: "JANA NOWAKOWSKIEGO 15, 20-001 LUBLIN", osoby: [] }
    };
    const registry: RegistryFormsProvider = { forms: async () => whiteListForms(reply) };
    const text = "Wezwanie od Zielony Las, NIP 526-025-02-74, ul. Nowakowskiego 15, 20-001 Lublin.";
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), undefined, undefined, registry).pseudonymize(text);
    expect(result.text).not.toContain("Zielony Las");
    expect(result.text).not.toContain("Nowakowskiego 15");
    expect(result.findings.find((finding) => finding.kind === "PERSON")).toMatchObject({ firm: "REGISTRY" });
  });

  it("a register address of a street named after a person also matches the surname only", () => {
    const forms = addressForms("JÓZEFA NOWAKOWSKIEGO 15, 40-847 KATOWICE").map((form) => form.text);
    expect(forms).toContain("Nowakowskiego 15");
    expect(forms).toContain("Józefa Nowakowskiego 15");
    // A Roman numeral is no surname: "Jana Pawła II 5" gives no "II 5".
    expect(addressForms("JANA PAWŁA II 5, 00-001 WARSZAWA").map((form) => form.text)).not.toContain("II 5");
  });

  it("a register address and firm name in any letter case are masked; small-letter prose stays", async () => {
    const reply = {
      status: "FOUND",
      result: { tytul_lub_nazwa: "ZIELONY LAS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", adres: "JANA NOWAKOWSKIEGO 15, 20-001 LUBLIN", osoby: [] }
    };
    const registry: RegistryFormsProvider = { forms: async () => whiteListForms(reply) };
    const text = [
      "Zielony LAS, NIP 526-025-02-74.",
      "Siedziba: UL. NOWAKOWSKIEGO 15, 20-001 lublin; korespondencja: ul. NowaKowskiego  15.",
      "Spacer przez zielony las nie jest firmą."
    ].join("\n");
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), undefined, undefined, registry).pseudonymize(text);
    expect(result.text).not.toMatch(/nowakowskiego\s+15/iu);
    expect(result.text).not.toMatch(/20-001 lublin/iu);
    expect(result.text).not.toContain("Zielony LAS");
    expect(result.text).toContain("zielony las nie jest");
    const firmTokens = new Set(result.findings.filter((finding) => finding.firm).map((finding) => finding.token));
    expect(firmTokens.size).toBe(1);
  });
});

