import { describe, expect, it } from "vitest";
import { citedDocuments } from "../src/case-content-grounding.js";
import { relevantExcerpt } from "../src/case-semantic-check.js";

// Defects found by the MATCH-250 test (250 thesis-document pairs on real SAOS, EUREKA, UODO,
// ETPC and ELI texts): documents never checked, the full text replaced by a hit-list line,
// a judgment cut to its first pages, the court's assessment not reaching the judge.
const wrap = (source: string, result: Record<string, unknown>) => JSON.stringify({ source, status: "FOUND", result });
const filler = (seed: string, n: number) =>
  Array.from({ length: n }, (_, i) => `Pełnomocnik strony złożył pismo procesowe w terminie wraz z odpisem dla strony przeciwnej [${seed}-${i}].`).join(" ");

describe("cited documents recognized", () => {
  it.each([
    ["UODO DKE", "Decyzja Prezesa UODO z 2021-08-24, DKE.523.18.2021.\n\nPrezes UODO uznał, że brak zgłoszenia naruszenia narusza art. 33 RODO.", "DKE.523.18.2021"],
    ["UODO ZSOŚS", "Decyzja Prezesa UODO, ZSOŚS.440.58.2018.\n\nPrezes UODO uznał, że dane przetwarzano bez podstawy.", "ZSOŚS.440.58.2018"],
    ["SN Izba Dyscyplinarna", "Wyrok z 2016-05-17, sygn. SNO 11/16.\n\nSąd Najwyższy przyjął, że sędzia nie dopuścił się deliktu.", "SNO 11/16"],
    ["SN Izba Wojskowa", "Postanowienie z 2016-05-24, sygn. WZ 5/16.\n\nSąd Najwyższy przyjął, że kasacja była niedopuszczalna.", "WZ 5/16"]
  ])("%s", (_name, answer, signature) => {
    const sources = [wrap("x", { identyfikator: signature, tresc: `${signature} ${filler("a", 5)}` })];
    expect(citedDocuments(answer, sources).map((document) => document.signature)).toContain(signature);
  });
});

describe("the text the judge reads", () => {
  it("the fetched document, not its line on a hit list", () => {
    const list = JSON.stringify({ status: "AMBIGUOUS", kandydaci: [
      { identyfikator: "I ACa 12/25", tytul_lub_nazwa: "kredyt frankowy" },
      { identyfikator: "II Ca 5/26", tytul_lub_nazwa: "zachowek po ojcu" }
    ] });
    const full = wrap("saos", { sygnatura: "I ACa 12/25", tresc: `Sygn. akt I ACa 12/25. ${filler("b", 10)} Sąd Apelacyjny zważył, że klauzula przeliczeniowa jest abuzywna.` });
    const [document] = citedDocuments("Wyrok z 2025-03-01, sygn. I ACa 12/25.\n\nSąd przyjął, że klauzula jest abuzywna.", [list, full]);
    expect(document!.text).toContain("klauzula przeliczeniowa jest abuzywna");
    expect(document!.text).not.toContain("zachowek po ojcu");
  });

  it("an interpretation fetched after a hit list: no other hit's subject", () => {
    const list = JSON.stringify({ status: "AMBIGUOUS", kandydaci: [
      { identyfikator: "0112-KDIL3.4012.362.2025.2.AK", tytul_lub_nazwa: "VAT przy wycofaniu nieruchomości" },
      { identyfikator: "0115-KDIT3.4011.732.2026.1.RS", tytul_lub_nazwa: "najem prywatny ryczałtem" }
    ] });
    const full = wrap("eureka", { identyfikator: "0112-KDIL3.4012.362.2025.2.AK", tresc: `Interpretacja indywidualna 0112-KDIL3.4012.362.2025.2.AK. ${filler("c", 6)}` });
    const [document] = citedDocuments("Interpretacja indywidualna, znak 0112-KDIL3.4012.362.2025.2.AK.\n\nOrgan stwierdził, że VAT nalicza się.", [list, full]);
    expect(document!.text).not.toContain("najem prywatny ryczałtem");
  });

  it("a judgment citing many other cases stays whole", () => {
    const others = "Por. wyroki SN: I CSK 1/20, II CSK 2/21, III CZP 3/22, IV CSK 4/23.";
    const text = `Sygn. akt V CSK 692/15. ${others} ${filler("d", 60)} Sąd Najwyższy zważył, że roszczenie o zachowek nie uległo przedawnieniu.`;
    const [document] = citedDocuments("Postanowienie z 2016-05-20, sygn. V CSK 692/15.\n\nSN przyjął, że roszczenie nie uległo przedawnieniu.", [wrap("saos", { sygnatura: "V CSK 692/15", tresc: text })]);
    expect(document!.text).toContain("nie uległo przedawnieniu");
  });

  it("the court's assessment reaches the judge, the portal's chrome does not", () => {
    const text = [
      "Your browser is ancient! Upgrade to a different browser",
      "Serwis używa plików cookies.",
      "WYROK. Sygn. akt II Ca 1/26.",
      filler("e", 40),
      "Apelujący podnosił, że umowa była nieważna.",
      filler("f", 40),
      "Sąd Okręgowy zważył, co następuje: apelacja nie zasługiwała na uwzględnienie, umowa była ważna.",
      filler("g", 40)
    ].join("\n");
    const excerpt = relevantExcerpt(text, "Czy umowa była nieważna?", "Sąd uznał umowę za nieważną.");
    expect(excerpt).toContain("apelacja nie zasługiwała na uwzględnienie");
    expect(excerpt).not.toMatch(/browser is ancient|cookies/u);
    expect(excerpt.length).toBeLessThanOrEqual(8_000);
  });
});

describe("the thesis and the question's criteria are defined before the verdict", async () => {
  const { parseSemanticVerdicts, semanticCorrectionPrompt, SEMANTIC_JUDGE_SYSTEM } = await import("../src/case-semantic-check.js");
  const { judgedQuestion } = await import("../src/session-executor.js");
  const document = { signature: "I ACa 12/25", kind: "case" as const, claim: "", text: "Sąd Apelacyjny zważył, że klauzula przeliczeniowa jest abuzywna i nie wiąże konsumenta." };

  it("the judge is told to state criteria and thesis; the verdict keeps them and the correction names them", () => {
    expect(SEMANTIC_JUDGE_SYSTEM).toMatch(/criteria/u);
    expect(SEMANTIC_JUDGE_SYSTEM).toMatch(/thesis/u);
    const output = JSON.stringify({ verdicts: [{ signature: "I ACa 12/25", criteria: "klauzule w kredycie CHF; sąd apelacyjny", thesis: "Sąd uznał klauzulę za wiążącą konsumenta.", topic: "MATCH", claim: "UNSUPPORTED", reason: "Sąd orzekł odwrotnie.", quote: "klauzula przeliczeniowa jest abuzywna" }] });
    const check = parseSemanticVerdicts(output, [document]);
    expect(check.verdicts[0]).toMatchObject({ thesis: "Sąd uznał klauzulę za wiążącą konsumenta.", criteria: "klauzule w kredycie CHF; sąd apelacyjny" });
    expect(semanticCorrectionPrompt(check.verdicts)).toContain("Oceniona teza odpowiedzi: „Sąd uznał klauzulę za wiążącą konsumenta.”");
  });

  it("a verdict without them (older judge output) still counts", () => {
    const output = JSON.stringify({ verdicts: [{ signature: "I ACa 12/25", topic: "MATCH", claim: "SUPPORTED", reason: "Zgodne.", quote: "klauzula przeliczeniowa jest abuzywna" }] });
    expect(parseSemanticVerdicts(output, [document]).verdicts).toHaveLength(1);
  });

  it("a statute verdict under the judge's longer signature (\"art. 16 UDIP\") names the cited \"art. 16\"; a shared prefix names neither", () => {
    const statute = { signature: "art. 16", kind: "statute" as const, claim: "", text: "Art. 16. 1. Odmowa udostępnienia informacji publicznej następuje w drodze decyzji." };
    const verdict = (signature: string) => JSON.stringify({ verdicts: [{ signature, topic: "MATCH", claim: "SUPPORTED", reason: "Zgodne.", quote: "Odmowa udostępnienia informacji publicznej" }] });
    expect(parseSemanticVerdicts(verdict("art. 16 UDIP"), [statute]).verdicts[0]?.signature).toBe("art. 16");
    expect(parseSemanticVerdicts(verdict("art. 16a UDIP"), [statute]).verdicts).toHaveLength(0);
    expect(parseSemanticVerdicts(verdict("art. 16 UDIP"), [statute, { ...statute, signature: "art. 16 ust. 1" }]).verdicts[0]?.signature).toBe("art. 16");
    const twins = [statute, { ...statute, signature: "Art. 16" }];
    expect(parseSemanticVerdicts(verdict("art. 16 KPA"), twins).verdicts).toHaveLength(0);
  });

  it("a short follow-up keeps the criteria of the earlier messages; a long message is taken whole", () => {
    const thread = "Użytkownik: Znajdź wyrok sądu apelacyjnego z 2025 r. o klauzulach przeliczeniowych w kredytach CHF\n\nAsystent: Znalazłem I ACa 12/25.\n\nUżytkownik: a inny?";
    const question = judgedQuestion(thread);
    expect(question.startsWith("a inny?")).toBe(true);
    expect(question).toContain("sądu apelacyjnego z 2025 r. o klauzulach przeliczeniowych");
    const long = `Użytkownik: ${"Opis stanu faktycznego sprawy kredytowej. ".repeat(10)}Czy sąd apelacyjny uznał klauzulę za abuzywną?`;
    expect(judgedQuestion(long)).toContain("Opis stanu faktycznego sprawy kredytowej.");
    expect(judgedQuestion(long)).toContain("Czy sąd apelacyjny uznał klauzulę za abuzywną?");
  });
});
