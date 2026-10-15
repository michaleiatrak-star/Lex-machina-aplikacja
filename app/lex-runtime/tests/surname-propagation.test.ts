import { describe, expect, it } from "vitest";
import type { PersonEntity } from "../src/privacy/person-morphology.js";
import { surnameMentions } from "../src/privacy/surname-propagation.js";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";

const person = (forms: [string, string, string, string, string, string, string], gender: "m1" | "f" = "m1"): PersonEntity => ({
  canonical: forms[0],
  gender,
  genderAlternatives: [],
  status: "ok",
  warnings: [],
  forms: Object.fromEntries(
    (["NOM", "GEN", "DAT", "ACC", "INS", "LOC", "VOC"] as const).map((name, index) => [name, { text: forms[index]!, source: "sgjp", confidence: 1 }])
  ) as PersonEntity["forms"]
});
const NOWAK = person(["Piotr Nowak", "Piotra Nowaka", "Piotrowi Nowakowi", "Piotra Nowaka", "Piotrem Nowakiem", "Piotrze Nowaku", "Piotrze Nowaku"]);
const WILK = person(["Jan Wilk", "Jana Wilka", "Janowi Wilkowi", "Jana Wilka", "Janem Wilkiem", "Janie Wilku", "Janie Wilku"]);
const KOWALSKI = person(["Jan Kowalski", "Jana Kowalskiego", "Janowi Kowalskiemu", "Jana Kowalskiego", "Janem Kowalskim", "Janie Kowalskim", "Janie Kowalski"]);
const KOWALSKI_2 = person(["Adam Kowalski", "Adama Kowalskiego", "Adamowi Kowalskiemu", "Adama Kowalskiego", "Adamem Kowalskim", "Adamie Kowalskim", "Adamie Kowalski"]);
const free = () => false;

describe("nazwisko znanej osoby w innych zapisach", () => {
  it("samo nazwisko w każdym przypadku i odwrócona kolejność: ta sama osoba", () => {
    const text = "Doręczono Nowakowi wezwanie, ale Nowaka nie było.\nNOWAK PIOTR – pozwany. Lista: Nowak Piotr.";
    expect(surnameMentions(text, [NOWAK], free).map((item) => [item.value, item.entity.canonical, item.ambiguous ?? false])).toEqual([
      ["Nowakowi", "Piotr Nowak", false],
      ["Nowaka", "Piotr Nowak", false],
      ["NOWAK PIOTR", "Piotr Nowak", false],
      ["Nowak Piotr", "Piotr Nowak", false]
    ]);
  });

  it("słowo pospolite na początku zdania: zakryte, ale do decyzji; po „Pan” i w środku zdania pewne", () => {
    const text = "Wilk zaatakował owce. Pan Wilk nie zapłacił, a sąsiad widział Wilka w ogrodzie.";
    expect(surnameMentions(text, [WILK], free).map((item) => [item.value, item.ambiguous ?? false])).toEqual([
      ["Wilk", true],
      ["Wilk", false],
      ["Wilka", false]
    ]);
  });

  it("nazwisko dwóch osób sprawy nie jest przypisywane żadnej", () => {
    const text = "Kowalskiemu doręczono pismo, a Kowalskiego wezwano.";
    expect(surnameMentions(text, [KOWALSKI, KOWALSKI_2], free)).toEqual([]);
  });
});

describe("pseudonimizacja: jeden symbol dla osoby", () => {
  it("pełne imię i nazwisko, samo nazwisko i lista „Nazwisko Imię” mają ten sam symbol; niepewne idzie do decyzji", async () => {
    const morphology = {
      analyze: async (surfaces: string[]) => surfaces.map((surface) => (surface.includes("Wilk") ? WILK : null))
    };
    const recognizer = {
      recognize: async (text: string) => {
        const at = text.indexOf("Jan Wilk");
        return at < 0 ? [] : [{ start: at, end: at + 8, kind: "PERSON" as const, value: "Jan Wilk", confidence: 0.9, source: "AUTO" as const }];
      }
    };
    const pseudonymizer = new LocalPolishPseudonymizer(new PseudonymizationVault(), recognizer, morphology as never);
    const result = await pseudonymizer.pseudonymize("Pozwany Jan Wilk podpisał umowę. Wilk nie zapłacił. Pan Wilk zwlekał. WILK JAN – pozwany. Lista: Wilk Jan.");
    expect(result.text).not.toMatch(/wilk/i);
    expect(result.text).toContain("Lista: [PII:PERSON:0001].");
    expect(new Set(result.text.match(/\[PII:PERSON:\d{4}\]/g))).toEqual(new Set(["[PII:PERSON:0001]"]));
    const uncertain = result.findings.filter((finding) => finding.uncertain);
    expect(uncertain).toHaveLength(1);
    expect(uncertain[0]!.uncertain).toBe("nazwisko osoby Jan Wilk czy słowo pospolite?");
  });
});
