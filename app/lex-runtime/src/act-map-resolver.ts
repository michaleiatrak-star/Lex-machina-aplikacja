import fs from "node:fs";
import path from "node:path";
import { provisionsForDetection } from "./legal-act-abbreviations.js";
import { fold, locate } from "./domain-module-map.js";
import type { LexSkillRegistry } from "./registry.js";

/**
 * MAPA-AKTOW of the legal domains, resolved mechanically: a module is selected
 * only by what the case states unambiguously, never by a score.
 *  - DZU:     the act's Dz.U. designation (year, position) in the case = the row's basis;
 *  - PRZEPIS: "art. N <KODEKS>" = the row of that code whose article range holds N
 *             (else the code's index / main module);
 *  - NAZWA:   the act or scope named in the row ("prawo łowieckie", "szkody łowieckie")
 *             appears in the case as a phrase.
 */

export type ActRule = "DZU" | "PRZEPIS" | "NAZWA";
export type ResolvedActModule = { skill: string; resource: string; rule: ActRule; why: string };
export type RejectedActModule = ResolvedActModule & { reason: string };

type Range = { from: [number, string]; to: [number, string] };
type ActRow = {
  skill: string;
  label: string;
  basis: string;
  resources: string[];
  codes: string[];
  ranges: Range[];
  index: boolean;
  phrases: RegExp[];
};

const CODES: Record<string, RegExp> = {
  KK: /kodeks\s+karny(?!\s+(?:skarbowy|wykonawczy))/iu,
  KW: /kodeks\s+wykrocze/iu,
  KC: /kodeks\s+cywilny/iu,
  KP: /kodeks\s+pracy/iu,
  KPC: /kodeks\s+postępowania\s+cywilnego/iu,
  KPK: /kodeks\s+postępowania\s+karnego/iu,
  KPA: /kodeks\s+postępowania\s+administracyjnego/iu,
  KRO: /kodeks\s+rodzinny/iu,
  KSH: /kodeks\s+spółek\s+handlowych/iu,
  KKS: /kodeks\s+karny\s+skarbowy/iu,
  KKW: /kodeks\s+karny\s+wykonawczy/iu,
  KPW: /kodeks\s+postępowania\s+w\s+sprawach\s+o\s+wykrocz/iu,
  OP: /ordynacj\p{L}*\s+podatkow/iu,
  PPSA: /postępowani\p{L}*\s+przed\s+sądami\s+administracyjnymi/iu
};
const CODE_TOKEN = new RegExp(`(?<![\\p{L}])(${Object.keys(CODES).join("|")})(?![\\p{L}])`, "gu");

// Words that never make a row's phrase on their own.
const GENERIC = new Set([
  "ustawa", "ustawy", "kodeks", "prawo", "przepisy", "indeks", "current", "state", "całego", "kodeksu", "aktu", "moduł", "główny",
  "framework", "ogólny", "szczegółowy", "pozostałe", "części", "routing", "oraz", "właściwe", "akty", "wykonawcze", "zakres",
  "przekrojowy", "uzupełnienie", "pokrycia", "rozdziały", "działy", "inne", "ogólne", "sprawy", "sprawach",
  // Too general to select a module alone (single-word map phrases).
  "podstawa", "podstawy", "zdrowie", "terminy", "sankcje", "nadzorca", "nadzór", "lotniczy", "morski", "obrona", "opieka",
  "układ", "media", "plany", "zwrot", "umowy", "umowa", "osoba", "obrót", "norma", "mienie", "zapłata", "poczta", "obwody"
]);

function parseNumber(value: string): [number, string] {
  const match = /^(\d+)([a-z]*)$/u.exec(value) ?? ["", "0", ""];
  return [Number(match[1]), match[2] ?? ""];
}

function compare(a: [number, string], b: [number, string]): number {
  return a[0] - b[0] || a[1].localeCompare(b[1]);
}

// "(art. 270-277d, 310 KK)" in the module's own heading: its declared scope.
function declaredRanges(registry: LexSkillRegistry, resource: string): Range[] | null {
  let head = "";
  try {
    const file = registry.resolveResource(resource.split("/")[0]!, resource);
    head = file ? fs.readFileSync(file, "utf8").split("\n").find((line) => /^#\s/.test(line)) ?? "" : "";
  } catch {
    return null;
  }
  const list = /\(art\.\s*([^)]*?)\s+(?:KK|KW|KC|KP|KPC|KPK|KPA|KRO|KSH|KKS|KKW|KPW)\b/u.exec(head)?.[1];
  if (!list) return null;
  const result: Range[] = [];
  for (const part of list.split(/,|\bi\b/u)) {
    const match = /(\d+[a-z]*)(?:\s*[–-]\s*(\d+[a-z]*))?/u.exec(part.trim());
    if (match) result.push({ from: parseNumber(match[1]!), to: parseNumber(match[2] ?? match[1]!) });
  }
  return result.length ? result : null;
}

function ranges(text: string): Range[] {
  const result: Range[] = [];
  for (const match of text.matchAll(/art\.?\s*(\d+[a-z]*)(?:\s*[–-]\s*(\d+[a-z]*))?/giu)) {
    result.push({ from: parseNumber(match[1]!), to: parseNumber(match[2] ?? match[1]!) });
  }
  // "mod-KK-art148-162-...", "mod-KW-art70-118-..."
  for (const match of text.matchAll(/-art(\d+[a-z]?)(?:-(\d+[a-z]?))?-/gu)) {
    result.push({ from: parseNumber(match[1]!), to: parseNumber(match[2] ?? match[1]!) });
  }
  return result;
}

// The row's phrases: each part of the label ("Prawo łowieckie — szkody łowieckie",
// "Wycinka / odpady niebezpieczne") as a sequence of word stems.
function phrases(label: string): RegExp[] {
  const result: RegExp[] = [];
  const parts = label
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bart\.?\s*\d+[a-z]*(?:\s*[–-]\s*\d+[a-z]*)?/giu, " ")
    .split(/\s+—\s+|\s*\/\s*|\s*\+\s*|,|;/u);
  for (const part of parts) {
    const words = (part.match(/\p{L}{3,}/gu) ?? []).filter((word) => !CODE_TOKEN.test(word) && (CODE_TOKEN.lastIndex = 0, true));
    const significant = words.filter((word) => !GENERIC.has(word.toLocaleLowerCase("pl")));
    if (!significant.length) continue;
    // One word only when long and specific ("kłusownictwo", "patostreaming").
    if (words.length === 1 && (words[0]!.length < 7 || GENERIC.has(words[0]!.toLocaleLowerCase("pl")))) continue;
    const stems = words.map((word) => {
      const lower = fold(word);
      const stem = lower.length <= 4 ? lower : lower.slice(0, Math.max(4, lower.length - 2));
      return `${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]*`;
    });
    result.push(new RegExp(`(?<![a-z])${stems.join("(?:\\s+[a-z]+){0,1}\\s+")}`, "u"));
  }
  return result;
}

const cache = new Map<string, ActRow[]>();

function actRows(registry: LexSkillRegistry): ActRow[] {
  const skills = [...registry.skills.values()].filter((skill) => /^dr-\d{2}-/.test(skill.name)).sort((a, b) => a.name.localeCompare(b.name));
  const bodies = skills.map((skill) => {
    try {
      return fs.readFileSync(path.join(skill.directory, "MAPA-AKTOW.md"), "utf8");
    } catch {
      return "";
    }
  });
  const key = `${registry.root}:${bodies.map((body) => body.length).join(",")}`;
  if (cache.has(key)) return cache.get(key)!;
  const rows: ActRow[] = [];
  skills.forEach((skill, position) => {
    let moduleColumn = -1;
    let basisColumn = -1;
    for (const line of bodies[position]!.split("\n")) {
      if (!line.trim().startsWith("|")) {
        moduleColumn = -1;
        continue;
      }
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      const header = cells.findIndex((cell) => /^Moduł/u.test(cell));
      if (header >= 0) {
        moduleColumn = header;
        basisColumn = cells.findIndex((cell, index) => index > 0 && index !== header && /podstaw|źródło|Dz\.U/iu.test(cell));
        continue;
      }
      if (moduleColumn < 0 || /^:?-+/.test(cells[0] ?? "")) continue;
      const resources = [...(cells[moduleColumn] ?? "").matchAll(/`((?:dr-\d{2}-[a-z0-9-]+\/modules\/)?mod-[A-Za-z0-9._-]+?)(?:\.md)?`/g)]
        .map((match) => (match[1]!.startsWith("dr-") ? `${match[1]}.md` : `${skill.name}/modules/${match[1]}.md`))
        .map((resource) => locate(registry, skill.name, resource))
        .filter((resource): resource is string => resource !== null);
      if (!resources.length) continue;
      const label = (cells[0] ?? "").replace(/\*\*/g, "");
      const codes = new Set<string>();
      for (const match of label.matchAll(CODE_TOKEN)) codes.add(match[1]!);
      for (const [code, name] of Object.entries(CODES)) if (name.test(label)) codes.add(code);
      if (codes.has("KKS") || codes.has("KKW")) codes.delete("KK");
      rows.push({
        skill: skill.name,
        label,
        basis: basisColumn >= 0 ? cells[basisColumn] ?? "" : "",
        resources,
        codes: [...codes],
        // The module's declared scope first; else the row's label and the module's name.
        ranges:
          resources.map((resource) => declaredRanges(registry, resource)).find((declared): declared is Range[] => declared !== null) ??
          ranges([label, ...resources.map((resource) => path.basename(resource))].join(" ")),
        index: /indeks|current-state|moduł\s+główny/iu.test(label) || resources.some((resource) => /current-state-COV/.test(resource)),
        phrases: phrases(label)
      });
    }
  });
  cache.set(key, rows);
  return rows;
}

function dzuPairs(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const match of text.matchAll(/Dz\.\s?U\.\s*(?:z\s*)?(\d{4})\s*(?:r\.)?\s*,?\s*(?:Nr\s*\d+\s*,?\s*)?poz\.\s*(\d+)/giu)) pairs.push([match[1]!, match[2]!]);
  for (const match of text.matchAll(/\bDU\/(\d{4})\/(\d+)\b/gu)) pairs.push([match[1]!, match[2]!]);
  return pairs;
}

function moduleText(registry: LexSkillRegistry, resource: string): string {
  try {
    const file = registry.resolveResource(resource.split("/")[0]!, resource);
    return file ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

/** The act modules the case points to unambiguously, in the order of the rules. */
export function resolveActModules(registry: LexSkillRegistry, text: string, limit = 4): ResolvedActModule[] {
  return resolveActModulesWithChecks(registry, text, limit).modules;
}

/**
 * Also checks each module against its map row: a module chosen by the act's
 * Dz.U. number or name must mention that act; otherwise the map row points to
 * the wrong module and the module is not loaded (reported instead).
 */
export function resolveActModulesWithChecks(
  registry: LexSkillRegistry,
  text: string,
  limit = 4
): { modules: ResolvedActModule[]; rejected: RejectedActModule[] } {
  const rows = actRows(registry);
  const found: ResolvedActModule[] = [];
  const rejected: RejectedActModule[] = [];
  const add = (row: ActRow, rule: ActRule, why: string, mention?: RegExp) => {
    for (const resource of row.resources) {
      if (found.length >= limit || found.some((item) => item.resource === resource) || rejected.some((item) => item.resource === resource)) continue;
      if (mention && !mention.test(fold(moduleText(registry, resource)))) {
        rejected.push({ skill: row.skill, resource, rule, why, reason: `moduł nie wymienia aktu z wiersza mapy („${row.label}”) — rozbieżność MAPA-AKTOW ${row.skill}` });
        continue;
      }
      found.push({ skill: row.skill, resource, rule, why });
    }
  };
  // DZU: the basis column holds the same Dz.U. year and position.
  for (const [year, position] of dzuPairs(text)) {
    const pattern = new RegExp(`Dz\\.\\s?U\\.\\s*(?:z\\s*)?${year}\\s*(?:r\\.)?\\s*,?\\s*poz\\.\\s*${position}(?!\\d)`, "u");
    for (const row of rows.filter((item) => pattern.test(item.basis) || pattern.test(item.label))) {
      // The row may list several acts: the module must carry this one (number or the row's phrase).
      const phrase = row.phrases[0];
      const mention = new RegExp(`${year}\\s*(?:r\\.)?\\s*,?\\s*poz\\.\\s*${position}(?!\\d)|${year}\\/${position}(?!\\d)${phrase ? `|${phrase.source.replace(/^\(\?<!\[a-z\]\)/, "")}` : ""}`, "u");
      add(row, "DZU", `Dz.U. ${year} poz. ${position} → ${row.label}`, mention);
    }
  }
  // PRZEPIS: art. N of a code; the narrowest range holding N, else the code's index row.
  const provisions = provisionsForDetection(text);
  for (const match of provisions.matchAll(/\bart\.?\s*(\d+[a-z]*)(?:\s*§\s*\d+[a-z]*)?(?:\s*(?:pkt|ust\.)\s*\d+[a-z]*)?\s+(KK|KW|KC|KP|KPC|KPK|KPA|KRO|KSH|KKS|KKW|KPW|OP|PPSA)\b/gu)) {
    const article = parseNumber(match[1]!);
    const code = match[2]!;
    const ofCode = rows.filter((row) => row.codes.includes(code));
    const holding = ofCode
      .flatMap((row) => row.ranges.filter((range) => compare(range.from, article) <= 0 && compare(article, range.to) <= 0).map((range) => ({ row, width: range.to[0] - range.from[0] })))
      .sort((a, b) => a.width - b.width);
    if (holding.length) add(holding[0]!.row, "PRZEPIS", `art. ${match[1]} ${code} → ${holding[0]!.row.label}`);
    else {
      const index = ofCode.find((row) => row.index);
      if (index) add(index, "PRZEPIS", `art. ${match[1]} ${code} → ${index.label} (brak wiersza z tym artykułem)`);
    }
  }
  // NAZWA: a phrase of the row's label in the case.
  const folded = fold(text);
  for (const row of rows) {
    const phrase = row.phrases.find((pattern) => pattern.test(folded));
    if (phrase) add(row, "NAZWA", `„${row.label}” w treści sprawy`, new RegExp(phrase.source.replace(/^\(\?<!\[a-z\]\)/, ""), "u"));
  }
  return { modules: found, rejected };
}

export const ACT_MODULES_BUDGET_CHARS = 45_000;

export function loadActModules(
  registry: LexSkillRegistry,
  modules: ResolvedActModule[],
  inContext: ReadonlySet<string>,
  budget = ACT_MODULES_BUDGET_CHARS
): { loaded: Array<ResolvedActModule & { content: string }>; toRead: ResolvedActModule[] } {
  const loaded: Array<ResolvedActModule & { content: string }> = [];
  const toRead: ResolvedActModule[] = [];
  let left = budget;
  for (const module of modules) {
    if (inContext.has(module.resource)) continue;
    let content = "";
    try {
      const file = registry.resolveResource(module.skill, module.resource);
      content = file ? fs.readFileSync(file, "utf8") : "";
    } catch {
      content = "";
    }
    if (!content.trim()) continue;
    if (content.length > left) {
      toRead.push(module);
      continue;
    }
    left -= content.length;
    loaded.push({ ...module, content });
  }
  return { loaded, toRead };
}

export function actModulesPrompt(result: ReturnType<typeof loadActModules>): string {
  return [
    "# MODUŁY AKTÓW WSKAZANE MECHANICZNIE (MAPA-AKTOW dziedzin; aplikacja)",
    "Reguły: DZU — numer Dz.U. ze sprawy = podstawa w mapie; PRZEPIS — artykuł kodeksu w zakresie wiersza mapy; NAZWA — akt lub zakres z mapy wymieniony w sprawie.",
    ...result.loaded.map((item) => `- ${item.resource} [${item.rule}] ${item.why} (wczytany poniżej)`),
    ...result.toRead.map((item) => `- ${item.resource} [${item.rule}] ${item.why} (WYMAGANY: wczytaj narzędziem korpusu; aplikacja to sprawdza)`),
    "Te moduły są obowiązkowe dla tej sprawy. Brzmienie przepisów i tak weryfikujesz w ELI.",
    ...result.loaded.map((item) => `## MODUŁ AKTU: ${item.resource}\n\n${item.content}`)
  ].join("\n\n");
}
