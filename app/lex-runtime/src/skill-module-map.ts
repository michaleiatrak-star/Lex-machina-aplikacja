import fs from "node:fs";
import path from "node:path";
import type { LexSkillRegistry } from "./registry.js";
import { draftingSchema, parseSchemaCatalog, type SchemaEntry } from "./skill-schema-catalog.js";

/**
 * Module maps of a skill read from its SKILL.md (sections such as "Moduły PRIMARY —
 * wczytaj na podstawie typu umowy", "W2.1 — Moduły do wczytania przed redakcją",
 * "KIEDY WCZYTAĆ REFERENCES/"): each entry is a module with the condition written
 * next to it and, when the section belongs to a stage (W1/W2/W3), that stage.
 * The application loads the entries that apply to this turn instead of leaving
 * the conditional modules to the model.
 */
export type ModuleEntry = {
  resource: string;
  condition: string;
  heading: string;
  stage: string | null;
  always: boolean;
};

const MAP_HEADING = /MODUŁ|MODUL|WCZYT|REFERENCES|LAZY|MAPA/iu;
// A path of another skill: an executive skill (…-v3, …-min90) or a domain skill (dr-02-…).
const RESOURCE = /(?:shared|references|modules|assets|templates)\/[A-Za-z0-9._\-/]+?\.md\b|(?:[a-z0-9-]+-v\d+(?:-min90)?|dr-\d{2}-[a-z0-9-]+)\/(?:references|modules)\/[A-Za-z0-9._\-/]+?\.md\b/g;
const STAGE = /\b(W[1-6])(?:\.\d+[a-z]?)?\b/u;
const STOP = new Set(["umowa", "umowy", "każdy", "każda", "wczytaj", "moduł", "ścieżka", "sprawa", "sprawy", "gdy", "przed", "pismo", "pisma", "zawsze", "obowiązkowe"]);

const cache = new Map<string, ModuleEntry[]>();

// "references/X.md" belongs to the skill; "shared/…", "…-v3/…" and "dr-02-…/…" are kept whole.
function corpusPath(skill: string, raw: string): string {
  return raw.startsWith("shared/") || raw.startsWith(`${skill}/`) || /^(?:[a-z0-9-]+-v\d+(?:-min90)?|dr-\d{2}-[a-z0-9-]+)\//u.test(raw) ? raw : `${skill}/${raw}`;
}

export function moduleMap(registry: LexSkillRegistry, skill: string): ModuleEntry[] {
  const record = registry.get(skill);
  if (!record) return [];
  let body: string;
  try {
    body = fs.readFileSync(record.skillFile, "utf8");
  } catch {
    return [];
  }
  const key = `${record.skillFile}:${body.length}`;
  if (cache.has(key)) return cache.get(key)!;
  const entries: ModuleEntry[] = [];
  let heading = "";
  let inMap = false;
  let mapLevel = 0;
  const lines = body.split("\n");
  for (const [index, line] of lines.entries()) {
    const title = /^(#{1,5})\s+(.*)$/.exec(line);
    if (title) {
      const level = title[1]!.length;
      if (inMap && level <= mapLevel && !MAP_HEADING.test(title[2]!)) inMap = false;
      if (MAP_HEADING.test(title[2]!)) {
        inMap = true;
        mapLevel = level;
      }
      heading = title[2]!.trim();
      continue;
    }
    if (!inMap) continue;
    for (const match of line.matchAll(RESOURCE)) {
      const raw = match[0];
      const resource = corpusPath(skill, raw);
      if (!registry.resolveResource(skill, resource)) continue;
      // Condition: the table's first cell, or the text around the path (and the
      // indented continuation lines of a code block entry).
      const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
      // A "when" column ("ZAWSZE przy...", "Gdy pismo...") belongs to the condition too.
      const when = cells.slice(1).filter((cell) => !cell.includes(raw) && /^(?:\*\*)?(?:ZAWSZE|zawsze|OBOWIĄZKOW|Gdy|gdy|Kiedy|Przy|Jeśli|jeśli)/u.test(cell));
      let condition = cells.length >= 3 ? [cells[0]!, ...when].join(" ") : line.replace(raw, " ").replace(/`|view|\*\*/g, " ");
      for (let next = index + 1; next < lines.length && /^\s{20,}\S/.test(lines[next]!) && !RESOURCE.test(lines[next]!); next += 1) {
        condition += ` ${lines[next]!.trim()}`;
      }
      RESOURCE.lastIndex = 0;
      condition = condition.replace(/\s+/g, " ").replace(/[()]/g, " ").trim();
      const stage = STAGE.exec(heading)?.[1] ?? null;
      // "zawsze" / "OBOWIĄZKOWE" ("ZAWSZE przy każdym piśmie" too); "OBOWIĄZKOWE gdy ..." stays conditional.
      entries.push({ resource, condition, heading, stage, always: /\bzawsze\b|ZAWSZE|OBOWIĄZKOW/iu.test(condition) && !/\bgdy\b/iu.test(condition) });
    }
  }
  entries.push(
    ...decisionTreeEntries(registry, skill, record.directory, lines),
    ...loadInstructions(registry, skill, lines, entries),
    ...stageModuleNames(registry, skill, lines)
  );
  // One entry per module and stage; "zawsze" anywhere in SKILL.md makes it always.
  const unique = entries
    .filter((entry, position) => entries.findIndex((other) => other.resource === entry.resource && other.stage === entry.stage) === position)
    .map((entry) => ({ ...entry, always: entries.some((other) => other.resource === entry.resource && other.stage === entry.stage && other.always) }));
  cache.set(key, unique);
  return unique;
}

// Module codes of the skill's files ("MD1-klasyfikacja.md" -> MD1, "MX-dziedziny.md" -> MX).
function moduleCodes(directory: string, skill: string): Map<string, string> {
  const codes = new Map<string, string>();
  for (const folder of ["modules", "references"]) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(path.join(directory, folder));
    } catch {
      continue;
    }
    for (const file of files) {
      const code = /^(M[A-Z]{0,2}\d{0,2}[a-z]?)-/u.exec(file)?.[1];
      if (code && file.endsWith(".md") && !codes.has(code)) codes.set(code, `${skill}/${folder}/${file}`);
    }
  }
  return codes;
}

/**
 * A diagnostic tree ("A1. <question>?  TAK -> dodaj: MD1, MD2"): each code the
 * answer adds is a module whose condition is the question.
 */
function decisionTreeEntries(registry: LexSkillRegistry, skill: string, directory: string, lines: string[]): ModuleEntry[] {
  const codes = moduleCodes(directory, skill);
  if (!codes.size) return [];
  const entries: ModuleEntry[] = [];
  let heading = "";
  let question: string[] = [];
  for (const line of lines) {
    const title = /^#{1,5}\s+(.*)$/.exec(line);
    if (title) {
      heading = title[1]!.trim();
      question = [];
      continue;
    }
    const item = /^\s*[A-Z]\d+[a-z]?\.\s+(.*)$/u.exec(line);
    if (item) question = [item[1]!];
    else if (question.length && !/TAK\s*→/u.test(line) && line.trim()) question.push(line.trim());
    const adds = /TAK\s*→\s*(?:dodaj|wczytaj)\s*:?\s*([^·(\n]*)/u.exec(line);
    if (!adds || !question.length) continue;
    for (const code of adds[1]!.match(/\bM[A-Z]{0,2}\d{0,2}[a-z]?\b/gu) ?? []) {
      const resource = codes.get(code);
      if (!resource || !registry.resolveResource(skill, resource)) continue;
      entries.push({ resource, condition: question.join(" ").replace(/\s+/g, " ").trim(), heading, stage: null, always: false });
    }
  }
  return entries;
}

// "→ wczytaj references/jezyk-klienta.md" outside the map sections: the line (and
// the one before it, for an arrow line) is the condition.
function loadInstructions(registry: LexSkillRegistry, skill: string, lines: string[], known: ModuleEntry[]): ModuleEntry[] {
  const entries: ModuleEntry[] = [];
  let heading = "";
  let skip = false;
  for (const [index, line] of lines.entries()) {
    const title = /^#{1,5}\s+(.*)$/.exec(line);
    if (title) {
      heading = title[1]!.trim();
      skip = /ADAPTER|CHANGELOG|PORTABILITY|HISTORIA/iu.test(heading);
      continue;
    }
    if (skip || !/\b(?:wczytaj|view)\b/iu.test(line)) continue;
    for (const match of line.matchAll(RESOURCE)) {
      const raw = match[0];
      const resource = corpusPath(skill, raw);
      if (!registry.resolveResource(skill, resource)) continue;
      // An arrow line belongs to the paragraph above it ("ZLE_WIADOMOSCI — gdy: ...").
      const above: string[] = [];
      for (let back = index - 1; /^\s*→/u.test(line) && back >= 0 && above.length < 6; back -= 1) {
        const previous = lines[back]!;
        if (!previous.trim() || /^\s*→/u.test(previous) || /^#/.test(previous)) break;
        above.unshift(previous.trim());
      }
      const condition = [...above, line]
        .join(" ")
        .replace(RESOURCE, " ")
        .replace(/`|view|wczytaj|\*\*|→/giu, " ")
        .replace(/\s+/g, " ")
        .trim();
      RESOURCE.lastIndex = 0;
      if (known.some((entry) => entry.resource === resource) && !/\bzawsze\b|ZAWSZE/u.test(condition)) continue;
      entries.push({ resource, condition, heading, stage: STAGE.exec(heading)?.[1] ?? null, always: /\bzawsze\b|ZAWSZE/u.test(condition) && !/\bgdy\b/iu.test(condition) });
    }
    RESOURCE.lastIndex = 0;
  }
  return entries;
}

/**
 * Shared modules named without a path inside a pipeline stage ("### W1.2b —
 * MOD-STRATEGIA-WYBOR (obligatoryjna ...)", "W1.6 (MOD-RED-TEAM-WLASNY)"): steps of
 * that stage, required in it unless the line makes them conditional.
 */
function stageModuleNames(registry: LexSkillRegistry, skill: string, lines: string[]): ModuleEntry[] {
  const entries: ModuleEntry[] = [];
  let heading = "";
  let stage: string | null = null;
  let skip = false;
  for (const line of lines) {
    const title = /^#{1,5}\s+(.*)$/.exec(line);
    if (title) {
      heading = title[1]!.trim();
      stage = STAGE.exec(heading)?.[1] ?? null;
      skip = /ADAPTER|CHANGELOG|PORTABILITY|HISTORIA ZMIAN/iu.test(heading);
    }
    if (!stage || skip) continue;
    for (const match of line.matchAll(/(?<![\w/-])(MOD-[A-Z0-9]+(?:-[A-Z0-9]+)*)(?![\w.-])/gu)) {
      const resource = `shared/${match[1]}.md`;
      if (!registry.resolveResource(skill, resource)) continue;
      const conditional = /\b(?:gdy|jeśli|jeżeli|opcjonaln\p{L}*)\b/iu.test(line);
      entries.push({
        resource,
        condition: line.replace(/[#`*]/g, " ").replace(/\s+/g, " ").trim(),
        heading,
        stage,
        always: !conditional
      });
    }
  }
  return entries;
}

// One group of variants per condition word ("najem" -> "naj", "najm").
function stems(text: string): RegExp[][] {
  return [...new Set(text.toLocaleLowerCase("pl").match(/\p{L}{5,}/gu) ?? [])]
    .filter((word) => !STOP.has(word))
    .map((word) => {
      // Long words lose more of their ending ("monitoringu" -> "monitor": monitorować).
      const base = word.slice(0, word.length >= 10 ? Math.max(5, word.length - 4) : Math.max(4, word.length - 2));
      // "najem" -> "najm" (najmu), "pozew" -> "pozw" (pozwu)
      const dropped = /e[a-ząćęłńóśźż]$/u.test(word) ? word.slice(0, -2) + word.slice(-1) : null;
      return [base, ...(dropped && dropped.length >= 4 ? [dropped] : [])].map(
        (stem) => new RegExp(`(?<![\\p{L}])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu")
      );
    });
}

/** Entries that apply: the stage (if any) and "always", or a condition the case text meets. */
export function triggeredModules(entries: ModuleEntry[], args: { text: string; stage?: string | null }): Array<ModuleEntry & { why: string }> {
  const result: Array<ModuleEntry & { why: string }> = [];
  for (const entry of entries) {
    if (entry.stage && entry.stage !== args.stage) continue;
    if (entry.always) {
      result.push({ ...entry, why: entry.stage ? `etap ${entry.stage}: zawsze` : "zawsze" });
      continue;
    }
    // A long condition needs two of its words in the case text, a short one one.
    // "gdy <trigger> — <explanation>": the trigger clause alone decides.
    const trigger = /\bgdy:?\s+([^—–;(]+)/iu.exec(entry.condition)?.[1];
    const conditionStems = stems(trigger ?? entry.condition);
    const hits = conditionStems.filter((variants) => variants.some((stem) => stem.test(args.text))).length;
    if (hits >= (!trigger && conditionStems.length >= 5 ? 2 : 1)) result.push({ ...entry, why: `warunek: ${entry.condition.slice(0, 80)}` });
  }
  return result.filter((entry, position) => result.findIndex((other) => other.resource === entry.resource) === position);
}

const catalogCache = new Map<string, SchemaEntry[]>();

/** The skill's schema catalogue ("SCHEMATY PISM"), empty when it has none. */
export function schemaCatalog(registry: LexSkillRegistry, skill: string): SchemaEntry[] {
  const record = registry.get(skill);
  if (!record) return [];
  let body: string;
  try {
    body = fs.readFileSync(record.skillFile, "utf8");
  } catch {
    return [];
  }
  const key = `${record.skillFile}:${body.length}`;
  if (!catalogCache.has(key)) {
    catalogCache.set(
      key,
      parseSchemaCatalog(body, skill).map((entry) => ({
        ...entry,
        resources: entry.resources.filter((resource) => registry.resolveResource(skill, resource))
      }))
    );
  }
  return catalogCache.get(key)!;
}

/** The modules this turn needs: the one schema the request names, then the module map's. */
export function skillModules(
  registry: LexSkillRegistry,
  skill: string,
  args: { text: string; stage?: string | null }
): Array<ModuleEntry & { why: string }> {
  const schema = draftingSchema(schemaCatalog(registry, skill), args.text);
  const fromSchema = (schema?.resources ?? []).map((resource) => ({
    resource,
    condition: schema!.label,
    heading: "SCHEMATY",
    stage: null,
    always: false,
    why: schema!.why
  }));
  const rest = triggeredModules(moduleMap(registry, skill), args).filter((entry) => !fromSchema.some((item) => item.resource === entry.resource));
  return [...fromSchema, ...rest];
}

export const MODULE_BUDGET_CHARS = 40_000;

/** Loads the triggered modules within the budget; the rest the model reads itself. */
export function loadModules(
  registry: LexSkillRegistry,
  skill: string,
  modules: Array<ModuleEntry & { why: string }>,
  inContext: ReadonlySet<string>,
  budget = MODULE_BUDGET_CHARS
): { loaded: Array<{ resource: string; why: string; content: string }>; toRead: Array<{ resource: string; why: string }> } {
  const loaded: Array<{ resource: string; why: string; content: string }> = [];
  const toRead: Array<{ resource: string; why: string }> = [];
  let left = budget;
  for (const module of modules) {
    if (inContext.has(module.resource)) continue;
    const file = registry.resolveResource(skill, module.resource);
    let content = "";
    try {
      content = file ? fs.readFileSync(file, "utf8") : "";
    } catch {
      content = "";
    }
    if (!content.trim()) continue;
    if (content.length > left) {
      toRead.push({ resource: module.resource, why: module.why });
      continue;
    }
    left -= content.length;
    loaded.push({ resource: module.resource, why: module.why, content });
  }
  return { loaded, toRead };
}

export function modulesPrompt(skill: string, result: ReturnType<typeof loadModules>): string {
  return [
    `# MODUŁY SKILLA ${skill} WYZWOLONE W TEJ SPRAWIE (aplikacja, z mapy modułów w SKILL.md)`,
    ...result.loaded.map((item) => `- ${item.resource} — ${item.why} (wczytany poniżej)`),
    ...result.toRead.map((item) => `- ${item.resource} — ${item.why} (wczytaj sam narzędziem korpusu; aplikacja to sprawdza)`),
    "Pozostałe moduły z mapy wczytuj, gdy ich warunek pojawi się w toku pracy.",
    ...result.loaded.map((item) => `## MODUŁ: ${item.resource}\n\n${item.content}`)
  ].join("\n\n");
}
