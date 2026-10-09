import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutOutputContract } from "../src/document-output-contract.js";
import { LegalDocumentAstGenerator } from "../src/legal-document-ast-generator.js";
import { LexSkillRegistry } from "../src/registry.js";
import { skillModules } from "../src/skill-module-map.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

async function instructionFor(query: string): Promise<string> {
  let sent = "";
  const generator = new LegalDocumentAstGenerator({
    execute: async (request: { query: string }) => {
      sent = request.query;
      throw new Error("captured");
    }
  } as never);
  await generator
    .generate({
      query,
      provider: "google",
      model: "gemini-2.5-flash",
      primarySkill: "pisma-proste-v2",
      mode: "LAIK",
      documentType: "other",
      styleProfile: "lex-classic-clean-v1",
      aliases: { schemaVersion: 1, entries: [] }
    })
    .catch(() => undefined);
  return sent;
}

describe("document output contract", () => {
  it("is cut off before decisions read the request", async () => {
    const query = "Przygotuj mi uchwałę zarządu o podziale odpowiedzialności za compliance.";
    const sent = await instructionFor(query);
    expect(sent).toContain("# OUTPUT CONTRACT — LEGAL DOCUMENT AST");
    expect(withoutOutputContract(sent)).toBe(query);
    expect(withoutOutputContract(query)).toBe(query);
  });

  it("does not trigger the payment-demand and consumer-credit schemas for every document", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const sent = await instructionFor("Przygotuj mi uchwałę zarządu o podziale odpowiedzialności za compliance.");
    const triggered = (text: string) => skillModules(registry, "pisma-proste-v2", { text }).map((item) => path.basename(item.resource));
    // The contract's own words ("WEZWANIE DO ZAPŁATY ... amount, due date") did it.
    expect(triggered(sent)).toEqual(expect.arrayContaining(["SPE-ostateczne.md", "SPM-skd-oswiadczenie.md"]));
    const fromRequest = triggered(withoutOutputContract(sent));
    for (const name of ["SPE-ostateczne.md", "SPM-skd-oswiadczenie.md", "mod-ustawa-kredyt-konsumencki-SKD.md"]) {
      expect(fromRequest).not.toContain(name);
    }
  });
});
