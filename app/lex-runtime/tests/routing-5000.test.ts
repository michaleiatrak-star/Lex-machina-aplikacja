import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAccentMap, restoreAccents } from "../src/accent-restoration.js";
import { parseFlashRouting } from "../src/domain-module-map.js";
import { isTrivialChatCommand } from "../src/execution-engine.js";
import { applyNonLegalChatGate } from "../src/http/app.js";
import { criminalMatter } from "../src/matter-signals.js";
import { runRoutingBenchmark, TurnRouter, type BenchmarkReport, type RoutingCase } from "../src/routing-benchmark.js";
import type { SessionExecutionRequest } from "../src/session-executor.js";
import { isNonLegalMessage } from "../src/turn-gate.js";

// 5000 chat messages (build-routing-5000.py): legal matters of DR-01–DR-16 in five
// spellings, executive tasks, non-legal requests, trivial chat and thread follow-ups.
// The application's own routing for an API model (no model call) must keep every
// legal message legal, skip legal skills for the rest, and choose DR / executive skill.
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "routing-5000.json"), "utf8")) as RoutingCase[];
const router = new TurnRouter(CORPUS);
const flash = parseFlashRouting(fs.readFileSync(path.join(CORPUS, "prawo-polskie-v2/SKILL.md"), "utf8"));
const rate = (bucket: { total: number; ok: number }) => bucket.ok / bucket.total;

describe("routing of 5000 chat messages", () => {
  const report: BenchmarkReport = runRoutingBenchmark(router, cases);

  it("has the corpus", () => {
    expect(cases).toHaveLength(5000);
  });

  it("never treats a legal message as non-legal", () => {
    expect(report.failures.filter((item) => item.expected === "prawne").map((item) => item.q)).toEqual([]);
  });

  it("answers trivial chat without legal skills", () => {
    expect(rate(report.legalGate.trivialSkipped)).toBe(1);
  });

  // The rest stays legal on purpose: "kredyt hipoteczny", "klient", "sadzić" (sąd) are legal words too.
  it("answers non-legal requests without legal skills", () => {
    expect(rate(report.legalGate.nonLegalLoadedSkills)).toBeGreaterThanOrEqual(0.975);
  });

  it("chooses the executive skill and the domain", () => {
    expect(rate(report.executive)).toBeGreaterThanOrEqual(0.99);
    expect(rate(report.domainTop1)).toBeGreaterThanOrEqual(0.94);
    // Top-1 among the domains a matter of two accepts (fixture field alt).
    expect(rate(report.domainTop1Accepted)).toBeGreaterThanOrEqual(0.965);
  });

  it("requires the criminal qualifier for every criminal matter", () => {
    expect(rate(report.criminal.truePositive)).toBe(1);
    expect(rate(report.criminal.falsePositive)).toBeGreaterThanOrEqual(0.99);
  });
});

describe("legal gate of a chat turn", () => {
  it.each([
    "Jak upiec sernik na zimno?",
    "Hej, napisz funkcję w Pythonie, która sortuje listę.",
    "Mam pytanie: ile to jest 15% z 240?",
    "Podaj przepis na pierogi ruskie."
  ])("non-legal: %s", (question) => {
    expect(isNonLegalMessage(question, flash)).toBe(true);
  });

  it.each([
    "Sąsiad zalewa mi mieszkanie, co mam zrobić?",
    "Komitet audytu w jednostce zainteresowania publicznego.",
    "Jak dlugo trwa okres wypowiedzenia umowy o prace?",
    "Czy mogę nagrywać rozmowy z szefem?",
    "Co wynika z tych dokumentów?",
    "Jaki przepis reguluje zachowek?"
  ])("legal: %s", (question) => {
    expect(isNonLegalMessage(question, flash)).toBe(false);
  });

  // Series 3 (2026-10-10): legal words in a plainly non-legal topic, and the reverse.
  it.each([
    "Mam w Pythonie listę słowników i chcę ją posortować po polu 'data' malejąco. Jak to zrobić jedną linijką?",
    "Mój bohater w powieści kryminalnej jest jedynym świadkiem zbrodni i milczy. Jak pokazać jego wewnętrzny konflikt?",
    "Jak wytłumaczyć uczniom drugie prawo termodynamiki na przykładzie stygnącej herbaty?",
    "W Bashu mam skrypt, który przerywa egzekucję po pierwszym błędzie przez set -e. Jak to obejść?"
  ])("non-legal despite legal words: %s", (question) => {
    expect(isNonLegalMessage(question, flash)).toBe(true);
  });

  it.each([
    "Mam zrzuty ekranu, na których były wspólnik publikuje nasz kod źródłowy na GitHubie. Jak zabezpieczyć te dowody, żeby sąd je uznał?",
    "Plan miejscowy przewiduje drogę przez mój ogród. Gdzie się zwrócić?",
    "Czy mogę wykorzystać fragment piosenki w reklamie?",
    "Klub sportowy nie wypłaca kontraktu zawodnikowi. Co mogę zrobić?"
  ])("legal despite a non-legal topic: %s", (question) => {
    expect(isNonLegalMessage(question, flash)).toBe(false);
  });

  it("a follow-up of a legal thread stays legal", () => {
    expect(isNonLegalMessage("Użytkownik: Pracodawca zwolnił mnie dyscyplinarnie.\n\nAsystent: Kiedy?\n\nUżytkownik: jak to policzyć?", flash)).toBe(false);
  });

  it("consent to a task the assistant proposed is not small talk", () => {
    const asked = "Użytkownik: Najemca nie płaci.\n\nAsystent: Czy mam przygotować wezwanie do zapłaty?\n\nUżytkownik: ";
    expect(isTrivialChatCommand(`${asked}ok`)).toBe(false);
    expect(isTrivialChatCommand(`${asked}dobrze`)).toBe(false);
    expect(isTrivialChatCommand(`${asked}dzięki`)).toBe(true);
    expect(isTrivialChatCommand("Użytkownik: Najemca nie płaci.\n\nAsystent: Proszę wysłać wezwanie.\n\nUżytkownik: ok, dzięki")).toBe(true);
    expect(isTrivialChatCommand("super")).toBe(true);
  });

  it("in AUTO without material, a non-legal request goes to the conversational lane", () => {
    const registry = router.registry;
    const request = { query: "__LEX_SKILLS_V1__ {\"auto\":true,\"manual\":[]}\nJak upiec sernik?", primarySkill: "AUTO" } as SessionExecutionRequest;
    expect(applyNonLegalChatGate(registry, request, 0, false)).toBe(true);
    expect(request.conversationalOnly).toBe(true);
    expect(request.primarySkill.startsWith("dr-")).toBe(true);
    for (const [attachments, caseMaterial, primary] of [[1, false, "AUTO"], [0, true, "AUTO"], [0, false, "dr-02-prawo-cywilne-rodzinne-gospodarcze"]] as const) {
      const kept = { query: "__LEX_SKILLS_V1__ {\"auto\":true,\"manual\":[]}\nJak upiec sernik?", primarySkill: primary } as SessionExecutionRequest;
      expect(applyNonLegalChatGate(registry, kept, attachments, caseMaterial)).toBe(false);
      expect(kept.conversationalOnly).toBeUndefined();
    }
  });
});

describe("messages typed without Polish letters", () => {
  it("still get the criminal qualifier", () => {
    expect(criminalMatter("sasiad mnie pobil na klatce")).toBe(true);
    expect(criminalMatter("ktos ukradl mi rower, kradziez z wlamaniem")).toBe(true);
    expect(criminalMatter("Wygaśnięcie mandatu posła")).toBe(false);
  });

  it("get the spelling of the skill corpus back, only where it is unambiguous", () => {
    const map = buildAccentMap(["Napisz zażalenie. Zażalenie na postanowienie. Pytania do świadka. Sąd i sad owocowy, sad."]);
    expect(restoreAccents("Napisz zazalenie, pytania do swiadka", map)).toBe("Napisz zażalenie, pytania do świadka");
    expect(restoreAccents("sad", map)).toBe("sad");
    expect(restoreAccents("Napisz zażalenie", map)).toBe("Napisz zażalenie");
  });
});
