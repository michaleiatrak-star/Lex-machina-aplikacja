import { describe, expect, it } from "vitest";
import { courtAttributionFindings } from "../src/case-content-grounding.js";
import { caseSubject, passageRoles, roleExcerpt } from "../src/case-semantic-check.js";

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
