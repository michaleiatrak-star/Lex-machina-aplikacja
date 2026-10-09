import fs from "node:fs";
import path from "node:path";
export const DOMAIN_FALLBACK_CHOICES = ["off", "session", "local/bielik-11b-v3-q4km", "local/mistral-nemo-12b-q4km"];
let settingsFile = null;
export function configureDomainFallback(dir) {
    settingsFile = dir ? path.join(dir, "domain-fallback.json") : null;
}
export function domainFallbackChoice() {
    if (!settingsFile)
        return "off";
    try {
        const value = JSON.parse(fs.readFileSync(settingsFile, "utf8")).choice;
        return DOMAIN_FALLBACK_CHOICES.includes(value) ? value : "off";
    }
    catch {
        return "off";
    }
}
export function setDomainFallbackChoice(choice) {
    if (!settingsFile)
        throw new Error("DOMAIN_FALLBACK_NOT_CONFIGURED");
    if (!DOMAIN_FALLBACK_CHOICES.includes(choice))
        throw new Error("DOMAIN_FALLBACK_INVALID");
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    const temporary = `${settingsFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ choice }), "utf8");
    fs.renameSync(temporary, settingsFile);
}
/** The model of the choice: the turn's own model, or a local one (served as openai "local/…"). */
export function domainFallbackTarget(choice, turn) {
    if (choice === "off")
        return null;
    if (choice === "session")
        return turn;
    return { provider: "openai", model: choice };
}
function catalog(registry) {
    return [...registry.skills.values()]
        .filter((skill) => /^dr-\d{2}-/.test(skill.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((skill) => {
        const description = typeof skill.frontmatter.description === "string" ? skill.frontmatter.description : skill.name;
        return { skill: skill.name, line: `${skill.name.slice(0, 5)}: ${description.slice(0, 220)}` };
    });
}
export function domainFallbackPrompt(registry) {
    return [
        "Jesteś routerem dziedzin prawa polskiego. Dziedziny:",
        ...catalog(registry).map((item) => item.line),
        "",
        "Dla pytania użytkownika wskaż dziedzinę główną i ewentualnie jedną dodatkową, gdy sprawa naprawdę dotyczy dwóch. " +
            'Odpowiedz wyłącznie JSON: {"dr":["dr-NN"]} albo {"dr":["dr-NN","dr-NN"]}; {"dr":[]} gdy pytanie nie jest prawne.'
    ].join("\n");
}
/** "dr-NN" codes of the answer (JSON or not), at most two, as the registry's skill names. */
export function parseFallbackDomains(registry, answer) {
    const names = catalog(registry).map((item) => item.skill);
    return [...new Set(answer.match(/dr-\d{2}/g) ?? [])]
        .map((code) => names.find((name) => name.startsWith(`${code}-`)))
        .filter((name) => Boolean(name))
        .slice(0, 2);
}
/**
 * One short call; any failure (timeout, refusal, a local model not running) gives no
 * domain and never stops the turn. The text is the pseudonymized question.
 */
export async function fallbackDomains(gateway, registry, target, text, timeoutMs = target.model.startsWith("local/") ? 60_000 : 20_000) {
    try {
        const response = await gateway.stream(target.provider, {
            model: target.model,
            systemPrompt: domainFallbackPrompt(registry),
            messages: [{ role: "user", content: text.slice(0, 2_000) }],
            reasoning: "none",
            accountContinuity: "none",
            localMaxOutputTokens: 40,
            abortSignal: AbortSignal.timeout(timeoutMs)
        });
        return { domains: parseFallbackDomains(registry, response.fullText), error: null };
    }
    catch (error) {
        return { domains: [], error: error instanceof Error ? error.message.slice(0, 120) : "FALLBACK_FAILED" };
    }
}
