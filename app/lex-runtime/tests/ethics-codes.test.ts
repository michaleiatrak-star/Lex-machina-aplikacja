import { describe, expect, it } from "vitest";
import { citedEthicsParagraphs, ethicsParagraph, ethicsPrompt, ETHICS_CODES } from "../src/courts/ethics-codes.js";

const KEA_TEXT = "§ 15\nAdwokat nie może powoływać się na okoliczności drastyczne.\n§ 16\nW razie konieczności przytoczenia drastycznych okoliczności lub wyrażeń adwokat powinien\nnadać swemu wystąpieniu taką formę. W korespondencji zawodowej należy przestrzegać właściwych form.\nNie wolno używać wyrażeń czy zwrotów obraźliwych ani grozić ściganiem karnym lub\ndyscyplinarnym.\n§ 17\nAdwokat powinien zachować umiar.";

describe("codes of professional ethics the case file cites", () => {
  it("finds the paragraphs of KEA in its usual names", () => {
    const text = "Zgodnie z § 16 zd. 3 KEA w korespondencji nie wolno grozić. Naruszył też §§ 17 i 18 Kodeksu Etyki Adwokackiej. Art. 16 KC nie ma tu znaczenia.";
    expect(citedEthicsParagraphs(text)).toEqual([{ code: ETHICS_CODES[0], paragraphs: ["16", "17", "18"] }]);
    expect(citedEthicsParagraphs("§ 16 regulaminu sądu")).toEqual([]);
  });
  it("reads one paragraph to the next one", () => {
    expect(ethicsParagraph(KEA_TEXT, "16")).toBe("§ 16. W razie konieczności przytoczenia drastycznych okoliczności lub wyrażeń adwokat powinien nadać swemu wystąpieniu taką formę. W korespondencji zawodowej należy przestrzegać właściwych form. Nie wolno używać wyrażeń czy zwrotów obraźliwych ani grozić ściganiem karnym lub dyscyplinarnym.");
    expect(ethicsParagraph(KEA_TEXT, "99")).toBeNull();
  });
  it("prompt: the ethics rule as the central norm, a missing paragraph named", () => {
    const prompt = ethicsPrompt([{ status: "FOUND", code: ETHICS_CODES[0]!, source: ETHICS_CODES[0]!.sources[0]!, from: "LOCAL", fetchedAt: "2026-11-12T10:00:00Z", paragraphs: [{ paragraph: "16", text: ethicsParagraph(KEA_TEXT, "16") }, { paragraph: "99", text: null }] }]);
    expect(prompt).toContain("normą centralną jest naruszona zasada etyki");
    expect(prompt).toContain("grozić ściganiem karnym lub dyscyplinarnym");
    expect(prompt).toContain("§ 99: brak takiego paragrafu");
  });
});
