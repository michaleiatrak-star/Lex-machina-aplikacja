import path from "node:path";
import { describe, expect, it } from "vitest";
import { TurnRouter } from "../src/routing-benchmark.js";
import { decideTask, type DeliveredMaterial } from "../src/task-routing.js";
import { rankDomains, foreignElement } from "../src/domain-module-map.js";
import { registryFlashRoutes } from "../src/turn-gate.js";

// Live series r6 (Sonnet, synthetic construction-works case, 2026-11-27).
const router = new TurnRouter(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana")) as unknown as {
  routes: Parameters<typeof decideTask>[0]; matrix: Parameters<typeof decideTask>[1]; redaction: Parameters<typeof decideTask>[4]; simple: Parameters<typeof decideTask>[5];
  registry: Parameters<typeof rankDomains>[0];
};
const files: DeliveredMaterial[] = [
  { category: "PISMO_PROCESOWE", evidence: false, label: "pozew" },
  { category: "PISMO_PROCESOWE", evidence: false, label: "odpowiedź na pozew" },
  { category: "PROTOKOL", evidence: true, label: "protokół przesłuchania / rozprawy (zeznania)" }
];
const skill = (q: string, materials: DeliveredMaterial[]) => decideTask(router.routes, router.matrix, q, materials, router.redaction, router.simple)?.primary ?? null;

describe("executive skills over a case's files", () => {
  it.each([
    ["Przeanalizuj materiał dowodowy w tej sprawie: które dowody wspierają powoda, a które pozwanego, i jakie są luki", "analizator-dowodow-v3"],
    ["Przygotuj pytania do świadka Adama Próbnego na kolejną rozprawę", "przesluchanie-swiadkow-v2-min90"],
    ["Zrób chronologię zdarzeń w tej sprawie", "chronologia-sprawy-v1"],
    ["Przygotuj raport dla klienta (pozwanego) o stanie sprawy i szansach", "raport-klienta-v1"],
    ["Napisz wniosek o odroczenie rozprawy z powodu choroby pełnomocnika", "pisma-proste-v2"]
  ])("%s", (question, expected) => {
    expect(skill(question, files)).toBe(expected);
    expect(skill(question, [])).toBe(expected);
  });

  it("a pleading with its files still goes to the pleading pipeline", () => {
    expect(skill("Napisz apelację od tego wyroku", [{ category: "ORZECZENIE", evidence: false, label: "wyrok" }])).toBe("pisma-procesowe-v3");
  });
});

describe("the domain of a construction-works claim", () => {
  const text = [
    "Sygn. akt I C 1234/25 PROTOKÓŁ ROZPRAWY. Świadek, kierownik budowy, zeznał: protokół odbioru podpisałem, bo pan [PII:PERSON:0002] powiedział mi telefonicznie, żebym odebrał roboty, bo on jest za granicą.",
    "ODPOWIEDŹ NA POZEW. Pozwany przyznaje zawarcie umowy, ale zaprzecza, aby roboty wykonano należycie. Protokół podpisał kierownik budowy. Pozwany złożył oświadczenie o obniżeniu wynagrodzenia o 30 000 zł z tytułu rękojmi. Wnioski dowodowe: przesłuchanie świadka.",
    "POZEW O ZAPŁATĘ. Wnoszę o zasądzenie 48 000 zł z odsetkami ustawowymi. Strony zawarły umowę o roboty budowlane. Powód wystawił fakturę VAT. Pozwany nie zapłacił."
  ].join("\n");
  it("is civil law, not labour law or a foreign element", () => {
    const domains = rankDomains(router.registry, registryFlashRoutes(router.registry), text);
    expect(domains[0]?.skill.startsWith("dr-02-")).toBe(true);
    expect(domains.some((domain) => domain.skill.startsWith("dr-14-"))).toBe(false);
    expect(domains.find((domain) => domain.skill.startsWith("dr-04-"))?.strong ?? false).toBe(false);
  });
  it("someone abroad is a fact; a matter abroad is a foreign element", () => {
    expect(foreignElement("bo on jest za granicą")).toBe(false);
    expect(foreignElement("pracuję za granicą u niemieckiego pracodawcy")).toBe(true);
  });
  it("labour words stay labour law with an employment", () => {
    const domains = rankDomains(router.registry, registryFlashRoutes(router.registry), "Pracodawca obniżył mi wynagrodzenie bez wypowiedzenia zmieniającego");
    expect(domains[0]?.skill.startsWith("dr-04-")).toBe(true);
  });
});

describe("series r7 (2026-11-27): files of a civil claim", () => {
  const rank = (text: string) => rankDomains(router.registry, registryFlashRoutes(router.registry), text);
  it("the perjury caution of a hearing record names no criminal matter", () => {
    const domains = rank("PROTOKÓŁ ROZPRAWY. Świadek, kierownik budowy, pouczony o odpowiedzialności karnej z art. 233 k.k., zeznał: protokół odbioru podpisałem.");
    expect(domains.some((domain) => domain.skill.startsWith("dr-03-"))).toBe(false);
  });
  it("statutory interest of a claim does not make the calculators' domain first; a calculation asked does", () => {
    expect(rank("POZEW O ZAPŁATĘ. Wnoszę o zasądzenie 48 000 zł z odsetkami ustawowymi. Strony zawarły umowę o roboty budowlane. Pozwany nie zapłacił faktury.")[0]?.skill.startsWith("dr-02-")).toBe(true);
    expect(rank("Chcę policzyć odsetki ustawowe od zaległej faktury.")[0]?.skill.startsWith("dr-16-")).toBe(true);
  });
});

describe("series r8 (2026-11-27)", () => {
  it("words of every proceeding name no domain by an act map alone", () => {
    const domains = rankDomains(router.registry, registryFlashRoutes(router.registry), "Przeanalizuj ten wyrok pod kątem apelacji powoda\nwyrok\nwyrok");
    expect(domains.some((domain) => domain.skill.startsWith("dr-03-"))).toBe(false);
  });
});
