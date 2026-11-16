import { describe, expect, it } from "vitest";
import { documentUnits, factMatrixGoals, factMatrixPrompt, factRows, jsonObjects, parseTopics, passageUnits, stagedFactMatrix, topicRequest, verifiedFacts, type ModelCall } from "../src/fact-matrix.js";

const decision = { documentId: "D01", label: "postanowienie", chunks: [{ index: 0, text: "POSTANOWIENIE\n\nRzecznik ustalił, że pełnomocnik nie ujawnił danych pokrzywdzonego w piśmie z 3 marca.\n\nPouczenie: przysługuje odwołanie." }] };
const verdict = { documentId: "D02", label: "wyrok", chunks: [{ index: 0, text: "WYROK\n\nSąd ustalił, że w piśmie z 3 marca pełnomocnik podał adres i numer PESEL pokrzywdzonego.\n\nSąd uniewinnił oskarżonego." }] };

describe("the fact matrix of a pleading built from several documents", () => {
  it("documents cut into paragraphs (short lines joined), labelled by id and kind; too long: null", () => {
    const units = documentUnits([decision, verdict])!;
    expect(units[0]).toMatchObject({ documentId: "D01", heading: "D01 — postanowienie" });
    expect(units[0]!.text).toContain("POSTANOWIENIE Rzecznik ustalił");
    expect(documentUnits([decision], 10)).toBeNull();
    expect(passageUnits([{ documentId: "D02", chunkIndex: 3, text: "zdanie" }], new Map([["D02", "wyrok"]]))[0]!.heading).toBe("D02 — wyrok");
  });

  it("a finding of one document against another: RÓŻNE, a goal to resolve it; wording alone is no difference", () => {
    const units = documentUnits([decision, verdict])!;
    expect(topicRequest(units, "ujawnienie danych pokrzywdzonego", "documents").system).toContain("ujawnienie danych");
    const reply = JSON.stringify([
      { temat: "pismo z 3 marca", cecha: "ujawnienie danych", wartosc: "nie ujawnił danych", protokol: "D01 — postanowienie", cytat: "pełnomocnik nie ujawnił danych pokrzywdzonego" },
      { temat: "pismo z 3 marca", cecha: "ujawnienie danych", wartosc: "podał adres i PESEL", protokol: "D02 — wyrok", cytat: "pełnomocnik podał adres i numer PESEL" },
      { temat: "pismo z 3 marca", cecha: "data", wartosc: "3 marca", protokol: "D01 — postanowienie", cytat: "w piśmie z 3 marca" },
      { temat: "pismo z 3 marca", cecha: "data", wartosc: "z 3 marca", protokol: "D02 — wyrok", cytat: "w piśmie z 3 marca" },
      { temat: "pismo z 3 marca", cecha: "rozstrzygnięcie", wartosc: "uniewinnienie", protokol: "D01 — postanowienie", cytat: "Sąd uniewinnił oskarżonego" }
    ]);
    const { facts, dropped } = verifiedFacts(reply, units);
    expect(dropped).toBe(1);
    const rows = factRows(facts);
    expect(rows.find((row) => row.attribute === "ujawnienie danych")!.differs).toBe(true);
    expect(rows.find((row) => row.attribute === "data")!.differs).toBe(false);
    const prompt = factMatrixPrompt("", rows, dropped, "documents");
    expect(prompt).toContain("TEMAT × CECHA × DOKUMENT");
    expect(prompt).toContain("ujawnienie danych · RÓŻNE");
    expect(prompt).toContain("data · zgodne");
    expect(factMatrixGoals("", rows, 4, "documents")).toEqual(["Rozstrzygnąć rozbieżność dokumentów na korzyść strony albo ją wyjaśnić: pismo z 3 marca (ujawnienie danych)"]);
  });

  it("in stages: topics first, then each document against the same names; a call cut by the time limit keeps its lines", async () => {
    const units = documentUnits([decision, verdict])!;
    const seen: string[] = [];
    const call: ModelCall = async (system, user) => {
      seen.push(system.includes("Etap 1") ? "topics" : user.includes("## D01") ? "D01" : "D02");
      if (system.includes("Etap 1"))
        return { text: '{"temat": "pismo z 3 marca", "cechy": ["ujawnienie danych"], "dokumenty": ["D01 — postanowienie", "D02 — wyrok"]}\n{"temat": "D02 — wyrok", "cechy": []}', failure: "" };
      if (user.includes("## D01")) return { text: '{"temat": "pismo z 3 marca", "cecha": "ujawnienie danych", "wartosc": "nie ujawnił", "cytat": "pełnomocnik nie ujawnił danych pokrzywdzonego"}', failure: "" };
      // Cut mid-line by the time limit: the whole line before stays.
      return { text: '{"temat": "pismo z 3 marca", "cecha": "ujawnienie danych", "wartosc": "podał adres i PESEL", "cytat": "pełnomocnik podał adres i numer PESEL"}\n{"temat": "pismo z 3 m', failure: "limit czasu 150 s" };
    };
    const result = await stagedFactMatrix(units, "ujawnienie danych", "documents", call);
    expect(seen[0]).toBe("topics");
    expect(seen.slice(1).sort()).toEqual(["D01", "D02"]);
    expect(result.topics.map((topic) => topic.topic)).toEqual(["pismo z 3 marca"]);
    expect(result.facts.map((fact) => fact.record)).toEqual(expect.arrayContaining(["D01 — postanowienie", "D02 — wyrok"]));
    expect(result.failures).toEqual(["D02 — wyrok: limit czasu 150 s"]);
    expect(factRows(result.facts)[0]!.differs).toBe(true);
  });

  it("JSON lines or an array; topic names resolved to the documents' headings", () => {
    expect(jsonObjects('[{"a": 1}, {"a": 2}]')).toHaveLength(2);
    expect(jsonObjects('{"a": 1},\n- {"a": 2}\nkomentarz')).toHaveLength(2);
    expect(parseTopics('{"temat": "x", "cechy": ["data"], "dokumenty": ["d01 — postanowienie"]}', ["D01 — postanowienie"])[0]!.records).toEqual(["D01 — postanowienie"]);
  });
});
