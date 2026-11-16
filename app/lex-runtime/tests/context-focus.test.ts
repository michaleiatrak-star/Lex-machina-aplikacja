import { describe, expect, it } from "vitest";
import type { SessionDocumentAttachment } from "../src/session-executor.js";
import { orchestrateDocumentContext } from "../src/context-orchestrator.js";
import { caseFocus } from "../src/case-issue.js";

const KEA_16 =
  "§ 16. W razie konieczności przytoczenia drastycznych okoliczności lub wyrażeń adwokat powinien nadać swemu wystąpieniu taką formę, aby nie uchybiać powadze sądu, władz i godności zawodu adwokackiego. W korespondencji zawodowej należy przestrzegać właściwych form. Nie wolno używać wyrażeń czy zwrotów obraźliwych ani grozić ściganiem karnym lub dyscyplinarnym.";
const DECISION =
  "POSTANOWIENIE o odmowie wszczęcia dochodzenia. Zastępca Rzecznika Dyscyplinarnego Izby Adwokackiej. Zakaz z § 16 KEA chroni przed wykorzystywaniem groźby ścigania karnego jako środka nacisku. Pismo nie zapowiada złożenia zawiadomienia o przestępstwie.";
// A hearing record: long routine testimony; the attorney's statement on its last page.
const filler = (page: number) =>
  `${String(page).padStart(2, "0")}:10:00 Świadek zeznaje o organizacji pracy w dziale, grafiku zmian, zakresie obowiązków i wynagrodzeniu. ` +
  "Pytania pełnomocnika powoda dotyczą harmonogramu, list obecności, premii i urlopów. ".repeat(60);
const LAST =
  "01:53:35 Pełnomocnik pozwanej oświadcza, iż nie życzy sobie, aby poza procesem powód kontaktował się z nim w jakikolwiek sposób. Każda taka sytuacja będzie traktowana jako nękanie i będzie zgłaszana do odpowiednich organów.";

function knowledge(id: string, texts: string[]): SessionDocumentAttachment {
  return {
    documentId: id,
    sourceScope: "CASE_KNOWLEDGE",
    chunks: texts.map((text, index) => ({ index, pageStart: index + 1, pageEnd: index + 1, text }))
  } as SessionDocumentAttachment;
}

describe("long case files: the parts on the issue reach the model (RD 121/26, protocol 01:53:35)", () => {
  const record = knowledge("doc_protocol", [...Array.from({ length: 40 }, (_, page) => filler(page)), `${filler(41)}\n${LAST}`]);
  const decision = knowledge("doc_decision", [DECISION]);
  const question = "przygotuj podważenie postanowienia zastępcy rzecznika dyscyplinarnego";
  const focus = caseFocus([{ code: "KEA", paragraph: "16", text: KEA_16 }], `${DECISION}\n${LAST}`, question);

  it("the issue's vocabulary names the statement's words", () => {
    expect(focus).toContain("grozić ściganiem karnym lub dyscyplinarnym");
    expect(focus).toContain("zgłaszana");
    expect(focus).toContain("nękanie");
  });

  it("over budget: the last page with the statement is sent whole; without the issue it was not", () => {
    const run = (withFocus: boolean) =>
      orchestrateDocumentContext({ attachments: [decision, record], query: question, modelContextTokens: 32_768, ...(withFocus ? { focus } : {}) });
    const sentText = (result: ReturnType<typeof run>) =>
      result.attachments.flatMap((attachment) => attachment.chunks.filter((chunk) => chunk.representation === "FULL").map((chunk) => chunk.text)).join("\n");
    const focused = run(true);
    expect(sentText(focused)).toContain("będzie zgłaszana do odpowiednich organów");
    // The file's order is kept in what is sent.
    const indices = focused.attachments.find((attachment) => attachment.documentId === "doc_protocol")!.chunks.map((chunk) => chunk.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(sentText(run(false))).not.toContain("będzie zgłaszana do odpowiednich organów");
  });
});

describe("the sentences of the files on the issue are pointed out to the model", async () => {
  const { issuePassages, issuePassagesPrompt } = await import("../src/case-issue.js");
  it("the attorney's statement at 01:53:35 comes first, routine testimony not at all", () => {
    const focus = caseFocus([{ code: "KEA", paragraph: "16", text: KEA_16 }], `${DECISION}\n${LAST}`, "przygotuj podważenie postanowienia");
    const files = [
      { documentId: "doc_protocol", chunks: [...Array.from({ length: 5 }, (_, index) => ({ index, pageStart: index + 1, text: filler(index) })), { index: 5, pageStart: 6, text: LAST }] }
    ];
    const passages = issuePassages(files, focus);
    expect(passages[0]).toMatchObject({ documentId: "doc_protocol", chunkIndex: 5, page: 6 });
    expect(passages[0]!.text).toContain("zgłaszana do odpowiednich organów");
    expect(passages.some((passage) => /harmonogramu/u.test(passage.text))).toBe(false);
    expect(issuePassagesPrompt(passages)).toContain("[[LEXDOC:doc_protocol:5]] (s. 6)");
  });
});
