import { describe, expect, it } from "vitest";
import { criminalDocument, criminalMatter } from "../src/matter-signals.js";

// Próba generalna 0.1.45: sprawy karne bez słów "przestępstwo", "oskarżony", "prokurator".
describe("criminal matters told in everyday words and criminal documents", () => {
  it.each([
    "policja zatrzymala mi brata wczoraj w nocy, nie wiemy za co",
    "Brat ma się stawić do więzienia na 10 miesięcy. Czy można odroczyć?",
    "Spowodowałem wypadek, żona miała złamaną rękę. Czy mnie oskarżą?",
    "Sąd dał mi zakaz prowadzenia na 3 lata, a złapali mnie na kontroli",
    "Spółka nie wpłaciła VAT, prezes pyta o czynny żal",
    "Ojciec dziecka nie płaci alimentów, czy mogę go zgłosić na policję?",
    "Wyrok w mojej sprawie karnej ogłoszono 19.10.2026",
    "Co zmieniła reforma KPK z 1 lipca 2015 r.?"
  ])("%s", (text) => {
    expect(criminalMatter(text)).toBe(true);
  });

  it("keeps a traffic stop and unpaid maintenance alone outside criminal law", () => {
    expect(criminalMatter("Policja zatrzymała mnie do kontroli, jakie uprawnienia ma policjant?")).toBe(false);
    expect(criminalMatter("Były mąż nie płaci alimentów na córkę od roku, co dalej?")).toBe(false);
  });

  it("reads a criminal judgment, not a contract mentioning a fine", () => {
    expect(criminalDocument("WYROK ... oskarżonego o to, że ... tj. o czyn z art. 278 § 1 k.k.")).toBe(true);
    expect(criminalDocument("Umowa najmu. § 5. Najemca zapłaci karę umowną.")).toBe(false);
  });
});
