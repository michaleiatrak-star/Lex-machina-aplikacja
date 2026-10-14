import { describe, expect, it } from "vitest";
import { courtAttributionFindings } from "../src/case-content-grounding.js";
import { AUTHORITY_RULE, caseSubject, passageRoles, roleExcerpt } from "../src/case-semantic-check.js";

describe("court named for a judgment against its signature", () => {
  it.each([
    ["NSA w wyroku II SA/Wa 812/26 uznał, że …", "NSA", "WSA"],
    ["Sąd Najwyższy (I OSK 1203/24) przyjął …", "SN", "NSA"],
    ["WSA w Poznaniu, sygn. I ACa 230/24: …", "WSA", "SA"]
  ])("%s", (answer, named, actual) => {
    expect(courtAttributionFindings(answer)).toMatchObject([{ named, actual }]);
  });

  it.each([
    "WSA w Warszawie, sygn. II SA/Wa 812/26: …",
    "To nie jest orzeczenie NSA: wyrok WSA, sygn. II SA/Wa 812/26 …",
    "Uchwała SN III CZP 25/11 dotyczy …",
    "Sygn. II SA/Wa 812/26 dotyczy bezczynności."
  ])("no finding: %s", (answer) => {
    expect(courtAttributionFindings(answer)).toEqual([]);
  });
});

describe("case subject and passage roles", () => {
  it("finds what the case is about and pins it at the top", () => {
    const text = "Wyrok WSA w Poznaniu, sygn. II SAB/Po 175/26\nSprawa ze skargi na bezczynność Burmistrza Miasta i Gminy w przedmiocie udostępnienia informacji publicznej.\nSentencja\nZobowiązuje organ do rozpoznania wniosku.";
    expect(caseSubject(text)).toContain("w przedmiocie udostępnienia informacji publicznej");
    expect(roleExcerpt(text, "AI", "AI").startsWith("[OKREŚLENIE SPRAWY] Sprawa ze skargi")).toBe(true);
    expect(caseSubject('{"hasla":"x"}\nHasła tematyczne: Informacja publiczna; Bezczynność organu')).toBe("Hasła tematyczne: Informacja publiczna; Bezczynność organu");
    expect(caseSubject("Uzasadnienie bez metryki.")).toBeNull();
  });

  it("labels the decision, a party's argument and a dissent", () => {
    const roles = passageRoles([
      "Sentencja", "Oddala skargę kasacyjną.", "Uzasadnienie",
      "W skardze kasacyjnej strona podniosła, że doręczenie było bezskuteczne.",
      "Naczelny Sąd Administracyjny zważył, co następuje. Zarzut nie jest zasadny.",
      "Zdanie odrębne", "Sędzia uważa, że doręczenie było bezskuteczne.",
      "Odwołujący podnosił, że zamawiający nie miał obowiązku."
    ].join("\n"));
    const role = (start: string) => roles.find((item) => item.text.startsWith(start))?.role;
    expect(role("Oddala")).toBe("ROZSTRZYGNIĘCIE");
    expect(role("W skardze kasacyjnej")).toBe("STANOWISKO STRONY");
    expect(role("Zarzut nie jest zasadny")).toBe("OCENA ORGANU ORZEKAJĄCEGO");
    expect(role("Sędzia uważa")).toBe("ZDANIE ODRĘBNE");
    expect(role("Odwołujący")).toBe("ZDANIE ODRĘBNE");
  });

  it("an interpretation: the organ's verdict on the applicant's view is the decision", () => {
    const roles = passageRoles("Stanowisko, które przedstawił Pan we wniosku dotyczącym sprawy: VAT, jest nieprawidłowe.\nStanowisko Wnioskodawcy: Wnioskodawca uważa, że przysługuje pełne odliczenie.\nOcena stanowiska: przysługuje odliczenie 50%.");
    expect(roles.map((item) => item.role)).toEqual(["ROZSTRZYGNIĘCIE", "STANOWISKO STRONY", "OCENA ORGANU ORZEKAJĄCEGO"]);
  });
});

// Mislabels found on real SAOS, KIO, TK and UODO texts (MATCH-250, 2026-10-14).
describe("who speaks: the authority answering a ground is not the party", () => {
  const role = (roles: Array<{ role: string; text: string }>, start: string) => roles.find((item) => item.text.startsWith(start))?.role;

  it("a ground recalled mid-reasoning labels its paragraph only; the answer is the authority's", () => {
    const roles = passageRoles([
      "Krajowa Izba Odwoławcza zważyła, co następuje:",
      "Skarżący podniósł, że tryb był niedopuszczalny. Dalej powołał się na dyrektywę.",
      "Przyjmując układ argumentacji podniesionej w odwołaniu Izba wskazuje, że tryb był dopuszczalny.",
      "Zarzut podniesiony w kasacji ocenić należy jako zasadny.",
      "Zamawiający oświadczył, że uwzględnia zarzuty.",
      "Powyższe stanowisko jest nieuzasadnione."
    ].join("\n"));
    expect(role(roles, "Skarżący")).toBe("STANOWISKO STRONY");
    expect(role(roles, "Dalej powołał")).toBe("STANOWISKO STRONY");
    expect(role(roles, "Przyjmując układ")).toBe("OCENA ORGANU ORZEKAJĄCEGO");
    expect(role(roles, "Zarzut podniesiony")).toBe("OCENA ORGANU ORZEKAJĄCEGO");
    expect(role(roles, "Zamawiający")).toBe("STANOWISKO STRONY");
    expect(role(roles, "Powyższe")).toBe("OCENA ORGANU ORZEKAJĄCEGO");
  });

  it("the reviewed court's view in a Supreme Court judgment is not the holding, unless the Court endorses it", () => {
    const roles = passageRoles([
      "Sąd Najwyższy w składzie:", "oddala kasację.", "UZASADNIENIE",
      "Sąd Okręgowy uznał, że brak odesłania wyklucza zwrot kosztów.",
      "Sąd Najwyższy zważył, co następuje:",
      "Z takim poglądem nie sposób się zgodzić. Nakazuje on stosować odpowiednio przepisy o kosztach.",
      "Sąd Okręgowy trafnie uznał jednak, że wniosek był spóźniony."
    ].join("\n"));
    expect(role(roles, "oddala")).toBe("ROZSTRZYGNIĘCIE");
    expect(role(roles, "Sąd Okręgowy uznał")).toBe("OCENA SĄDU NIŻSZEJ INSTANCJI");
    expect(role(roles, "Nakazuje on")).toBe("OCENA ORGANU ORZEKAJĄCEGO");
    expect(role(roles, "Sąd Okręgowy trafnie")).toBe("OCENA ORGANU ORZEKAJĄCEGO");
  });

  it("the authority adopting or rejecting a party's view speaks for itself; a party describing a court does not", () => {
    const authority = [
      "Sąd przychylił się do stanowiska powoda, że umowa była nieważna.",
      "Słusznie skarżący podnosi, że doręczenie było wadliwe.",
      "Skarżący słusznie zarzuca, że Sąd pominął dowód.",
      "W skardze kasacyjnej trafnie podniesiono naruszenie art. 5 k.c.",
      "Należy zgodzić się z apelującym, że kara jest rażąco surowa.",
      "Rację ma skarżący, wskazując na brak uzasadnienia.",
      "Niesłusznie pozwany twierdzi, że roszczenie jest przedawnione.",
      "Izba nie podzieliła argumentacji odwołującego.",
      "Stanowisko powoda zasługuje na aprobatę.",
      "Zarzuty apelacji okazały się zasadne."
    ];
    const party = [
      "Skarżący zarzucił, że Sąd Okręgowy nie uwzględnił wniosku dowodowego.",
      "W apelacji pozwany podniósł, że Sąd nie podzielił jego stanowiska.",
      "Zdaniem skarżącego Sąd bezzasadnie oddalił wniosek.",
      "Pozwany wskazał, że Sąd I instancji trafnie ocenił zeznania."
    ];
    // Paragraphs of their own, without the "zważył" heading: the label comes from the sentence.
    const roles = passageRoles([...authority, ...party].join("\n\n"));
    expect(roles.slice(0, authority.length).map((item) => item.role)).toEqual(authority.map(() => "OCENA ORGANU ORZEKAJĄCEGO"));
    expect(roles.slice(authority.length).map((item) => item.role)).toEqual(party.map(() => "STANOWISKO STRONY"));
    expect(AUTHORITY_RULE).toMatch(/przychylił się do stanowiska/u);
  });

  it("participants of a constitutional review and the referring court speak for themselves", () => {
    const roles = passageRoles([
      "Trybunał Konstytucyjny zważył, co następuje:",
      "Prokurator Generalny w piśmie z 31 października 2013 r. zajął stanowisko, że przepis jest zgodny z Konstytucją.",
      "Pytający sąd stwierdził, że właściciel nie ma możliwości zakwestionowania decyzji."
    ].join("\n"));
    expect(role(roles, "Prokurator Generalny")).toBe("STANOWISKO STRONY");
    expect(role(roles, "Pytający sąd")).toBe("STANOWISKO STRONY");
  });

  it("broken lines, abbreviations, initials, the appeal form and quotations keep a sentence whole", () => {
    const roles = passageRoles([
      "W pozwie z 13 czerwca 2023 r. S. G. wniósł o zasądzenie na podstawie art.",
      "471 k.c. kwoty 100 zł.",
      "Wniosek", "O zmianę zaskarżonego wyroku i uniewinnienie oskarżonego.",
      "☒ niezasadny", "Zwięźle o powodach uznania wniosku za niezasadny.",
      "Administrator wyjaśnił: „Zostałem poinformowany o formalnościach.",
      "Wobec powyższego uważam, że je dopełniono”."
    ].join("\n"));
    expect(roles.find((item) => item.text.includes("471 k.c."))?.text.startsWith("W pozwie")).toBe(true);
    expect(role(roles, "W pozwie")).toBe("STANOWISKO STRONY");
    expect(role(roles, "O zmianę")).toBe("STANOWISKO STRONY");
    expect(role(roles, "Zwięźle")).toBe("OCENA ORGANU ORZEKAJĄCEGO");
    expect(role(roles, "Wobec powyższego uważam")).toBe("STANOWISKO STRONY");
  });
});
