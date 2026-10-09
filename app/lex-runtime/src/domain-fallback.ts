import fs from "node:fs";
import path from "node:path";
import type { ProviderGateway } from "./providers/gateway.js";
import type { ProviderId } from "./providers/types.js";
import type { LexSkillRegistry } from "./registry.js";

/**
 * Domain fallback (Settings, off by default): when no flash-routing phrase and no act
 * map names a domain, one short model call names one or two DR from their descriptions.
 * Measured 2026-10-09 on questions the rules left without a domain or with one of a
 * single word. No domain: the right one first — Bielik 11B v3 68%, Gemini flash-lite
 * 61%, Mistral NeMo 12B 48% (in the model's two: 73%, 94%, 68%). A word-named domain:
 * the rules are better (88-93% vs 55-78%), so the model is asked only when they named none.
 */
export type DomainFallbackChoice = "off" | "session" | "local/bielik-11b-v3-q4km" | "local/mistral-nemo-12b-q4km";
export const DOMAIN_FALLBACK_CHOICES: readonly DomainFallbackChoice[] = ["off", "session", "local/bielik-11b-v3-q4km", "local/mistral-nemo-12b-q4km"];

export type DomainFallbackTarget = { provider: ProviderId; model: string };

let settingsFile: string | null = null;

export function configureDomainFallback(dir: string | null): void {
  settingsFile = dir ? path.join(dir, "domain-fallback.json") : null;
}

export function domainFallbackChoice(): DomainFallbackChoice {
  if (!settingsFile) return "off";
  try {
    const value = (JSON.parse(fs.readFileSync(settingsFile, "utf8")) as { choice?: unknown }).choice;
    return DOMAIN_FALLBACK_CHOICES.includes(value as DomainFallbackChoice) ? (value as DomainFallbackChoice) : "off";
  } catch {
    return "off";
  }
}

export function setDomainFallbackChoice(choice: DomainFallbackChoice): void {
  if (!settingsFile) throw new Error("DOMAIN_FALLBACK_NOT_CONFIGURED");
  if (!DOMAIN_FALLBACK_CHOICES.includes(choice)) throw new Error("DOMAIN_FALLBACK_INVALID");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temporary = `${settingsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ choice }), "utf8");
  fs.renameSync(temporary, settingsFile);
}

/** The model of the choice: the turn's own model, or a local one (served as openai "local/…"). */
export function domainFallbackTarget(choice: DomainFallbackChoice, turn: DomainFallbackTarget): DomainFallbackTarget | null {
  if (choice === "off") return null;
  if (choice === "session") return turn;
  return { provider: "openai", model: choice };
}

function catalog(registry: LexSkillRegistry): Array<{ skill: string; line: string }> {
  return [...registry.skills.values()]
    .filter((skill) => /^dr-\d{2}-/.test(skill.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => {
      const description = typeof skill.frontmatter.description === "string" ? skill.frontmatter.description : skill.name;
      return { skill: skill.name, line: `${skill.name.slice(0, 5)}: ${description.slice(0, 220)}` };
    });
}

export function domainFallbackPrompt(registry: LexSkillRegistry): string {
  return [
    "Jesteś routerem dziedzin prawa polskiego. Dziedziny:",
    ...catalog(registry).map((item) => item.line),
    "",
    "Dla pytania użytkownika wskaż dziedzinę główną i ewentualnie jedną dodatkową, gdy sprawa naprawdę dotyczy dwóch. " +
      'Odpowiedz wyłącznie JSON: {"dr":["dr-NN"]} albo {"dr":["dr-NN","dr-NN"]}; {"dr":[]} gdy pytanie nie jest prawne.'
  ].join("\n");
}

/** "dr-NN" codes of the answer (JSON or not), at most two, as the registry's skill names. */
export function parseFallbackDomains(registry: LexSkillRegistry, answer: string): string[] {
  const names = catalog(registry).map((item) => item.skill);
  return [...new Set(answer.match(/dr-\d{2}/g) ?? [])]
    .map((code) => names.find((name) => name.startsWith(`${code}-`)))
    .filter((name): name is string => Boolean(name))
    .slice(0, 2);
}

/**
 * One short call; any failure (timeout, refusal, a local model not running) gives no
 * domain and never stops the turn. The text is the pseudonymized question.
 */
export async function fallbackDomains(
  gateway: ProviderGateway,
  registry: LexSkillRegistry,
  target: DomainFallbackTarget,
  text: string,
  timeoutMs = target.model.startsWith("local/") ? 60_000 : 20_000
): Promise<{ domains: string[]; error: string | null }> {
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
  } catch (error) {
    return { domains: [], error: error instanceof Error ? error.message.slice(0, 120) : "FALLBACK_FAILED" };
  }
}
