import { describe, expect, it } from "vitest";
import { compactActAbbreviations, provisionsForDetection } from "../src/legal-act-abbreviations.js";
import { planAutomaticLegalVerification, releaseModelUnverifiedMarkers } from "../src/gate-i-auto-verification.js";
import { detectLegalReferences } from "../src/finalization-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { exampleDataKeepDirectives } from "../src/privacy/example-data.js";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";

describe("dotted act abbreviations", () => {
  it("are one provision with the compact form", () => {
    expect(compactActAbbreviations("art. 233 k.k. i art. 5 k. p. c.")).toBe("art. 233 KK i art. 5 KPC");
    expect(detectLegalReferences("Art. 233 k.k. — fałszywe zeznanie.").map((item) => item.claim)).toEqual(["Art. 233 KK"]);
    const ledger = new VerificationLedger();
    ledger.add({ claim: "art. 233 KK", kind: "statute", status: "VERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf", fetchedAt: "2026-10-03T10:00:00Z", verificationMethod: "web_fetch_pdf" });
    expect(ledger.latest("Art. 233 k.k.")?.status).toBe("VERIFIED");
  });

  it("make the question's bare provisions verifiable before the answer", () => {
    const query = provisionsForDetection("Wykaż różnice pomiędzy 233 kk, 234 kk i 238 kk.");
    expect(query).toBe("Wykaż różnice pomiędzy art. 233 KK, art. 234 KK i art. 238 KK.");
    expect(planAutomaticLegalVerification(query, new VerificationLedger()).calls.map((call) => call.input.claim)).toEqual([
      "art. 233 KK",
      "art. 234 KK",
      "art. 238 KK"
    ]);
    expect(provisionsForDetection("art. 233 § 1 kk")).toBe("art. 233 § 1 KK");
    expect(provisionsForDetection("w 2024 r. 5 osób")).toBe("w 2024 r. 5 osób");
  });
});

describe("markers the model wrote itself", () => {
  it("are released for statutes so the application verifies them; case lines keep them", () => {
    const draft = [
      "Art. 233 k.k. ⚠️ [NIEWERYFIKOWANE] — fałszywe zeznanie.",
      "Wyrok SN, sygn. II KK 1/24 ⚠️ [NIEWERYFIKOWANE]"
    ].join("\n");
    const { text, released } = releaseModelUnverifiedMarkers(draft);
    expect(released).toBe(1);
    expect(text.split("\n")[0]).toBe("Art. 233 k.k. — fałszywe zeznanie.");
    expect(text.split("\n")[1]).toContain("NIEWERYFIKOWANE");
    const plan = planAutomaticLegalVerification(text, new VerificationLedger());
    expect(plan.calls.map((call) => call.input)).toEqual([expect.objectContaining({ claim: "Art. 233 KK", act: "KK" })]);
  });
});

describe("example data written by the assistant", () => {
  const conversation = [
    "Użytkownik: Podaj wzór wezwania do zapłaty.",
    "Asystent: Wzór: Jan Kowalski, ul. Polna 1, 00-001 Warszawa, wzywa do zapłaty.",
    "Użytkownik: A jak napisać to dla spółki?"
  ].join("\n\n");
  const findings = [
    { kind: "PERSON" as const, start: conversation.indexOf("Jan Kowalski"), end: conversation.indexOf("Jan Kowalski") + "Jan Kowalski".length },
    { kind: "PESEL" as const, start: conversation.indexOf("Polna"), end: conversation.indexOf("Polna") + 5 }
  ];

  it("is kept when it appears nowhere the user supplied", () => {
    expect(exampleDataKeepDirectives(conversation, findings)).toEqual([{ start: findings[0]!.start, end: findings[0]!.end, action: "KEEP" }]);
  });

  it("is protected when the user gave it, a document holds it or the history is incomplete", () => {
    const withUser = `Użytkownik: Dłużnik: Kowalskiego Jan.\n\n${conversation}`;
    const at = withUser.indexOf("Jan Kowalski,");
    expect(exampleDataKeepDirectives(withUser, [{ kind: "PERSON", start: at, end: at + 12 }])).toEqual([]);
    expect(exampleDataKeepDirectives(conversation, findings, "umowa z Janem Kowalskim")).toEqual([]);
    expect(exampleDataKeepDirectives(`[Wcześniejsza część rozmowy pominięta (4 wiadomości) — nie mieści się w oknie modelu.]\n\n${conversation}`, findings)).toEqual([]);
  });

  it("goes to the model as written", async () => {
    const at = conversation.indexOf("Jan Kowalski");
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault()).pseudonymize(conversation, [
      { start: at, end: at + 12, action: "KEEP" }
    ]);
    expect(result.text).toContain("Jan Kowalski");
  });
});
