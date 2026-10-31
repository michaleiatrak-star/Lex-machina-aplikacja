import { describe, expect, it } from "vitest";
import { astTextLines } from "../src/ast-text-lines.js";
import { applyAutomaticVerificationMarkers } from "../src/gate-i-auto-verification.js";
import { evaluateStatusConsistency } from "../src/status-consistency-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";

const ast = JSON.stringify({
  schemaVersion: "1",
  blocks: [
    { type: "paragraph", content: [{ type: "text", text: "Pismo „może wypełniać znamiona z art. 190a § 1 KK” wobec świadka." }] },
    { type: "list", items: [[{ type: "text", text: "obrazę art. 7 KPK" }], [{ type: "text", text: "Adres:\nul. Długa 1" }]] }
  ]
});

describe("document AST through the line gates", () => {
  it("every text node is a line; the markers stay in their node and the JSON stays valid", () => {
    const lines = astTextLines(`${ast}\n\n⚠️ Kontrola aplikacji: ostrzeżenie`)!;
    expect(lines.text.split("\n").filter((line) => line.includes("art."))).toHaveLength(2);
    const ledger = new VerificationLedger();
    ledger.add({ claim: "art. 7 KPK", kind: "statute", status: "VERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/490/text.pdf", sourceTier: "R1", fetchedAt: "2026-10-30T10:00:00Z" } as never);
    const marked = applyAutomaticVerificationMarkers(lines.text, ledger).text;
    const back = lines.restore(marked);
    const [json, tail] = [back.slice(0, back.lastIndexOf("}") + 1), back.slice(back.lastIndexOf("}") + 1)];
    const parsed = JSON.parse(json);
    expect(parsed.blocks[1].items[0][0].text).toMatch(/^obrazę art\. 7 KPK ✅ \[VER:/u);
    expect(parsed.blocks[1].items[1][0].text).toBe("Adres:\nul. Długa 1");
    expect(tail).toContain("Kontrola aplikacji");
    expect(evaluateStatusConsistency(marked, ledger).result).toBe("PASS");
  });

  it("text that is not a JSON document is left to the gates as it is", () => {
    expect(astTextLines("Zwykła odpowiedź z art. 5 KC.")).toBeNull();
  });
});
