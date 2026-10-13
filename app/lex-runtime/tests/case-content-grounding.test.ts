import { describe, expect, it } from "vitest";
import { caseContentFindings } from "../src/case-content-grounding.js";

// Wersja 0.1.27, tura "ok, robisz to.": prawdziwa sygnatura, treść przypisana z pytania.
const TOPIC = [
  "Znajdź wyrok z sądu najwyższego dotyczący użycia AI i jego halucynacji przez prawnika",
  "prosiłem o inny wyrok z polski dotyczący AI użytego przez prawnika, wyrok wydany przez kogoś innego jak sąd najwyższy",
  "ok, robisz to."
].join("\n");
const CBOSA = JSON.stringify({
  sygnatura: "II SAB/Po 175/26",
  sad: "Wojewódzki Sąd Administracyjny w Poznaniu",
  data: "2026-09-16",
  hasla: "Informacja publiczna; Bezczynność organu",
  tresc: "Sprawa ze skargi na bezczynność Burmistrza Miasta i Gminy w przedmiocie udostępnienia informacji publicznej. Sąd zobowiązał organ do rozpoznania wniosku."
});
const FABRICATED = [
  "Znalazłem polskie orzeczenie innego sądu:",
  "",
  "WSA w Poznaniu, wyrok z 16 września 2026 r., sygn. II SAB/Po 175/26 — 🟨 [KOTWICA-URZĘDOWA: snapshot CBOSA, 13.10.2026]",
  "",
  "Sąd uznał, że pisma skarżącej mogły być przygotowane z pomocą AI i nieweryfikowane. Wskazał też, że powołane przez nią orzeczenia NSA nie istniały — był to przykład tzw. „halucynacji AI”."
].join("\n");

describe("case content grounding", () => {
  it("flags the topic given to a judgment whose fetched text does not have it", () => {
    expect(caseContentFindings(FABRICATED, [CBOSA], TOPIC)).toEqual([{ signature: "II SAB/Po 175/26", missing: ["AI", "halucynacji"] }]);
  });

  it("passes a description taken from the fetched text", () => {
    const honest = "WSA w Poznaniu, sygn. II SAB/Po 175/26, dotyczy bezczynności burmistrza w udostępnieniu informacji publicznej.";
    expect(caseContentFindings(honest, [CBOSA], TOPIC)).toEqual([]);
  });

  it("does not count a negated mention (the answer says the judgment is not about AI)", () => {
    const corrected = "Sygn. II SAB/Po 175/26 nie dotyczy AI ani halucynacji; to sprawa bezczynności w udostępnieniu informacji publicznej.";
    expect(caseContentFindings(corrected, [CBOSA], TOPIC)).toEqual([]);
  });

  it("checks nothing for a signature no source returned", () => {
    expect(caseContentFindings(FABRICATED.replace("II SAB/Po 175/26", "II SA/Wa 1/26"), [CBOSA], TOPIC)).toEqual([]);
  });

  it("passes when the fetched judgment really is about the topic (SN signature form)", () => {
    const sn = "Uchwała SN sygn. I KZP 3/24: sąd orzekał o skutkach powołania sędziów (neosędziów) przez KRS.";
    const source = "{\"sygnatura\":\"I KZP 3/24\",\"tresc\":\"... udział w składzie neosędziów powołanych na wniosek KRS ...\"}";
    expect(caseContentFindings(sn, [source], "na SN wyszukaj orzeczenia dotyczącego neosędziów")).toEqual([]);
  });
});

describe("case content grounding: quoted thesis", () => {
  const SN = "{\"sygnatura\":\"III CZP 25/11\",\"tresc\":\"Roszczenie o zapłatę ceny przedawnia się z upływem dwóch lat, także gdy sprzedawca jest przedsiębiorcą.\"}";
  it("passes a quotation that is in the fetched text", () => {
    const answer = "SN, sygn. III CZP 25/11: „Roszczenie o zapłatę ceny przedawnia się z upływem dwóch lat”.";
    expect(caseContentFindings(answer, [SN], "orzecznictwo o przedawnieniu ceny")).toEqual([]);
  });
  it("flags a thesis quoted as the court's words but absent from its text", () => {
    const answer = "SN, sygn. III CZP 25/11: „roszczenie o zapłatę ceny przedawnia się z upływem sześciu lat od wymagalności”.";
    expect(caseContentFindings(answer, [SN], "orzecznictwo o przedawnieniu ceny")[0]?.missing[0]).toMatch(/^cytat „roszczenie o zapłatę ceny przedawnia się z upływem sześciu lat/u);
  });
});
