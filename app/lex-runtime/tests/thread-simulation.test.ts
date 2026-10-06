import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rankDomains } from "../src/domain-module-map.js";
import { criminalMatter } from "../src/matter-signals.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { parseFlashRouting } from "../src/domain-module-map.js";

// Threads of 1-5 user messages through the whole executor with a fake provider:
// every turn keeps the mechanical path (R-1..R-5, criminal qualifier, domain hint,
// executive skill, widgets, later-turn sections) without losing an element.
// LEX_SIM_THREADS / LEX_SIM_SHARD (e.g. "0/4") run the large series.
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const THREADS = Number(process.env.LEX_SIM_THREADS ?? 40);
const [SHARD, SHARDS] = (process.env.LEX_SIM_SHARD ?? "0/1").split("/").map(Number) as [number, number];

const domains = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/routing-domains-500.json"), "utf8")) as Array<{ q: string; dr: string }>;
const executive = Object.values(
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/routing-executive.json"), "utf8")) as Record<string, string[]>
).flat();
const OPENINGS = [...domains.map((item) => item.q), ...executive];
const FOLLOW_UPS = [
  "A jaki jest termin na to?",
  "Co mam zrobić najpierw?",
  "Napisz mi pismo w tej sprawie.",
  "Czy mogę się od tego odwołać?",
  "A jeśli druga strona nie odpowie?",
  "Podsumuj to krótko w punktach.",
  "Jakie dokumenty powinienem zebrać?",
  "Ile to może kosztować?",
  "Pokaż to w tabeli.",
  "Dziękuję, a co z odsetkami?",
  "Czy to się już przedawniło?",
  "Sąsiad dodatkowo mi groził, że mnie pobije.",
  "Przygotuj listę pytań do świadka.",
  "Czy potrzebuję adwokata?"
];

// mulberry32: a reproducible thread per seed.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

type Finding = { thread: number; turn: number; check: string; query: string };

describe("thread simulation (1-5 user messages)", () => {
  it(`keeps the mechanical path on every turn of ${THREADS} threads`, async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const flash = parseFlashRouting(fs.readFileSync(path.join(CORPUS, "prawo-polskie-v2/SKILL.md"), "utf8"));
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(request) {
        calls.push(request);
        return { fullText: "Odpowiedź symulowana: sprawa wymaga dalszej analizy." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    const findings: Finding[] = [];
    let turns = 0;

    for (let thread = 0; thread < THREADS; thread += 1) {
      if (thread % SHARDS !== SHARD) continue;
      const next = random(thread + 1);
      const count = 1 + Math.floor(next() * 5);
      const users = [OPENINGS[Math.floor(next() * OPENINGS.length)]!];
      while (users.length < count) users.push(FOLLOW_UPS[Math.floor(next() * FOLLOW_UPS.length)]!);
      const history: string[] = [];
      for (const [turn, user] of users.entries()) {
        history.push(`Użytkownik: ${user}`);
        const query = history.join("\n\n");
        const threadUsers = users.slice(0, turn + 1).join("\n");
        const fail = (check: string) => findings.push({ thread, turn, check, query: threadUsers.slice(0, 300) });
        calls.length = 0;
        let result: any;
        try {
          result = await executor.execute({
            query,
            provider: "openai",
            model: "account/openai/default",
            primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
            modelSelectsSkills: true,
            mode: next() < 0.5 ? "LAIK" : "PRAWNIK"
          } as never);
        } catch (error) {
          fail(`exception: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        turns += 1;
        const prompt = calls.map((call) => call.systemPrompt).join("\n");
        const steps = new Map<string, string>((result.mandatoryPath?.steps ?? []).map((step: any) => [step.id, step.status]));
        const audit = JSON.stringify(result.audit ?? []);
        if (!calls.length) fail("provider not called");
        if (!String(result.answer ?? "").trim()) fail("empty answer");
        if (result.mandatoryPath) {
          for (const id of ["R-1", "R-2", "R-3", "R-4", "R-5"]) if (steps.get(id) !== "MET") fail(`${id} ${steps.get(id)}`);
        }
        if (criminalMatter(threadUsers)) {
          if (!prompt.includes("mod-KK-kwalifikator-karnomaterialny")) fail("criminal: qualifier missing");
          if (result.mandatoryPath?.profile !== "PELNY") fail(`criminal: profile ${result.mandatoryPath?.profile}`);
        }
        if (rankDomains(registry, flash, threadUsers).length && !prompt.includes("# DZIEDZINA I MODUŁ AKTU")) fail("domain hint missing");
        if (/"TASK_ROUTING"[^}]*"OK"/.test(audit) || audit.includes("TASK_ROUTING")) {
          const skill = /"skill":"([^"]+)"/.exec(audit.slice(audit.indexOf("TASK_ROUTING")))?.[1];
          if (skill && !prompt.includes(`# SKILL WYKONAWCZY WG ROUTERA: ${skill}`)) fail(`executive skill ${skill} not loaded`);
          if (skill && result.taskSkill !== skill) fail(`taskSkill ${result.taskSkill} != ${skill}`);
        }
        // A fake answer writes no CN/WYJ/REM blocks, so the gates rightly mark it; an unread
        // mandatory resource or router is the application's own omission.
        if (prompt.includes("TRYB ZDEGRADOWANY — ZASOBY NIEWCZYTANE")) fail("degraded: resources not read");
        if (/TRYB ZDEGRADOWANY[^\n]*(?:nie wczytano|router niewczytany)/u.test(String(result.answer))) fail("degraded: router or resource");
        if (!calls.some((call) => (call.tools ?? []).some((tool) => tool.function.name === "show_widget"))) fail("show_widget missing");
        if (turn > 0 && prompt.includes("etap późniejszy: aplikacja dołączy tę sekcję od drugiej tury")) fail("later-turn section withheld");
        history.push(`Asystent: ${result.answer}`);
      }
    }

    const summary = new Map<string, number>();
    for (const finding of findings) {
      const key = finding.check.replace(/ (?:LEKKI|undefined|MISSING|NOT_\w+)$/u, " <status>");
      summary.set(key, (summary.get(key) ?? 0) + 1);
    }
    if (process.env.LEX_SIM_REPORT) {
      fs.writeFileSync(
        process.env.LEX_SIM_REPORT,
        JSON.stringify({ turns, findings: findings.length, summary: Object.fromEntries(summary), sample: findings.slice(0, 200) }, null, 1)
      );
    }
    expect(turns).toBeGreaterThan(0);
    expect(Object.fromEntries(summary)).toEqual({});
  }, 3_600_000);
});
