import { describe, expect, it } from "vitest";
import {
  buildEvidenceInventory,
  evidenceInventoryPrompt,
  evidencePortions,
  inventoryView,
  needsEvidenceInventory,
  parseEvidenceLines,
  quoteInChunk
} from "./evidence-inventory.js";
import { emptyProcessPleadingDraft, validateProcessPleadingDraft, withEvidenceInventory } from "./process-pleading-draft.js";
import { PROCESS_PLEADING_CHECKPOINTS } from "./process-pleading-state.js";

const files = (documents: Record<string, string[]>) => {
  const reads: string[] = [];
  return {
    reads,
    access: {
      listDocuments: async () => Object.entries(documents).map(([documentId, chunks]) => ({ documentId, totalPages: chunks.length, chunks: chunks.length })),
      readChunks: async (documentId: string, indices: number[]) => {
        reads.push(`${documentId}:${indices.join(",")}`);
        return { totalPages: documents[documentId]!.length, chunks: indices.map((index) => ({ index, pageStart: index + 1, pageEnd: index + 1, text: documents[documentId]![index]! })) };
      }
    }
  };
};

// A model that lists one fact per fragment, quoting the fragment's first words.
const echoModel = (calls: string[]) => async (portion: string) => {
  calls.push(portion);
  return [...portion.matchAll(/\[FRAGMENT (F\d+) — dokument [^\]]+\]\n(.+)/gu)].map((match) => `${match[1]} | fakt z ${match[1]} | ${match[2]!.slice(0, 40)} | dokument prywatny | B | 2024-03-01`).join("\n");
};

describe("evidence inventory", () => {
  it("parses the extraction lines and checks quotations against the chunk", () => {
    const lines = parseEvidenceLines("Wstęp modelu\nF1 | Umowę zawarto 1 marca | „Strony zawarły umowę w dniu 1 marca” | dokument prywatny | B | 2024-03-01\n| zła linia |\nF2 | Brak zapłaty | - | korespondencja | x | -");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ fragment: "F1", quote: "Strony zawarły umowę w dniu 1 marca", strength: "B", date: "2024-03-01" });
    expect(lines[1]!.strength).toBe("D");
    expect(quoteInChunk("…  Strony   zawarły umowę\nw dniu 1 marca 2024 r.", "strony zawarły umowę w dniu 1 marca")).toBe(true);
    expect(quoteInChunk("Strony zawarły umowę", "Strony nie zawarły umowy w dniu")).toBe(false);
  });

  it("groups chunks into portions within the budget", () => {
    const portions = evidencePortions(
      Array.from({ length: 5 }, (_, chunk) => ({ documentId: "doc", chunk, pages: String(chunk + 1), text: "x".repeat(3_000) })),
      7_000
    );
    expect(portions.map((portion) => portion.length)).toEqual([2, 2, 1]);
    expect(portions.flat().map((item) => item.fragment)).toEqual(["F1", "F2", "F3", "F4", "F5"]);
  });

  it("reads every chunk of every document once, then only the changed ones", async () => {
    const documents = {
      a: ["Strony zawarły umowę sprzedaży w dniu 1 marca 2024 r. w Krakowie.", "Kupujący nie zapłacił ceny w terminie czternastu dni."],
      b: ["Wezwanie do zapłaty z dnia 20 kwietnia 2024 r. doręczono pozwanemu."]
    };
    const calls: string[] = [];
    const first = await buildEvidenceInventory({ files: files(documents).access, extract: echoModel(calls), portionChars: 100, concurrency: 2, now: () => "2026-11-12T10:00:00.000Z" });
    expect(first).toMatchObject({ read: 3, reused: 0, failed: 0 });
    expect(first.inventory.items.map((item) => [item.id, item.documentId, item.pages, item.quoteVerified])).toEqual([
      ["D1", "a", "1", true],
      ["D2", "a", "2", true],
      ["D3", "b", "1", true]
    ]);
    expect(calls).toHaveLength(3);

    calls.length = 0;
    const changed = { ...documents, b: ["Wezwanie do zapłaty z dnia 21 kwietnia 2024 r. doręczono pozwanemu osobiście."] };
    const second = await buildEvidenceInventory({ files: files(changed).access, previous: first.inventory, extract: echoModel(calls), portionChars: 100, concurrency: 2 });
    expect(second).toMatchObject({ read: 1, reused: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("21 kwietnia");
    expect(second.inventory.items.map((item) => item.id)).toEqual(["D1", "D2", "D3"]);
  });

  it("keeps a failed portion for the next build and says so", async () => {
    let fail = true;
    const extract = async (portion: string) => {
      if (fail) throw new Error("timeout");
      return echoModel([])(portion);
    };
    const documents = { a: ["Pozwany przyznał w piśmie z 3 maja 2024 r., że otrzymał towar."] };
    const first = await buildEvidenceInventory({ files: files(documents).access, extract, portionChars: 1_000, concurrency: 1 });
    expect(first).toMatchObject({ read: 0, failed: 1 });
    expect(evidenceInventoryPrompt(first.inventory, "FULL", 10_000)).toBeNull();
    fail = false;
    const second = await buildEvidenceInventory({ files: files(documents).access, previous: first.inventory, extract, portionChars: 1_000, concurrency: 1 });
    expect(second).toMatchObject({ read: 1, failed: 0 });
    expect(second.inventory.failed).toEqual([]);
  });

  it("keeps the stored tokens and shows the turn's aliases to the model", async () => {
    const documents = { a: ["Umowę podpisał [PII:PERSON:0001] w dniu 1 marca 2024 r. w obecności świadka."] };
    const alias = (_documentId: string, text: string) => text.replaceAll("[PII:", "[LMPII:D01:");
    const unalias = (_documentId: string, text: string) => text.replaceAll("[LMPII:D01:", "[PII:");
    const calls: string[] = [];
    const built = await buildEvidenceInventory({ files: files(documents).access, extract: echoModel(calls), aliasText: alias, unaliasText: unalias, portionChars: 1_000, concurrency: 1 });
    expect(calls[0]).toContain("[LMPII:D01:PERSON:0001]");
    expect(built.inventory.items[0]!.quote).toContain("[PII:PERSON:0001]");
    expect(built.inventory.items[0]!.quoteVerified).toBe(true);
    const shown = evidenceInventoryPrompt(built.inventory, "FULL", 10_000, "", (_documentId, text) => text.replaceAll("[PII:", "[LMPII:D07:"))!;
    expect(shown).toContain("[LMPII:D07:PERSON:0001]");
    expect(shown).not.toContain("[PII:");
  });

  it("gives each step its view within the budget", async () => {
    const documents = { a: Array.from({ length: 30 }, (_, index) => `Fakt numer ${index + 1}: zdarzenie opisane w dokumencie na stronie ${index + 1} akt.`) };
    const { inventory } = await buildEvidenceInventory({ files: files(documents).access, extract: echoModel([]), portionChars: 500, concurrency: 3 });
    expect(inventory.items).toHaveLength(30);
    const full = evidenceInventoryPrompt(inventory, "FULL", 100_000)!;
    expect(full).toContain("D30 [B; dokument prywatny; 2024-03-01; dok. a, s. 30]");
    expect(full).toContain("cytat: „Fakt numer 30");
    const compact = evidenceInventoryPrompt(inventory, "COMPACT", 100_000)!;
    expect(compact).toContain("D30 [B; dok. a, s. 30] fakt z F30");
    expect(compact.split("\n").filter((line) => /^D\d/u.test(line) && line.includes("cytat"))).toEqual([]);
    const cited = evidenceInventoryPrompt(inventory, "CITED", 100_000, "Powód udowodni to dowodem D7 i D12.")!;
    expect(cited.split("\n").filter((line) => /^D\d/u.test(line) && line.includes("cytat")).map((line) => line.split(" ")[0])).toEqual(["D7", "D12"]);
    const short = evidenceInventoryPrompt(inventory, "FULL", 600)!;
    expect(short).toMatch(/pominięto \d+ pozycji/u);
  });

  it("a small budget still shows every document, the strongest items first", async () => {
    const documents = {
      a: Array.from({ length: 20 }, (_, index) => `Wpis numer ${index + 1} z dziennika budowy o przebiegu prac na dachu hali.`),
      z: ["Świadek stwierdził, że uwagę o falowniku dopisano odręcznie już po podpisaniu protokołu."]
    };
    const { inventory } = await buildEvidenceInventory({ files: files(documents).access, extract: echoModel([]), portionChars: 2_000, concurrency: 2 });
    const short = evidenceInventoryPrompt(inventory, "FULL", 1_500)!;
    expect(short).toContain("dok. z, s. 1");
    const ids = [...short.matchAll(/^D(\d+) /gmu)].map((match) => Number(match[1]));
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
  });

  it("names the views and the steps that build the inventory", () => {
    expect(inventoryView("CP-1c-macierz")).toBe("FULL");
    expect(inventoryView("CP-ATAK")).toBe("CITED");
    expect(inventoryView("CP-PRE-W2")).toBe("COMPACT");
    expect(needsEvidenceInventory("CP-1b", PROCESS_PLEADING_CHECKPOINTS)).toBe(false);
    expect(needsEvidenceInventory("CP-1c-macierz", PROCESS_PLEADING_CHECKPOINTS)).toBe(true);
    expect(needsEvidenceInventory("CP-PEER", PROCESS_PLEADING_CHECKPOINTS)).toBe(true);
  });

  it("is kept in the case's pleading store", async () => {
    const { inventory } = await buildEvidenceInventory({ files: files({ a: ["Dowód wpłaty z dnia 5 czerwca 2024 r. na kwotę 10 000 zł."] }).access, extract: echoModel([]), portionChars: 1_000, concurrency: 1 });
    const draft = withEvidenceInventory(emptyProcessPleadingDraft(`case_${"a".repeat(32)}`), inventory);
    expect(draft.revision).toBe(1);
    expect(validateProcessPleadingDraft(draft).evidence?.items[0]!.id).toBe("D1");
    expect(() => validateProcessPleadingDraft({ ...draft, evidence: { ...inventory, items: [{ ...inventory.items[0]!, fact: "x".repeat(500) }] } })).toThrow("PROCESS_PLEADING_DRAFT_INVALID");
  });
});
