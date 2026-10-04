import { describe, expect, it } from "vitest";
import { run } from "./shared-act-line.test.js";
const M54 = "✅ [VER: https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=54, 2026-10-04]";
const M55 = "✅ [VER: https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=55, 2026-10-04]";
const variants: Record<string, string> = {
  tableHeader: "| Cecha | Art. 233 | Art. 234 | Art. 238 |\n|---|---|---|---|\n| a | b | c | d |",
  plainNoAct: "Art. 233, art. 234 i art. 238 różnią się znamionami.",
  // The reported case: per-article markers copied by the model, act only in the heading.
  reported: `Art. 233 ${M54}, art. 234 ${M55} i art. 238 ${M55} różnią się znamionami.`,
  modelMarker: `Art. 233, art. 234 i art. 238 k.k. chronią wymiar sprawiedliwości. ${M54}`,
  modelMarkers: `Art. 233 ${M54}, art. 234 ${M55} i art. 238 k.k. ${M55} chronią wymiar sprawiedliwości.`,
  paragraph: "Art. 233 § 1, art. 234 i art. 238 k.k. chronią wymiar sprawiedliwości.",
  tableAct: "| Cecha | art. 233 k.k. | art. 234 k.k. | art. 238 k.k. |\n|---|---|---|---|\n| a | b | c | d |",
  bold: "**Art. 233 k.k.** vs **art. 234 k.k.** vs **art. 238 k.k.**",
  kkAfter: "W art. 233, 234 i 238 KK chodzi o co innego.",
  unverifiedOther: "Zob. też art. 4 i art. 6 ustawy o ochronie ⚠️ [NIEWERYFIKOWANE]"
};
describe("variants", () => {
  for (const [name, line] of Object.entries(variants)) {
    it(name, async () => {
      const { result, calls } = await run(
        ["Art. 233 § 1 k.k. penalizuje fałszywe zeznanie.", "", line, "", "To ogólna informacja prawna, nie indywidualna porada prawna."].join("\n"),
        "Wykaż różnice pomiędzy 233 kk, 233 § 1 kk, 234 kk i 238 kk."
      );
      const why = `${calls.join(",")} ${JSON.stringify(result.blockedReferences)}\n${result.answer ?? ""}`;
      expect(result.finalization, why).not.toBe("BLOCKED");
      if (name !== "unverifiedOther") expect(result.answer, why).not.toContain("NIEWERYFIKOWANE");
    }, 60_000);
  }
});
