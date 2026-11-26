import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { simpleFormQuestion } from "../src/matter-complexity.js";
import { criminalMatter } from "../src/matter-signals.js";
import { decideTask, parseActivationMatrix, parseRedactionTest, parseRoutingTable } from "../src/task-routing.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const routes = parseRoutingTable(fs.readFileSync(path.join(CORPUS, "prawny-router-v3/SKILL.md"), "utf8"));
const matrix = parseActivationMatrix(fs.readFileSync(path.join(CORPUS, "shared/ACTIVATION-MATRIX.md"), "utf8"));
const redaction = parseRedactionTest(fs.readFileSync(path.join(CORPUS, "pisma-procesowe-v3/SKILL.md"), "utf8"));

// Probe 2026-11-26: a lay person's everyday legal question is answered in the simple form, without an
// executive skill's procedure (the guide may lead a "co robić?" about a dispute); criminal only for an
// offence or a crime.
const CIVIL = [
  "Sąsiad zalewa mi mieszkanie od miesiąca, co mogę zrobić?",
  "Czy pracodawca może mnie zwolnić, gdy jestem na zwolnieniu lekarskim?",
  "Ile wynosi zachowek i komu przysługuje?",
  "Kupiłem buty przez internet, czy mogę je zwrócić po 10 dniach?",
  "Były mąż nie płaci alimentów na dziecko, co mogę zrobić?",
  "Komornik zajął mi konto, ile pieniędzy musi mi zostawić?",
  "Czy muszę płacić podatek od darowizny mieszkania od rodziców?",
  "Jak założyć jednoosobową działalność gospodarczą?",
  "Wynajmujący nie oddaje mi kaucji po wyprowadzce, co robić?",
  "Szef na mnie krzyczy i poniża mnie przy innych, czy to mobbing?",
  "Czy po rozwodzie należy mi się połowa mieszkania kupionego przed ślubem?",
  "Czy mogę nagrywać rozmowę z pracodawcą bez jego zgody?",
  "Bank naliczył mi prowizję za wcześniejszą spłatę kredytu, czy to legalne?"
];
const CRIMINAL = ["Dostałem mandat za przekroczenie prędkości o 40 km/h, czy muszę go przyjąć?", "Ktoś ukradł mi rower z klatki, co dalej?"];

describe("typical legal questions: simple form, no executive skill", () => {
  it.each([...CIVIL, ...CRIMINAL])("%s", (q) => {
    expect(simpleFormQuestion(q)).toBe(true);
    expect([undefined, "przewodnik-prawny-v2"]).toContain(decideTask(routes, matrix, q, [], redaction)?.primary);
  });
  it("criminal only for an offence or a crime", () => {
    for (const q of CIVIL) expect(criminalMatter(q), q).toBe(false);
    for (const q of CRIMINAL) expect(criminalMatter(q), q).toBe(true);
  });
});
