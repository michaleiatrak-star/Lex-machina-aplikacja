import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyDocument } from "../src/document-kind.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { schemaCatalog } from "../src/skill-module-map.js";
import { decideTask, nextChoices, PIPELINE_HANDOFF, type DeliveredMaterial } from "../src/task-routing.js";

// Every path of the "co dalej" buttons, clicked one after another from a first request: it must
// end (a file or the last stage) without coming back to a skill already used in the thread.
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();
const executor = new SafeSessionExecutor(registry, new ProviderGateway(new ProviderRegistry())) as unknown as {
  taskRoutes(): Parameters<typeof decideTask>[0];
  activationMatrix(): Parameters<typeof decideTask>[1];
  redactionTest(): Parameters<typeof decideTask>[4];
  skillCombinations(): Parameters<typeof nextChoices>[2];
};
const simple = { skill: "pisma-proste-v2", entries: schemaCatalog(registry, "pisma-proste-v2") };

const DOCS = {
  pozew: "Sąd Rejonowy dla Krakowa-Śródmieścia w Krakowie\nPowód: ABC sp. z o.o.\nPozwany: Jan Kowalski\nPOZEW O ZAPŁATĘ\nWnoszę o zasądzenie kwoty 12 000 zł.",
  wezwanie: "PRZEDSĄDOWE WEZWANIE DO ZAPŁATY\nWzywam Pana do zapłaty kary umownej 20 000 zł z porozumienia w terminie 7 dni.",
  umowa: "UMOWA O DZIEŁO\nzawarta w dniu 1.02.2026 pomiędzy Zamawiającym a Wykonawcą.\n§ 5 Kary umowne: 10% wynagrodzenia.",
  faktura: "FAKTURA VAT nr 12/2026\nSprzedawca: ABC sp. z o.o.\nDo zapłaty: 12 300,00 zł",
  wyrok: "WYROK\nW IMIENIU RZECZYPOSPOLITEJ POLSKIEJ\nSąd Rejonowy w Krakowie\n1. zasądza od pozwanego na rzecz powoda kwotę 12 000 zł",
  sms: "Zrzut ekranu SMS 12.03.2026: Oddam ci pieniądze w przyszłym tygodniu. Jan"
} as const;

const SCENARIOS: Array<[string, Array<keyof typeof DOCS>]> = [
  ["Odpowiedz na ten dokument.", ["wezwanie"]],
  ["Przeanalizuj ten dokument.", ["wezwanie"]],
  ["Przygotuj odpowiedź na pozew.", ["pozew"]],
  ["Przeanalizuj pozew i oceń szanse.", ["pozew"]],
  ["Napisz pozew o zapłatę.", ["faktura"]],
  ["Oceń moje dowody.", ["sms", "faktura"]],
  ["Oceń dowody, terminy i koszty procesu.", ["sms"]],
  ["Przeanalizuj wyrok i oceń czy warto apelować.", ["wyrok"]],
  ["Popraw zapisy o karach umownych w mojej umowie.", ["umowa"]],
  ["Co mówi art. 471 KC? Napisz pismo.", []],
  ["Przygotuj pytania do przesłuchania świadka.", []],
  ["Jakie mam szanse w tej sprawie?", ["pozew", "umowa"]],
  ["Znajdź orzecznictwo do art. 484 KC.", []]
];

function walk(question: string, materials: DeliveredMaterial[], used: string[], paths: string[][]): void {
  const decision = decideTask(executor.taskRoutes(), executor.activationMatrix(), question, materials, executor.redactionTest(), simple);
  if (!decision) return void paths.push(used);
  expect(used, `powrót do ${decision.primary}: ${[...used, decision.primary].join(" > ")}`).not.toContain(decision.primary);
  const here = [...used, decision.primary];
  const choices = nextChoices(decision.primary, decision.then, executor.skillCombinations(), { question, materials }, { ownDocument: decision.primary === "pisma-procesowe-v3" });
  if (!choices.length) return void paths.push(here);
  for (const choice of choices) {
    // A file of the result, or a simple letter (its file follows the answer): the path ends.
    if (choice.own || choice.skill === "pisma-proste-v2") paths.push([...here, `plik:${choice.skill}`]);
    else walk(`${PIPELINE_HANDOFF} ${choice.skill}. Kontynuuj na podstawie powyższego wyniku, tylko w zakresie tego etapu.`, materials, here, paths);
  }
}

describe("co dalej: przyciski nie zapętlają rozmowy", () => {
  it.each(SCENARIOS)("%s %j", (question, docs) => {
    const paths: string[][] = [];
    walk(question, docs.map((doc) => classifyDocument({ text: DOCS[doc] })), [], paths);
    expect(paths.length).toBeGreaterThan(0);
    for (const item of paths) expect(item.length).toBeLessThanOrEqual(4);
  });
});
