import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTrivialChatCommand } from "../src/execution-engine.js";
import { analysisRequested, pathProfile } from "../src/mandatory-path.js";
import { criminalMatter } from "../src/matter-signals.js";
import { detectQueryMode, parseModeSignals } from "../src/query-mode.js";
import { LexSkillRegistry } from "../src/registry.js";
import { asksAbout } from "../src/skill-schema-catalog.js";
import { resolveAdditionalSkills } from "../src/skill-selection.js";
import { classifyTask, parseRoutingTable } from "../src/task-routing.js";
import { runScenarioBenchmark, TurnOutcomeModel, type Scenario } from "../src/turn-outcome.js";

// 5000 chat turns (build-scenarios-5000.py) with the outcome the user should get:
// a document, a full analysis, a simple legal answer or a general answer. Here the
// application's own decisions without lex-web's direct file request (that one is
// tested in lex-web), so the frames asking for a letter are left out.
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "scenarios-5000.json"), "utf8")) as Scenario[];
const model = new TurnOutcomeModel(CORPUS);
const read = (file: string) => fs.readFileSync(path.join(CORPUS, file), "utf8");
const signals = parseModeSignals(read("prawny-router-v3/references/KROK1-detekcja.md"));
const rate = (bucket: { total: number; ok: number }) => bucket.ok / bucket.total;

describe("outcome of 5000 chat turns", () => {
  const report = runScenarioBenchmark(
    model,
    scenarios.filter((item) => !item.frame.startsWith("D-") && item.frame !== "F-watek-pismo")
  );

  it("has the corpus", () => {
    expect(scenarios).toHaveLength(5000);
  });

  it("gives a lawyer's brief and an analysis request the full analysis", () => {
    expect(rate(report.byFrame["C-opis-prawnika"]!)).toBe(1);
    expect(rate(report.byFrame["E-prosba-o-analize"]!)).toBe(1);
  });

  it("answers small talk, thanks and non-legal requests without legal skills", () => {
    expect(rate(report.byFrame["G-nieprawne"]!)).toBe(1);
    expect(rate(report.byFrame["H-trywialne"]!)).toBe(1);
    expect(rate(report.byFrame["F-watek-podziekowanie"]!)).toBe(1);
  });

  it("keeps lay questions and thread follow-ups on the right path", () => {
    expect(rate(report.byFrame["A-pytanie-laika"]!)).toBeGreaterThanOrEqual(0.9);
    expect(rate(report.byFrame["B-opis-laika"]!)).toBeGreaterThanOrEqual(0.86);
    expect(rate(report.byFrame["F-watek-pytanie"]!)).toBeGreaterThanOrEqual(0.95);
  });

  it("never treats a legal question as small talk", () => {
    expect(report.failures.filter((item) => item.expected !== "OGOLNA" && item.got === "OGOLNA").map((item) => item.q)).toEqual([]);
  });
});

describe("turn decisions behind the outcome", () => {
  it.each([
    "Mocodawca kwestionuje uchwałę rady gminy. Proszę o analizę skargi.",
    "Klient został zwolniony dyscyplinarnie, pracował 6 lat.",
    "Klientka kwestionuje opodatkowanie budynku stawką dla działalności gospodarczej; orzecznictwo NSA jest rozbieżne."
  ])("a lawyer's words are PRAWNIK: %s", (text) => {
    expect(detectQueryMode(text, signals, null).mode).toBe("PRAWNIK");
  });

  it("a lay story stays LAIK", () => {
    expect(detectQueryMode("Sąsiad postawił płot na mojej działce. Co mogę zrobić?", signals, null).mode).toBe("LAIK");
    expect(detectQueryMode("Jestem klientem sklepu, odrzucili mi reklamację.", signals, null).mode).toBe("LAIK");
  });

  it("an analysis request is the full profile, a question is not", () => {
    for (const text of ["Przeanalizuj szanse i ryzyka w sprawie zwrotu kaucji.", "Ocen moje szanse w sprawie alimentow", "Proszę o pełną analizę prawną sprawy."]) {
      expect(analysisRequested(text)).toBe(true);
    }
    expect(analysisRequested("Czy jest jeszcze szansa, że ustawa wejdzie w życie?")).toBe(false);
    expect(pathProfile({ mode: "LAIK", simple: true, criminal: false, documentGeneration: false, analysis: true })).toBe("PELNY");
  });

  it("closing a conversation is small talk; yes and no answer the assistant's question", () => {
    for (const text of ["super, to wszystko", "dziękuję za pomoc", "dzięki za odpowiedź", "ok, to wszystko"]) {
      expect(isTrivialChatCommand(text)).toBe(true);
    }
    expect(isTrivialChatCommand("tak")).toBe(true);
    expect(isTrivialChatCommand("Użytkownik: Najemca nie płaci.\n\nAsystent: Czy mam przygotować wezwanie?\n\nUżytkownik: tak")).toBe(false);
    expect(isTrivialChatCommand("Użytkownik: Najemca nie płaci.\n\nAsystent: Czy mam przygotować wezwanie?\n\nUżytkownik: tak, dziękuję")).toBe(false);
  });

  it("criminal matters told in everyday words, not offices or suspicious things", () => {
    for (const text of ["Były partner pisze, że mnie zabije.", "Ktoś przejął moje konto na Facebooku.", "Policjant mnie popchnął.", "Co grozi za niepłacenie alimentów?", "Wezwano mnie w charakterze podejrzanego.", "Radca prawny został uderzony przez stronę przeciwną po rozprawie.", "Klient zwyzywał adwokata na korytarzu sądu."]) {
      expect(criminalMatter(text)).toBe(true);
    }
    for (const text of ["Kiedy poseł traci mandat?", "Dostaję podejrzane SMS-y po wycieku danych.", "Gmina sprzedała działkę, wygląda to podejrzanie."]) {
      expect(criminalMatter(text)).toBe(false);
    }
  });

  it("a question about a letter is not a request to write it", () => {
    for (const text of ["Jak napisać apelację od wyroku?", "Jak złożyć skargę na lekarza?", "Ile mam czasu na odwołanie od decyzji urzędu?", "Ile kosztuje wniesienie pozwu?"]) {
      expect(asksAbout(text)).toBe(true);
    }
    expect(asksAbout("Napisz apelację od wyroku.")).toBe(false);
  });

  it("a permit is not a statement of claim", () => {
    const routes = parseRoutingTable(read("prawny-router-v3/SKILL.md"));
    expect(classifyTask(routes, "Czy potrzebuję pozwolenia na budowę altany?")?.route.primary).not.toBe("pisma-procesowe-v3");
    expect(classifyTask(routes, "Złożyłem pozew w sądzie.")?.route.primary).toBe("pisma-procesowe-v3");
  });

  it("a contract, an invoice or an expert in the story is not the task", () => {
    const routes = parseRoutingTable(read("prawny-router-v3/SKILL.md"));
    const primary = (text: string) => classifyTask(routes, text)?.route.primary ?? null;
    for (const text of [
      "Kupiłem pralkę, brak zgodności towaru z umową, proszę o analizę uprawnień.",
      "Wystawiłem fakturę, a kontrahent od trzech miesięcy nie płaci.",
      "Biegły rewident zakwestionował sprawozdanie spółki."
    ]) {
      expect(primary(text)).toBeNull();
    }
    expect(primary("Przeanalizuj umowę najmu przed podpisaniem.")).toBe("analizator-umow-v1");
    expect(primary("Czy faktura jest dowodem w sprawie o zapłatę?")).toBe("analizator-dowodow-v3");
    expect(primary("Przygotuj pytania do świadka na rozprawę.")).toBe("przesluchanie-swiadkow-v2-min90");
  });

  it("the contract workflow starts for work on a contract, not for any contract named", () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const workflow = (text: string) =>
      resolveAdditionalSkills(registry, text, "dr-02-prawo-cywilne-rodzinne-gospodarcze", true, [], [], false, [], false, null).workflowExecutionSkill;
    expect(workflow("Czy umowa międzynarodowa jest ważniejsza od ustawy?")).not.toBe("analizator-umow-v1");
    expect(workflow("Pracuję na umowie o pracę od czterech lat, ile mam wypowiedzenia?")).not.toBe("analizator-umow-v1");
    expect(workflow("Przeanalizuj umowę najmu lokalu użytkowego przed podpisaniem")).toBe("analizator-umow-v1");
  });
});
