import { describe, expect, it } from "vitest";
import { contractGraph, contractGraphPrompt, contractUnits } from "../src/contract-graph.js";

// The structure of the agreement of the user report (2026-11-06), without its data.
const agreement = [
  "Porozumienie stron o rozwiązaniu umowy o pracę",
  "zawarte w dniu 9 października 2024 r. pomiędzy:",
  "Spółką X sp. z o.o., zwaną dalej „Pracodawcą”,",
  "a Panem Y, zwanym dalej „Pracownikiem”.",
  "1. Łącząca Strony umowa o pracę zostaje rozwiązana z dniem 31 października 2024 r.",
  "2. W okresie od dnia 9 października 2024 r. do dnia 31 października 2024 r. Pracodawca zwalnia",
  "Pracownika z obowiązku świadczenia pracy z zachowaniem prawa do wynagrodzenia.",
  "3. Porozumienie stanowi całkowite porozumienie pomiędzy Stronami.",
  "4. Strony wspólnie uzgadniają, że zobowiązują się do zachowania poufności.",
  "5. Za każde nieuprawnione naruszenie każda ze stron zobowiązana będzie do zapłaty kary w kwocie",
  "5.000,00 zł",
  "6. Pracownik zobowiązuje się zachować w ścisłej tajemnicy wszelkie informacje (zwane dalej „Informacjami”).",
  "7. Obowiązek określony w ust. 6 odnosi się do wszelkich informacji.",
  "8. Pracownik oświadcza, że ponosi odpowiedzialność za szkodę wywołaną ujawnieniem Informacji.",
  "9. W sytuacji powzięcia informacji przez Pracodawcę o naruszeniu zapisów nr 6, 7 i 8, Pracownik zobowiązany będzie do zapłaty kary w kwocie 20.000,00 zł za każde naruszenie.",
  "10. Na mocy niniejszego porozumienia Pracownik zrzeka się wszystkich roszczeń przeszłych i przyszłych względem Pracodawcy.",
  "11. Pracownik po ustaniu stosunku pracy zobowiązuje się do nienaruszania zasad uczciwej konkurencji.",
  "12.W sytuacji powzięcia informacji przez Pracodawcę o naruszeniu zapisu nr 11, Pracownik zobowiązany będzie do zapłaty kary w kwocie 20.000,00 zł za każde naruszenie.",
  "13. Porozumienie sporządzono w dwóch egzemplarzach."
].join("\n");

const lease = [
  "UMOWA NAJMU",
  "zawarta w dniu 1 lutego 2024 r. pomiędzy A, zwanym dalej „Wynajmującym”, a B, zwanym dalej „Najemcą”.",
  "§ 1 Wynajmujący oddaje Najemcy lokal do używania.",
  "§ 2 Najemca zobowiązuje się płacić czynsz do 10. dnia miesiąca.",
  "§ 3 Wynajmujący zobowiązuje się dokonywać napraw obciążających wynajmującego w terminie 14 dni.",
  "§ 4 Za opóźnienie w zapłacie czynszu, o którym mowa w § 2, Najemca zapłaci karę umowną w wysokości 500 zł za każdy dzień.",
  "§ 5 Po zakończeniu najmu Wynajmujący wypłaci Najemcy zwrot kaucji.",
  "§ 6 Najemca zrzeka się wszelkich roszczeń wobec Wynajmującego."
].join("\n");

describe("the relation graph of a delivered agreement (user report 2026-11-06)", () => {
  it("numbered points in order; an amount at the start of a line is no point", () => {
    expect(contractUnits(agreement).map((unit) => unit.unit)).toEqual(Array.from({ length: 13 }, (_, index) => `pkt ${index + 1}`));
  });

  it("pkt 10 cancels the employee's rights of pkt 2 and pkt 5; pkt 5 and pkt 9 sanction the same confidentiality", () => {
    const graph = contractGraph(agreement)!;
    expect(graph.parties).toEqual(["Pracodawca", "Pracownik"]);
    const edges = graph.edges.map((edge) => `${edge.from} ${edge.relation} ${edge.to}`);
    expect(edges).toEqual(expect.arrayContaining([
      "pkt 10 ZNOSI PRAWO pkt 2",
      "pkt 10 ZNOSI PRAWO pkt 5",
      "pkt 5 PODWÓJNA SANKCJA pkt 9",
      "pkt 9 SANKCJONUJE pkt 6",
      "pkt 9 SANKCJONUJE pkt 8",
      "pkt 12 SANKCJONUJE pkt 11",
      "pkt 7 ODSYŁA pkt 6"
    ]));
    expect(edges.some((edge) => edge.includes("PODWÓJNA SANKCJA pkt 12"))).toBe(false);
    const prompt = contractGraphPrompt(graph);
    expect(prompt).toContain("Bilans — Pracownik:");
    expect(prompt).not.toContain("Informacjami:");
  });

  it("any contract with §: the lessee's waiver against the deposit, the lessor's duty without a sanction", () => {
    const graph = contractGraph(lease)!;
    expect(graph.parties).toEqual(["Wynajmujący", "Najemca"]);
    const edges = graph.edges.map((edge) => `${edge.from} ${edge.relation} ${edge.to}`);
    expect(edges).toEqual(expect.arrayContaining(["§ 6 ZNOSI PRAWO § 5", "§ 4 SANKCJONUJE § 2"]));
    expect(graph.edges.find((edge) => edge.relation === "ASYMETRIA")?.from).toContain("§ 3");
  });

  it("no graph without points or parties", () => {
    expect(contractGraph("Zwykły list bez punktów.")).toBeNull();
  });
});
