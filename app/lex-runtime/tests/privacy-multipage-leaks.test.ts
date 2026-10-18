import { describe, expect, it } from "vitest";
import { PERSON_CASES, type PersonEntity, type PersonMorphology } from "../src/privacy/person-morphology.js";
import { LocalPolishPseudonymizer, PseudonymizationVault, type PiiSpan } from "../src/privacy/pseudonymizer.js";
import { RegistryEnrichment, type RegistryCall } from "../src/privacy/registry-enrichment.js";

// Leaks of a 54-page set of employment documents (fictitious data in the same shapes): numbers,
// postal codes and firm names protected on one page and left in clear on another.
const WL = {
  status: "FOUND",
  result: {
    tytul_lub_nazwa: "KOLOR PARK SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    regon: "384106330",
    krs: "0000123456",
    adres: "UL. KOLOROWA 15, 40-001 KATOWICE",
    osoby: [],
    rachunki: []
  }
};
const registry = () =>
  new RegistryEnrichment((async ({ arguments: args }) =>
    String(args.nip) === "5261040828" ? { ok: true, result: WL } : { ok: true, result: { status: "NOT_FOUND" } }) as RegistryCall);

// A recognizer that returns fixed spans, as Stanza does on these pages.
function named(spans: Array<{ value: string; kind?: PiiSpan["kind"] }>) {
  return {
    recognize: async (text: string): Promise<PiiSpan[]> =>
      spans.flatMap(({ value, kind }) => {
        const start = text.indexOf(value);
        return start < 0 ? [] : [{ start, end: start + value.length, kind: kind ?? "PERSON", value, confidence: 0.9, source: "AUTO" as const }];
      })
  };
}

// The morphology of two-word names: every case form is the name itself (a foreign name).
const morphology: PersonMorphology = {
  analyze: async (surfaces) =>
    surfaces.map((surface): PersonEntity | null =>
      /^\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+$/u.test(surface)
        ? {
            canonical: surface,
            gender: "m1",
            genderAlternatives: [],
            status: "ok",
            forms: Object.fromEntries(PERSON_CASES.map((personCase) => [personCase, { text: surface, source: "sgjp", confidence: 1 }])) as PersonEntity["forms"],
            warnings: []
          }
        : null
    )
};

async function pages(texts: string[], recognizer?: ReturnType<typeof named>) {
  // As the document service does: one key for the document, every page twice.
  const vault = new PseudonymizationVault();
  const service = new LocalPolishPseudonymizer(vault, recognizer, morphology, registry());
  for (const text of texts) await service.pseudonymize(text);
  const out = [];
  for (const text of texts) out.push(await service.pseudonymize(text));
  return out;
}

describe("numbers and codes protected on one page are protected on every page", () => {
  it("KRS without its label, REGON with a wrong check digit after its label, the postal code apart from the address", async () => {
    const [first, second] = await pages([
      "Kolor Park sp. z o.o., NIP: 526-104-08-28, KRS: 0000123456, REGON: 384106330, ul. Kolorowa 15, 40-001 Katowice.",
      "Spółka (NIP 5261040828) wpisana do rejestru przedsiębiorców pod numerem 0000123456, REGON: 284106330.\nz siedzibą w Katowicach 40-001 przy ul. Kolorowa 15"
    ]);
    for (const leak of ["0000123456", "384106330", "40-001"]) expect(first!.text).not.toContain(leak);
    for (const leak of ["0000123456", "284106330", "40-001", "Kolorowa 15"]) expect(second!.text).not.toContain(leak);
    // The REGON one digit off the register's: masked and named for the user (a typo in the document).
    expect(second!.findings.find((finding) => finding.kind === "REGON")?.uncertain).toMatch(/różni się od rejestru o jedną cyfrę/u);
    expect(second!.text).toContain("w Katowicach");
  });

  it("a REGON one digit off without its label is left alone (another number)", async () => {
    const [page] = await pages(["NIP 526-104-08-28. Numer sprawy 284106330 w rejestrze pism."]);
    expect(page!.text).toContain("284106330");
  });
});

describe("names across pages and lines", () => {
  it("the firm of the register on a page without its NIP: one token, the sentence's words stay", async () => {
    const [first, second] = await pages(
      ["Kolor Park sp. z o.o., NIP 526-104-08-28.", "Pomiędzy Kolor Park sp. z o.o. a pracownikiem."],
      named([{ value: "Pomiędzy Kolor Park" }])
    );
    const token = first!.findings.find((finding) => finding.firm)!.token;
    expect(second!.text).toBe(`Pomiędzy ${token} sp. z o.o. a pracownikiem.`);
  });

  it("a given name ending a line and the surname opening the next are one person; an address below is not", async () => {
    const [page] = await pages(
      ["W związku ze skargą na Adwokata Andrzeja\nNowickiego z kancelarii w Katowicach.\nPaweł Kania\nos. Kosmonautów 86/9"],
      named([{ value: "Andrzeja\nNowickiego" }, { value: "Paweł Kania\nos" }])
    );
    expect(page!.text).not.toContain("Nowickiego");
    expect(page!.findings.filter((finding) => finding.kind === "PERSON")).toHaveLength(2);
  });

  it("the place of a letter's date line and a form of address are no persons", async () => {
    const [page] = await pages(["Katowice, dnia 4 czerwca 2025 r.\nSz. P.\nJan Nowak"], named([{ value: "Katowice" }, { value: "Sz. P." }, { value: "Jan Nowak" }]));
    expect(page!.text).toMatch(/^Katowice, dnia 4 czerwca 2025 r\.\nSz\. P\.\n\[PII:PERSON:\d{4}\]$/u);
  });

  it("surname first on a page before the one naming the person in full: one token; a town is no surname", async () => {
    const [first, second] = await pages(
      ["Prezes Zarządu Lee Juneyong\nul. Polna 1, 40-001 Katowice\nKatowice to siedziba.", "Reprezentowana przez Juneyong Lee."],
      named([{ value: "Lee" }, { value: "Juneyong Lee" }, { value: "40-001 Katowice", kind: "ADDRESS" }])
    );
    expect(first!.text).not.toContain("Juneyong");
    const token = second!.findings.find((finding) => finding.kind === "PERSON")!.token;
    expect(first!.findings.find((finding) => finding.kind === "PERSON")!.token).toBe(token);
    expect(first!.text).toContain("Katowice to siedziba.");
  });
});
