import fs from "node:fs";
import path from "node:path";
import { provisionsForDetection } from "./legal-act-abbreviations.js";
import type { LexSkillRegistry } from "./registry.js";

/**
 * prawo-polskie-v2: "DR-skill właściwy -> moduł aktu prawnego". The domain comes
 * from its "Routing błyskawiczny" table; the act module from the domain's
 * MAPA-AKTOW.md ("Akt / zakres | ... | Moduł | Status"). Both are suggestions the
 * application computes from the case text: the model still decides and says so
 * when the case points elsewhere.
 */

export type FlashRoute = { skill: string; phrases: string[] };
export type ActEntry = { scope: string; resources: string[] };

// Lowercase without diacritics: module names are ASCII ("zasilek-pogrzebowy").
export function fold(text: string): string {
  return text
    .toLocaleLowerCase("pl")
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

const STOP = new Set([
  "ustawa", "ustawy", "ustawie", "akt", "aktu", "akty", "zakres", "przepisy", "przepisow", "przepis", "prawo", "prawa",
  "modul", "current", "state", "uzupelnienie", "pokrycia", "routing", "inne", "pozostale", "dzial", "rozdzial", "rozdzialy",
  "oraz", "albo", "przez", "jako", "dotyczy", "wlasciwe", "wlasciwy", "biezace", "aktualne", "brzmienie", "indeks", "calego",
  "framework", "rodzina", "modulow", "lub", "dla", "the", "and", "nowe", "nowy", "zmiany", "przyp", "jw",
  "czy", "sie", "po", "za", "mi", "jak", "nie", "do", "od", "na", "ze", "co", "to", "gdy", "kiedy", "jest", "oraz"
]);

// Words of four letters and more, and abbreviations written in capitals (KP, ZUS, VAT).
function words(text: string): string[] {
  return [
    ...new Set(
      (text.match(/[\p{L}0-9]{2,}/gu) ?? [])
        .filter((word) => word.length >= 4 || /^[\p{Lu}]{2,}$/u.test(word))
        .map(fold)
        .filter((word) => !STOP.has(word) && !/^\d+$/.test(word) && !/^(?:prze|przy|przez|przed)$/.test(word))
    )
  ];
}

// A short word (an abbreviation: KP, ZUS, RODO) matches whole; a longer one by its stem.
function stemOf(word: string): string {
  return word.length <= 4 ? `=${word}` : word.slice(0, Math.max(4, word.length - 2));
}

function hit(stem: string, tokens: string[]): boolean {
  return stem.startsWith("=") ? tokens.includes(stem.slice(1)) : tokens.some((token) => token.startsWith(stem));
}

// What a module says it covers: its headings and its "Zakres:" paragraph.
function moduleHead(file: string | null): string {
  if (!file) return "";
  let head = "";
  try {
    head = fs.readFileSync(file, "utf8").slice(0, 2_500);
  } catch {
    return "";
  }
  const headings = head
    .split("\n")
    .filter((line) => /^#{1,3}\s/.test(line) && !/HARD GATE|ALERT|ZAKAZ|CZYTAJ|CHANGELOG|STATUS/iu.test(line))
    .map((line) => line.replace(/^#+\s*/, "").replace(/\.md\b/g, ""));
  const scope = /\*\*Zakres:?\*\*:?\s*([\s\S]{0,400}?)(?:\n\s*\n|$)/u.exec(head)?.[1] ?? "";
  return [...headings, scope.replace(/\(art[^)]*\)/g, " ")].join(" ");
}

function tokens(text: string): string[] {
  return fold(provisionsForDetection(text)).match(/[a-z0-9]{2,}/g) ?? [];
}

export function parseFlashRouting(markdown: string): FlashRoute[] {
  const section = /## Routing błyskawiczny[\s\S]*?(?=\n## |$)/u.exec(markdown)?.[0] ?? "";
  const rows: FlashRoute[] = [];
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const skill = /`(dr-\d{2}-[^`]+)`/u.exec(cells[2] ?? "")?.[1];
    if (!skill) continue;
    rows.push({ skill: skill.toLowerCase(), phrases: cells[1]!.split(",").map((phrase) => phrase.trim()).filter(Boolean) });
  }
  return rows;
}

/** Domains whose flash-routing phrases the text contains, best first. */
export function flashDomains(rows: FlashRoute[], text: string): Array<{ skill: string; matched: string[] }> {
  const have = tokens(text);
  return rows
    .map((row) => ({
      skill: row.skill,
      matched: row.phrases.filter((phrase) => {
        const stems = words(phrase).map(stemOf);
        return stems.length > 0 && stems.every((stem) => hit(stem, have));
      })
    }))
    .filter((row) => row.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length);
}

export function parseActMap(markdown: string, skill: string): ActEntry[] {
  const entries: ActEntry[] = [];
  let moduleColumn = -1;
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) {
      moduleColumn = -1;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const header = cells.findIndex((cell) => /^Moduł/u.test(cell));
    if (header >= 0) {
      moduleColumn = header;
      continue;
    }
    if (moduleColumn < 0 || /^:?-+/.test(cells[0] ?? "")) continue;
    const cell = cells[moduleColumn] ?? "";
    const resources = [
      ...cell.matchAll(/`((?:dr-\d{2}-[a-z0-9-]+\/modules\/)?mod-[A-Za-z0-9._-]+?)(?:\.md)?`/g)
    ].map((match) => (match[1]!.startsWith("dr-") ? `${match[1]}.md` : `${skill}/modules/${match[1]}.md`));
    if (resources.length) entries.push({ scope: cells[0]!.replace(/\*\*/g, ""), resources });
  }
  return entries;
}

// A module named without its domain ("mod-KPA-..." in DR-04's map lives in DR-05).
export function locate(registry: LexSkillRegistry, skill: string, resource: string): string | null {
  if (registry.resolveResource(skill, resource)) return resource;
  const name = path.basename(resource);
  for (const other of registry.skills.values()) {
    if (!other.name.startsWith("dr-") || other.name === skill) continue;
    const candidate = `${other.name}/modules/${name}`;
    if (registry.resolveResource(other.name, candidate)) return candidate;
  }
  return null;
}

type Indexed = { entry: ActEntry; stems: string[] };
const cache = new Map<string, { index: Indexed[]; df: Map<string, number> }>();

function actIndex(registry: LexSkillRegistry, skill: string): { index: Indexed[]; df: Map<string, number> } {
  const record = registry.get(skill);
  if (!record) return { index: [], df: new Map() };
  const file = path.join(record.directory, "MAPA-AKTOW.md");
  let body = "";
  try {
    body = fs.readFileSync(file, "utf8");
  } catch {
    return { index: [], df: new Map() };
  }
  const key = `${file}:${body.length}`;
  if (cache.has(key)) return cache.get(key)!;
  const mapped = parseActMap(body, skill)
    .map((entry) => ({ ...entry, resources: entry.resources.map((resource) => locate(registry, skill, resource)).filter((resource): resource is string => resource !== null) }))
    .filter((entry) => entry.resources.length > 0);
  // Modules of the domain the act map does not list: indexed by their own headings
  // and "Zakres:", marked as such (they cannot be suggested otherwise).
  const listed = new Set(mapped.flatMap((entry) => entry.resources));
  let files: string[] = [];
  try {
    files = fs.readdirSync(path.join(record.directory, "modules")).filter((file) => /^mod-.*\.md$/.test(file));
  } catch {
    files = [];
  }
  const unlisted = files
    .map((file) => `${skill}/modules/${file}`)
    .filter((resource) => !listed.has(resource))
    .map((resource) => ({ scope: `poza MAPA-AKTOW: ${path.basename(resource, ".md").replace(/^mod-/, "")}`, resources: [resource] }));
  const index = [...mapped, ...unlisted]
    .map((entry) => {
      // What the module is about: the act or scope, and the module's own name.
      const names = entry.resources.map((resource) => path.basename(resource, ".md").replace(/^mod-/, "").replace(/-/g, " "));
      const heads = entry.resources.map((resource) => moduleHead(registry.resolveResource(resource.split("/")[0]!, resource)));
      return { entry, stems: [...new Set(words([entry.scope, ...names, ...heads].join(" ")).map(stemOf))] };
    });
  const df = new Map<string, number>();
  for (const item of index) for (const stem of item.stems) df.set(stem, (df.get(stem) ?? 0) + 1);
  const value = { index, df };
  cache.set(key, value);
  return value;
}

export type DomainModule = { resource: string; why: string; score: number; matched: string[] };

/** The domain's act modules the case text points to (rarer words weigh more). */
export function suggestDomainModules(registry: LexSkillRegistry, skill: string, text: string, limit = 3): DomainModule[] {
  const { index, df } = actIndex(registry, skill);
  const have = tokens(text);
  const scored = index
    .map((item) => {
      const matched = item.stems.filter((stem) => hit(stem, have));
      const score = matched.reduce((sum, stem) => sum + 1 / (df.get(stem) ?? 1), 0);
      return { item, matched, score };
    })
    // One specific word (in at most two rows) or two common ones.
    // A specific word (in at most two rows): a long one alone, a short stem only with another word.
    .filter(
      (row) =>
        row.score >= 0.5 &&
        row.matched.some((stem) => (df.get(stem) ?? 1) <= 2 && (stem.length >= 5 || row.matched.length >= 2))
    )
    .sort((a, b) => b.score - a.score);
  const result: DomainModule[] = [];
  for (const row of scored) {
    for (const resource of row.item.entry.resources) {
      if (result.length >= limit || result.some((item) => item.resource === resource)) continue;
      result.push({ resource, why: `MAPA-AKTOW: ${row.item.entry.scope.slice(0, 90)}`, score: Number(row.score.toFixed(2)), matched: row.matched });
    }
  }
  return result;
}

/**
 * The domains for this text: the flash-routing rows it names, else the domains
 * whose act maps it points to most (one specific act or scope).
 */
export function rankDomains(
  registry: LexSkillRegistry,
  rows: FlashRoute[],
  text: string,
  limit = 2
): Array<{ skill: string; matched: string[]; modules: DomainModule[] }> {
  const flash = flashDomains(rows, text)
    .filter((row) => registry.get(row.skill))
    .map((row) => ({ ...row, modules: suggestDomainModules(registry, row.skill, text) }))
    .sort((a, b) => b.matched.length - a.matched.length || (b.modules[0]?.score ?? 0) - (a.modules[0]?.score ?? 0))
    .slice(0, limit);
  if (flash.length) return flash;
  return [...registry.skills.values()]
    .filter((skill) => /^dr-\d{2}-/.test(skill.name))
    .map((skill) => ({ skill: skill.name, modules: suggestDomainModules(registry, skill.name, text) }))
    .filter((row) => (row.modules[0]?.score ?? 0) >= 1)
    .sort((a, b) => b.modules[0]!.score - a.modules[0]!.score)
    .slice(0, limit)
    .map((row) => ({ skill: row.skill, matched: [`mapa aktów: ${row.modules[0]!.why.replace(/^MAPA-AKTOW: /, "")}`], modules: row.modules }));
}

export function domainHintPrompt(domains: Array<{ skill: string; matched: string[]; modules: DomainModule[] }>): string {
  return [
    "# DZIEDZINA I MODUŁ AKTU — WSKAZÓWKA APLIKACJI (prawo-polskie-v2: routing błyskawiczny, MAPA-AKTOW dziedziny)",
    ...domains.map(
      (domain) =>
        `- ${domain.skill}: sygnały ${domain.matched.map((phrase) => `„${phrase}”`).join(", ")}` +
        (domain.modules.length ? `; moduły aktu dla tej sprawy: ${domain.modules.map((module) => `${module.resource} (${module.why})`).join("; ")}` : "")
    ),
    "Ścieżka prawo-polskie-v2: SKILL.md właściwej dziedziny, potem moduł aktu prawnego z jej MAPA-AKTOW. Gdy treść sprawy wskazuje inną dziedzinę lub inny moduł, powiedz to wprost i wczytaj właściwy."
  ].join("\n");
}
