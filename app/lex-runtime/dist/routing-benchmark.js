import fs from "node:fs";
import path from "node:path";
import { parseFlashRouting, rankDomains } from "./domain-module-map.js";
import { isTrivialChatCommand } from "./execution-engine.js";
import { criminalMatter } from "./matter-signals.js";
import { LexSkillRegistry } from "./registry.js";
import { laterTurn } from "./skill-sections.js";
import { latestUserTurn, threadUserText } from "./skill-selection.js";
import { schemaCatalog } from "./skill-module-map.js";
import { decideTask, parseActivationMatrix, parseRedactionTest, parseRoutingTable } from "./task-routing.js";
import { isNonLegalMessage } from "./turn-gate.js";
import { buildAccentMap, restoreAccents } from "./accent-restoration.js";
import { executiveSkillTexts } from "./accent-restoration-corpus.js";
export class TurnRouter {
    registry;
    flash;
    routes;
    matrix;
    redaction;
    simple;
    accents;
    constructor(corpusRoot) {
        const read = (file) => fs.readFileSync(path.join(corpusRoot, file), "utf8");
        this.registry = new LexSkillRegistry(corpusRoot);
        this.registry.scan();
        this.flash = parseFlashRouting(read("prawo-polskie-v2/SKILL.md"));
        this.routes = parseRoutingTable(read("prawny-router-v3/SKILL.md"));
        this.matrix = parseActivationMatrix(read("shared/ACTIVATION-MATRIX.md"));
        this.redaction = parseRedactionTest(read("pisma-procesowe-v3/SKILL.md"));
        this.simple = { skill: "pisma-proste-v2", entries: schemaCatalog(this.registry, "pisma-proste-v2") };
        this.accents = buildAccentMap(executiveSkillTexts(this.registry));
    }
    route(query) {
        const latest = latestUserTurn(query);
        const trivial = isTrivialChatCommand(query);
        const legal = !trivial && !isNonLegalMessage(query, this.flash);
        if (!legal)
            return { legal, trivial, domains: [], criminal: false, executive: null };
        const own = rankDomains(this.registry, this.flash, latest);
        const domains = (own.length || !laterTurn(query) ? own : rankDomains(this.registry, this.flash, [threadUserText(query), latest].join("\n"))).map((domain) => domain.skill);
        const criminal = criminalMatter(latest) || criminalMatter(threadUserText(query));
        const executive = decideTask(this.routes, this.matrix, restoreAccents(latest, this.accents), [], this.redaction, this.simple)?.primary ?? null;
        return { legal, trivial, domains, criminal, executive };
    }
}
const bucket = () => ({ total: 0, ok: 0 });
const tally = (target, ok) => {
    target.total += 1;
    if (ok)
        target.ok += 1;
};
export function runRoutingBenchmark(router, cases) {
    const report = {
        total: cases.length,
        legalGate: { nonLegalLoadedSkills: bucket(), legalSkipped: bucket(), trivialSkipped: bucket() },
        domainTop1: bucket(),
        domainTop2: bucket(),
        domainByDr: {},
        domainByVariant: {},
        executive: bucket(),
        executiveBySkill: {},
        criminal: { truePositive: bucket(), falsePositive: bucket() },
        failures: [],
        msPerMessage: 0
    };
    const started = performance.now();
    for (const item of cases) {
        const got = router.route(item.q);
        const fail = (expected, value) => report.failures.push({ q: item.q, expected, got: value, kind: item.kind, ...(item.variant ? { variant: item.variant } : {}) });
        if (item.kind === "trivial") {
            tally(report.legalGate.trivialSkipped, !got.legal);
            if (got.legal)
                fail("bez skilli (trywialne)", "prawne");
            continue;
        }
        if (!item.legal) {
            // "ok" = no legal skills loaded for a message with no legal matter.
            tally(report.legalGate.nonLegalLoadedSkills, !got.legal);
            if (got.legal)
                fail("bez skilli (nieprawne)", `prawne ${got.domains[0] ?? "bez DR"}`);
            continue;
        }
        tally(report.legalGate.legalSkipped, got.legal);
        if (!got.legal) {
            fail("prawne", "pominięte jako nieprawne");
            continue;
        }
        if (item.dr) {
            const top = got.domains[0]?.slice(0, 5) ?? null;
            const ok = top === item.dr;
            tally(report.domainTop1, ok);
            tally(report.domainTop2, got.domains.slice(0, 2).some((name) => name.startsWith(item.dr)));
            tally((report.domainByDr[item.dr] ??= bucket()), ok);
            tally((report.domainByVariant[item.variant ?? "-"] ??= bucket()), ok);
            if (!ok)
                fail(item.dr, got.domains.map((name) => name.slice(0, 5)).join(",") || "brak DR");
        }
        if (item.skill !== undefined) {
            const ok = got.executive === (item.skill ?? null);
            tally(report.executive, ok);
            tally((report.executiveBySkill[item.skill ?? "brak"] ??= bucket()), ok);
            if (!ok)
                fail(`wykonawczy ${item.skill ?? "brak"}`, got.executive ?? "brak");
        }
        if (item.criminal === true)
            tally(report.criminal.truePositive, got.criminal);
        if (item.criminal === false && item.dr !== null)
            tally(report.criminal.falsePositive, !got.criminal);
    }
    report.msPerMessage = (performance.now() - started) / Math.max(cases.length, 1);
    return report;
}
const pct = (value) => (value.total ? `${((100 * value.ok) / value.total).toFixed(1)}% (${value.ok}/${value.total})` : "-");
export function formatRoutingReport(report) {
    return [
        `Wiadomości: ${report.total}; ${report.msPerMessage.toFixed(2)} ms/wiadomość`,
        `Bramka prawne/nieprawne:`,
        `  nieprawne bez skilli:   ${pct(report.legalGate.nonLegalLoadedSkills)}`,
        `  trywialne bez skilli:   ${pct(report.legalGate.trivialSkipped)}`,
        `  prawne nie pominięte:   ${pct(report.legalGate.legalSkipped)}`,
        `DR top-1: ${pct(report.domainTop1)}; DR w top-2: ${pct(report.domainTop2)}`,
        ...Object.entries(report.domainByDr).sort().map(([dr, value]) => `  ${dr}: ${pct(value)}`),
        `DR wg wariantu zapisu:`,
        ...Object.entries(report.domainByVariant).sort().map(([variant, value]) => `  ${variant}: ${pct(value)}`),
        `Skill wykonawczy: ${pct(report.executive)}`,
        ...Object.entries(report.executiveBySkill).sort().map(([skill, value]) => `  ${skill}: ${pct(value)}`),
        `Kwalifikator karny: wykryte sprawy karne ${pct(report.criminal.truePositive)}; brak fałszywych w niekarnych ${pct(report.criminal.falsePositive)}`
    ].join("\n");
}
