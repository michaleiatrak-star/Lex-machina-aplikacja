import fs from "node:fs";
import type { LexSkillRegistry } from "./registry.js";

/**
 * Contract of an executive skill read from its own SKILL.md: the sections it
 * declares mandatory (HARD GATE, OBOWIĄZKOWE, ⛔, BRAMKA, -GATE, KROK 0, ZAWSZE)
 * in their order, and the resources those sections tell to load. Derived from
 * the corpus on every skill update, never hand-copied into code.
 */
export type ExecutiveGate = { title: string; resources: string[] };
export type ExecutiveContract = { skill: string; gates: ExecutiveGate[]; resources: string[] };

const GATE_HEADING = /HARD GATE|OBOWIĄZ|⛔|BRAMK|-GATE\b|KROK 0\b|ZAWSZE|SEKWENCJ/iu;
const RESOURCE = /(?:shared|references|modules|assets|templates)\/[A-Za-z0-9._\-/]+?\.md\b/g;

const cache = new Map<string, ExecutiveContract | null>();

export function executiveContract(registry: LexSkillRegistry, skill: string): ExecutiveContract | null {
  const record = registry.get(skill);
  if (!record) return null;
  let body: string;
  try {
    body = fs.readFileSync(record.skillFile, "utf8");
  } catch {
    return null;
  }
  const key = `${record.skillFile}:${body.length}`;
  if (cache.has(key)) return cache.get(key)!;
  const gates: ExecutiveGate[] = [];
  let current: { title: string; level: number; resources: Set<string> } | null = null;
  const close = () => {
    if (current) gates.push({ title: current.title, resources: [...current.resources] });
    current = null;
  };
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      if (current && heading[1]!.length <= (current as { level: number }).level) close();
      if (!current && GATE_HEADING.test(heading[2]!)) {
        current = { title: heading[2]!.replace(/⛔/gu, "").replace(/\s+/g, " ").trim(), level: heading[1]!.length, resources: new Set() };
      }
      continue;
    }
    if (current) for (const match of line.matchAll(RESOURCE)) (current as { resources: Set<string> }).resources.add(match[0]);
  }
  close();
  // Canonical corpus paths ("shared/X.md", "<skill>/references/X.md"), only those
  // that exist (a stale reference is not a contract).
  const canonical = (resource: string) => (resource.startsWith("shared/") ? resource : `${skill}/${resource}`);
  for (const gate of gates) gate.resources = gate.resources.map(canonical);
  const resources = [...new Set(gates.flatMap((gate) => gate.resources))].filter((resource) => registry.resolveResource(skill, resource));
  const contract: ExecutiveContract = {
    skill,
    gates: gates.map((gate) => ({ ...gate, resources: gate.resources.filter((resource) => resources.includes(resource)) })),
    resources
  };
  cache.set(key, contract);
  return contract;
}

// Characters of contract resources the application puts in the context per turn;
// the rest the model reads itself (and the register checks that it did).
export const CONTRACT_BUDGET_CHARS = 120_000;
const MAX_RESOURCE_CHARS = 40_000;

export type LoadedContract = {
  contract: ExecutiveContract;
  loaded: Array<{ resource: string; content: string }>;
  // Too large for the budget: the model reads these with the corpus tools.
  toRead: string[];
};

/** Loads the contract resources (plus extra required ones) within the budget. */
export function loadContract(
  registry: LexSkillRegistry,
  contract: ExecutiveContract,
  options: { extra?: readonly string[]; inContext?: ReadonlySet<string>; budget?: number } = {}
): LoadedContract {
  const loaded: LoadedContract["loaded"] = [];
  const toRead: string[] = [];
  let budget = options.budget ?? CONTRACT_BUDGET_CHARS;
  for (const resource of [...new Set([...(options.extra ?? []), ...contract.resources])]) {
    if (options.inContext?.has(resource)) continue;
    const file = registry.resolveResource(contract.skill, resource);
    let content = "";
    try {
      content = file ? fs.readFileSync(file, "utf8") : "";
    } catch {
      content = "";
    }
    if (!content.trim()) continue;
    if (content.length > MAX_RESOURCE_CHARS || content.length > budget) {
      toRead.push(resource);
      continue;
    }
    budget -= content.length;
    loaded.push({ resource, content });
  }
  return { contract, loaded, toRead };
}

/** What the model is told: the skill's mandatory gates in order and what the app loaded. */
export function contractPrompt(loaded: LoadedContract): string {
  const { contract } = loaded;
  return [
    `# KONTRAKT SKILLA WYKONAWCZEGO: ${contract.skill} (ustalony przez aplikację z jego SKILL.md)`,
    "Bramki i kroki obowiązkowe skilla, w kolejności z SKILL.md — wykonaj każdy, widocznie, zanim przejdziesz dalej:",
    ...contract.gates.map((gate, index) => `${index + 1}. ${gate.title}`),
    loaded.loaded.length
      ? `Zasoby tych bramek wczytała aplikacja (poniżej, nie otwieraj ich ponownie): ${loaded.loaded.map((item) => item.resource).join(", ")}.`
      : "",
    loaded.toRead.length
      ? `Zasoby zbyt duże do wczytania z góry — wczytaj je sam narzędziem korpusu przed bramką, która ich wymaga (aplikacja to sprawdza): ${loaded.toRead.join(", ")}.`
      : "",
    ...loaded.loaded.map((item) => `## ZASÓB KONTRAKTU: ${contract.skill}/${item.resource}\n\n${item.content}`)
  ]
    .filter(Boolean)
    .join("\n\n");
}
