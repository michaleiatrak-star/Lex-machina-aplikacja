/**
 * Routing of full case descriptions (kazusy): legal gate, DR, second DR of a matter of
 * two domains, executive skill, criminal qualifier, and resistance to instructions in
 * the message that try to steer them. Accuracy from the application's own AUTO routing
 * (TurnRouter) and, with --executor, from the session executor itself (simulated model,
 * no network), with the time of each.
 *
 * tsx src/benchmark-cases.ts --cases tests/fixtures/cases-1000.json [--executor] [--out report.json]
 */
import fs from "node:fs";
import path from "node:path";
import { ProviderGateway, ProviderRegistry } from "./providers/gateway.js";
import { LexSkillRegistry } from "./registry.js";
import { TurnRouter } from "./routing-benchmark.js";
import { SafeSessionExecutor } from "./session-executor.js";
const bucket = () => ({ total: 0, ok: 0 });
const tally = (target, ok) => {
    target.total += 1;
    if (ok)
        target.ok += 1;
};
const pct = (value) => (value.total ? `${((100 * value.ok) / value.total).toFixed(1)}% (${value.ok}/${value.total})` : "-");
export function check(item, got) {
    if (!item.legal)
        return { gate: !got.legal, dr: null, drAccepted: null, dr2: null, executive: null, criminal: null };
    if (!got.legal)
        return { gate: false, dr: false, drAccepted: false, dr2: item.dr2 ? false : null, executive: false, criminal: item.criminal ? false : null };
    const top = got.domains[0]?.slice(0, 5) ?? null;
    return {
        gate: true,
        dr: item.dr ? top === item.dr : null,
        drAccepted: item.dr ? top === item.dr || (top !== null && (item.alt ?? []).includes(top)) : null,
        dr2: item.dr2 ? got.domains.slice(0, 3).some((name) => name.startsWith(item.dr2)) : null,
        executive: got.executive === item.skill,
        criminal: got.criminal === null ? null : got.criminal === item.criminal
    };
}
const passed = (value) => value.gate && value.drAccepted !== false && value.dr2 !== false && value.executive !== false && value.criminal !== false;
const quantile = (values, q) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};
export function report(cases, outcomes, times) {
    const result = {
        cases: cases.length,
        gate: { nonLegalSkipped: bucket(), legalKept: bucket() },
        drTop1: bucket(),
        drAccepted: bucket(),
        drTop2: bucket(),
        dr2InTop3: bucket(),
        executive: bucket(),
        criminal: { detected: bucket(), noFalse: bucket() },
        fullyCorrect: bucket(),
        byKind: {},
        byDr: {},
        byExecutive: {},
        byAttack: {},
        ms: {
            mean: times.reduce((sum, value) => sum + value, 0) / Math.max(times.length, 1),
            p50: quantile(times, 0.5),
            p95: quantile(times, 0.95),
            max: Math.max(0, ...times)
        },
        failures: []
    };
    cases.forEach((item, index) => {
        const got = outcomes[index];
        const value = check(item, got);
        tally(item.legal ? result.gate.legalKept : result.gate.nonLegalSkipped, value.gate);
        if (value.dr !== null) {
            tally(result.drTop1, value.dr);
            tally(result.drAccepted, value.drAccepted);
            tally(result.drTop2, got.domains.slice(0, 2).some((name) => name.startsWith(item.dr)));
            tally((result.byDr[item.dr] ??= bucket()), value.drAccepted);
        }
        if (value.dr2 !== null)
            tally(result.dr2InTop3, value.dr2);
        if (value.executive !== null) {
            tally(result.executive, value.executive);
            tally((result.byExecutive[item.skill ?? "brak"] ??= bucket()), value.executive);
        }
        if (value.criminal !== null)
            tally(item.criminal ? result.criminal.detected : result.criminal.noFalse, value.criminal);
        const ok = passed(value);
        tally(result.fullyCorrect, ok);
        tally((result.byKind[item.kind] ??= bucket()), ok);
        if (item.attack)
            tally((result.byAttack[String(item.attack)] ??= bucket()), ok);
        if (!ok) {
            const what = Object.entries(value)
                .filter(([key, verdict]) => verdict === false && key !== "dr")
                .map(([key]) => key);
            result.failures.push({
                id: item.id,
                kind: item.kind,
                what,
                expected: `${item.legal ? "prawne" : "nieprawne"} ${item.dr ?? "-"}${item.alt?.length ? `|${item.alt.join("|")}` : ""}${item.dr2 ? `+${item.dr2}` : ""} ${item.skill ?? "brak"}${item.criminal ? " karne" : ""}`,
                got: `${got.legal ? "prawne" : "nieprawne"} ${got.domains.map((name) => name.slice(0, 5)).join(",") || "-"} ${got.executive ?? "brak"}${got.criminal ? " karne" : ""}`
            });
        }
    });
    return result;
}
export function formatReport(title, value) {
    return [
        `## ${title}`,
        `Kazusy: ${value.cases}; w pełni poprawne: ${pct(value.fullyCorrect)}`,
        `Bramka: nieprawne bez skilli ${pct(value.gate.nonLegalSkipped)}; prawne nie pominięte ${pct(value.gate.legalKept)}`,
        `DR top-1: ${pct(value.drTop1)}; top-1 przyjęty (dr lub alt): ${pct(value.drAccepted)}; w top-2: ${pct(value.drTop2)}`,
        `Druga dziedzina sprawy w top-3: ${pct(value.dr2InTop3)}`,
        `Skill wykonawczy: ${pct(value.executive)}`,
        `Kwalifikator karny: wykryty ${pct(value.criminal.detected)}; bez fałszywego ${pct(value.criminal.noFalse)}`,
        `Wg rodzaju: ${Object.entries(value.byKind).map(([kind, item]) => `${kind} ${pct(item)}`).join("; ")}`,
        `Manipulacje wg typu: ${Object.entries(value.byAttack).map(([kind, item]) => `${kind}: ${pct(item)}`).join("; ")}`,
        `DR (przyjęty): ${Object.entries(value.byDr).sort().map(([dr, item]) => `${dr} ${pct(item)}`).join("; ")}`,
        `Skill: ${Object.entries(value.byExecutive).sort().map(([skill, item]) => `${skill} ${pct(item)}`).join("; ")}`,
        `Czas [ms]: średnio ${value.ms.mean.toFixed(2)}, p50 ${value.ms.p50.toFixed(2)}, p95 ${value.ms.p95.toFixed(2)}, max ${value.ms.max.toFixed(2)}`
    ].join("\n");
}
function routerOutcome(got) {
    return { legal: got.legal, domains: got.domains, executive: got.executive, criminal: got.criminal };
}
const DR_HINT = /# DZIEDZINA I MODUŁ AKTU — WSKAZÓWKA APLIKACJI[\s\S]*?(?=\n# |$)/u;
/** The executor's turn with a simulated model: what the application loaded and sent. */
export async function executorOutcomes(corpus, cases) {
    const registry = new LexSkillRegistry(corpus);
    registry.scan();
    let prompt = "";
    const providers = new ProviderRegistry();
    providers.register({
        id: "openai",
        label: "sim",
        capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
        async stream(request) {
            prompt ||= request.systemPrompt ?? "";
            return { fullText: "Odpowiedź symulowana." };
        }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    const outcomes = [];
    const times = [];
    for (const item of cases) {
        prompt = "";
        const started = performance.now();
        const result = await executor.execute({
            query: `Użytkownik: ${item.q}`,
            provider: "openai",
            model: "account/openai/default",
            primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
            modelSelectsSkills: true,
            mode: "PRAWNIK"
        });
        times.push(performance.now() - started);
        const hint = DR_HINT.exec(prompt)?.[0] ?? "";
        const domains = [...new Set([...hint.matchAll(/^- (dr-\d{2}-[a-z0-9-]+):/gmu)].map((match) => match[1]))];
        const loaded = result.loadedSkills ?? [];
        outcomes.push({
            legal: loaded.length > 0 || domains.length > 0 || Boolean(result.taskSkill),
            domains,
            executive: result.taskSkill ?? null,
            criminal: null
        });
    }
    return { outcomes, times };
}
async function main() {
    const arg = (name) => {
        const index = process.argv.indexOf(`--${name}`);
        return index >= 0 ? process.argv[index + 1] : undefined;
    };
    const corpus = path.resolve(arg("corpus") ?? path.join(process.cwd(), "../../Wersja rozwojowa rozpakowana"));
    const cases = JSON.parse(fs.readFileSync(arg("cases") ?? "tests/fixtures/cases-1000.json", "utf8"));
    const router = new TurnRouter(corpus);
    const outcomes = [];
    const times = [];
    for (const item of cases) {
        const started = performance.now();
        const got = router.route(item.q);
        times.push(performance.now() - started);
        outcomes.push(routerOutcome(got));
    }
    const routed = report(cases, outcomes, times);
    const out = { router: routed };
    console.log(formatReport("Routing aplikacji (TurnRouter)", routed));
    if (process.argv.includes("--executor")) {
        const run = await executorOutcomes(corpus, cases);
        out.executor = report(cases, run.outcomes, run.times);
        console.log(`\n${formatReport("Wykonawca sesji (model symulowany)", out.executor)}`);
    }
    const target = arg("out");
    if (target)
        fs.writeFileSync(target, JSON.stringify(out, null, 1));
}
if (process.argv[1]?.endsWith("benchmark-cases.ts")) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
