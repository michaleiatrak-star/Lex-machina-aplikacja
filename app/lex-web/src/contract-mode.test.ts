import { describe, expect, it } from "vitest";
import { automaticContractMode, suggestedContractMode } from "./contract-mode.js";

describe("contract mode suggested from the request", () => {
  it.each([
    ["Wykonaj analize prawną dokumentu, wskaż wadliwe zapisy i te, które niosą ryzyko dla autora. Dla kogo ta umowa jest korzystna?", "ANALYSIS"],
    ["Przeanalizuj umowę najmu przed podpisaniem", "ANALYSIS"],
    ["Czy mogę podpisać tę umowę?", "ANALYSIS"],
    ["Zredaguj paragraf 5 tej umowy", "REDACTION"],
    ["Popraw zapisy o karach umownych", "REDACTION"],
    ["Napisz umowę o dzieło dla grafika", "DRAFT"],
    ["Przygotuj projekt umowy najmu okazjonalnego", "DRAFT"],
    ["Wygeneruj profesjonale pismo dotyczące powierzenia pracy rekrutacji pracowników przez rekrutera na rzecz firmy Nescafe.", "DRAFT"],
    ["Przygotuj umowę kupna sprzedaży samochodu", "DRAFT"],
    ["Sporządź porozumienie o rozwiązaniu umowy o pracę", "DRAFT"],
    ["Przygotuj aneks do umowy o pracę", "SUPPLEMENT"],
    ["Dodaj klauzulę poufności do umowy", "SUPPLEMENT"],
    // Correctness and lawfulness of an existing document: analysis (TRYB 1), not redaction.
    ["Sprawdź poprawność tej umowy zlecenia", "ANALYSIS"],
    ["Zweryfikuj poprawność regulaminu sklepu", "ANALYSIS"],
    ["Czy ten aneks jest zgodny z prawem?", "ANALYSIS"],
    // Corrections of an existing document: redaction (TRYB 2).
    ["Skoryguj zapisy umowy o karach umownych", "REDACTION"],
    ["Napraw niezgodne z prawem zapisy w regulaminie", "REDACTION"],
    ["Dostosuj umowę do wymogów RODO", "REDACTION"],
    // The skill's generators: a policy, a resolution.
    ["Napisz politykę prywatności dla mojej strony", "DRAFT"],
    ["Przygotuj uchwałę zgromadzenia wspólników o podziale zysku", "DRAFT"]
  ])("%s -> %s", (text, mode) => {
    expect(suggestedContractMode(text)).toBe(mode);
  });

  it("sets the analysis mode without asking only for an unambiguous analysis request", () => {
    expect(
      automaticContractMode("Wykonaj analize prawną dokumentu, wskaż wadliwe zapisy i te, które niosą ryzyko dla autora. Czy chroni skutecznie pracodawcę?")
    ).toBe("ANALYSIS");
    expect(automaticContractMode("Przeanalizuj umowę najmu przed podpisaniem")).toBe("ANALYSIS");
    expect(automaticContractMode("Zredaguj paragraf 5 tej umowy")).toBeNull();
    expect(automaticContractMode("Napisz umowę o dzieło dla grafika")).toBeNull();
    expect(automaticContractMode("Co z tą umową?")).toBeNull();
    expect(automaticContractMode("Sprawdź poprawność tej umowy zlecenia")).toBe("ANALYSIS");
    expect(automaticContractMode("Zweryfikuj poprawność regulaminu sklepu")).toBe("ANALYSIS");
    expect(automaticContractMode("Popraw błędy w tej umowie")).toBeNull();
  });
});
