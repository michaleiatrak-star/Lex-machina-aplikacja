import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { chunkEntries, registerBlock, updateRegister, validCaseRegister, withoutDocument, type RegisterDocument } from "../src/case-register.js";
import { EncryptedCaseWorkspaceStore } from "../src/case-workspace-store.js";

// User 2026-11-27 ("zrób 1-3"): participants, events and facts of the case gathered from its documents
// turn by turn, kept with the case, given to ordinary questions. Synthetic documents in the form the
// model sees them (the case's shared placeholders).
const pozew: RegisterDocument = {
  documentId: "doc_pozew",
  label: "pozew",
  chunks: [{
    index: 1,
    text: "Sąd Rejonowy w Łodzi, I Wydział Cywilny\nPowód: [PII:FIRM:0001] sp. z o.o.\nPozwany: [PII:PERSON:0002]\nPOZEW O ZAPŁATĘ\nWnoszę o zasądzenie od pozwanego kwoty 48 000 zł z odsetkami od dnia 15 marca 2025 r. W dniu 10 stycznia 2025 r. strony zawarły umowę o roboty budowlane. Roboty odebrano protokołem z dnia 28 lutego 2025 r. bez zastrzeżeń. Dowody: umowa z 10.01.2025, protokół z 28.02.2025, faktura z 01.03.2025."
  }]
};
const protokol: RegisterDocument = {
  documentId: "doc_protokol",
  label: "protokół rozprawy",
  chunks: [{
    index: 1,
    text: "PROTOKÓŁ ROZPRAWY z dnia 12 września 2025 r.\nŚwiadek [PII:PERSON:0001], lat 45, kierownik budowy, pouczony o odpowiedzialności karnej z art. 233 k.k., zeznał:\nByłem kierownikiem budowy na ul. Przykładowej. Pęknięcia zobaczyłem chyba w kwietniu.\nNa pytanie pełnomocnika powoda: Pan [PII:PERSON:0002] był na budowie w lutym dwa razy."
  }]
};
const wyrok: RegisterDocument = {
  documentId: "doc_wyrok",
  label: "wyrok",
  chunks: [{
    index: 1,
    text: "po rozpoznaniu sprawy z powództwa [PII:FIRM:0001] sp. z o.o. przeciwko [PII:PERSON:0002] o zapłatę. Pozwany podniósł, że wylewki mają wady i że obniżył wynagrodzenie o 30 000 zł. Sąd ustalił, że roboty wykonano w styczniu i lutym 2025 r. przy niskich temperaturach. Zeznania świadka Sąd uznał za wiarygodne."
  }]
};

describe("the case register", () => {
  const register = updateRegister(null, [pozew, protokol, wyrok], "2026-11-27T10:00:00.000Z");

  it("gives each person and entity the role the document gives it, not the role of a word nearby", () => {
    const roles = (symbol: string) => register.participants.find((item) => item.symbol === symbol)?.roles ?? [];
    expect(roles("[PII:FIRM:0001]")).toEqual(["powód"]);
    expect(roles("[PII:PERSON:0002]")).toEqual(["pozwany"]);
    expect(roles("[PII:PERSON:0001]")).toEqual(expect.arrayContaining(["świadek", "kierownik budowy"]));
    expect(roles("[PII:PERSON:0001]")).not.toContain("powód");
  });

  it("keeps the events in date order, one per sentence, and leaves out a list of the evidence's dates", () => {
    expect(register.events.map((item) => item.date)).toEqual([...register.events.map((item) => item.date)].sort());
    expect(register.events.some((item) => item.date === "2025-01-10" && /zawarły umowę/u.test(item.text))).toBe(true);
    expect(register.events.some((item) => /^Dowody:/u.test(item.text))).toBe(false);
  });

  it("tells a party's claim, the court's finding and a witness's testimony apart", () => {
    const kind = (pattern: RegExp) => register.facts.find((item) => pattern.test(item.text));
    expect(kind(/obniżył wynagrodzenie/u)).toMatchObject({ kind: "TWIERDZENIE", speaker: "pozwany" });
    expect(kind(/Sąd ustalił/u)).toMatchObject({ kind: "USTALENIE", speaker: "sąd" });
    expect(kind(/Sąd uznał za wiarygodne/u)).toMatchObject({ kind: "USTALENIE", speaker: "sąd" });
    expect(kind(/Pęknięcia zobaczyłem/u)).toMatchObject({ kind: "ZEZNANIE", speaker: "świadek" });
    expect(kind(/48 000 zł/u)).toMatchObject({ kind: "TWIERDZENIE", speaker: "powód" });
  });

  it("replaces what a chunk gave when it is read again, and forgets a removed document", () => {
    const reread = updateRegister(register, [{ ...wyrok, chunks: [{ index: 1, text: "Sąd zważył, że odbiór nie wyłącza rękojmi." }] }]);
    expect(reread.facts.some((item) => /niskich temperaturach/u.test(item.text))).toBe(false);
    expect(reread.facts.some((item) => /nie wyłącza rękojmi/u.test(item.text))).toBe(true);
    const removed = withoutDocument(reread, "doc_protokol");
    expect(removed.participants.some((item) => item.symbol === "[PII:PERSON:0001]")).toBe(false);
    expect(removed.facts.some((item) => item.documentId === "doc_protokol")).toBe(false);
  });

  it("gives the question the facts it is about, with their document, within the budget", () => {
    const block = registerBlock(register, "Czy pozwany skutecznie obniżył wynagrodzenie z powodu wad?")!;
    expect(block).toContain("## Uczestnicy");
    expect(block).toMatch(/\[twierdzenie — pozwany\] Pozwany podniósł, że wylewki mają wady[^\n]*\[wyrok\]/u);
    expect(registerBlock(register, "pytanie", 400)!.length).toBeLessThanOrEqual(400);
  });

  it("stores no names: only the case's placeholders", () => {
    expect(chunkEntries(pozew, { index: 2, text: "Pozwany: [LMPII:D01:PERSON:0003] i [PII:PERSON:0004]" }).participants.map((item) => item.symbol)).toEqual(["[PII:PERSON:0004]"]);
    expect(validCaseRegister(register)).not.toBeNull();
    expect(validCaseRegister({ ...register, participants: [{ symbol: "Jan Kowalski", kind: "OSOBA", roles: [], sources: [] }] })).toBeNull();
  });
});

describe("the register in the encrypted case memory", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("is saved, read back and removed, and is not stored in plain text", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-register-"));
    roots.push(rootDir);
    const store = new EncryptedCaseWorkspaceStore({ rootDir });
    const args = { caseId: "case_" + "c".repeat(32), caseDataKey: randomBytes(32), keyVersion: 1 };
    const register = updateRegister(null, [pozew, wyrok]);
    await store.saveCaseMemory({ ...args, register });
    expect((await store.getCaseMemory(args)).register?.facts.length).toBe(register.facts.length);
    const onDisk = fs.readdirSync(rootDir, { recursive: true }).map((name) => String(name)).filter((name) => fs.statSync(path.join(rootDir, name)).isFile());
    for (const file of onDisk) expect(fs.readFileSync(path.join(rootDir, file), "utf8")).not.toContain("obniżył wynagrodzenie");
    await store.saveCaseMemory({ ...args, register: null });
    expect((await store.getCaseMemory(args)).register).toBeUndefined();
  });
});
