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
    ["Przygotuj aneks do umowy o pracę", "SUPPLEMENT"],
    ["Dodaj klauzulę poufności do umowy", "SUPPLEMENT"]
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
  });
});
