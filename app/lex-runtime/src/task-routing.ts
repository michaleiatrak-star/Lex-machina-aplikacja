import { provisionsForDetection } from "./legal-act-abbreviations.js";

// Router KROK 2 — ROUTING [1]–[11], read from prawny-router-v3/SKILL.md: each row
// has its trigger phrases and the PRIMARY executive skill. The application uses it
// in AUTO to name the executive skill the router requires for the task, so the
// skill is loaded mechanically instead of being left to the model's choice.

export type TaskRoute = {
  id: string;
  title: string;
  phrases: string[];
  primary: string;
  secondary: string[];
};

const ROW = /^###\s+\[(\d{1,2})\]\s+(.+)$/u;

export function parseRoutingTable(router: string): TaskRoute[] {
  const section = /## KROK 2 — ROUTING \[1\]–\[11\][\s\S]*?(?=\n## )/u.exec(router)?.[0] ?? "";
  const routes: TaskRoute[] = [];
  let current: TaskRoute | null = null;
  let pending: string | null = null;
  const addPhrases = (raw: string) =>
    current!.phrases.push(
      ...raw
        .split(/\s+\/\s+|^\/\s+|\s+\/$/u)
        .map((phrase) => phrase.replace(/["„”`]/gu, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pl"))
        .filter((phrase) => phrase.length >= 3)
    );
  for (const line of section.split("\n")) {
    const row = ROW.exec(line);
    if (row) {
      if (current?.primary) routes.push(current);
      current = { id: row[1]!, title: row[2]!.trim(), phrases: [], primary: "", secondary: [] };
      pending = null;
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    // The phrase list is one backtick span, possibly over several lines.
    if (pending !== null) {
      const end = trimmed.indexOf("`");
      if (end < 0) {
        pending += ` ${trimmed}`;
        continue;
      }
      addPhrases(`${pending} ${trimmed.slice(0, end)}`);
      pending = null;
      continue;
    }
    if (!current.phrases.length && trimmed.startsWith("`") && !trimmed.startsWith("``")) {
      const end = trimmed.indexOf("`", 1);
      if (end < 0) pending = trimmed.slice(1);
      else addPhrases(trimmed.slice(1, end));
      continue;
    }
    const primary = /→\s*PRIMARY:\s*`view\s+([a-z0-9-]+)\/SKILL\.md`/u.exec(line);
    if (primary) current.primary = primary[1]!;
    const secondary = /→\s*SECONDARY:\s*(.+)$/u.exec(line);
    if (secondary) current.secondary = [...secondary[1]!.matchAll(/`([a-z0-9-]+)`/gu)].map((match) => match[1]!);
  }
  if (current?.primary) routes.push(current);
  return routes;
}

const ARTICLE = /\bart\.?\s*\d+|§\s*\d+/iu;

function stemPhrase(phrase: string): RegExp | null {
  if (phrase === "art. x") return ARTICLE;
  if (phrase === "§ y") return null;
  // Word starts: "wyrok" matches "wyroku", "apelacja" matches "apelację".
  const words = phrase
    .split(/\s+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}.-]/gu, ""))
    .filter(Boolean)
    .map((word) => (word.length >= 8 ? word.slice(0, word.length - 2) : word.length >= 5 ? word.slice(0, word.length - 1) : word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return null;
  return new RegExp(`(?<![\\p{L}])${words.join("\\p{L}*\\s+")}`, "iu");
}

/**
 * The route whose phrases match the question best (longest matched phrases win;
 * [10] is the domain router, already in the context, and does not name an
 * executive skill). Null when no executive route matches.
 */
export function classifyTask(routes: TaskRoute[], rawQuestion: string): { route: TaskRoute; matched: string[] } | null {
  // "233 kk" is "art. 233 KK" for the article row.
  const question = provisionsForDetection(rawQuestion);
  let best: { route: TaskRoute; matched: string[]; score: number } | null = null;
  for (const route of routes) {
    if (route.primary === "prawo-polskie-v2") continue;
    const matched = route.phrases.filter((phrase) => stemPhrase(phrase)?.test(question));
    if (!matched.length) continue;
    const score = matched.reduce((sum, phrase) => sum + phrase.length, 0);
    if (!best || score > best.score) best = { route, matched, score };
  }
  return best ? { route: best.route, matched: best.matched } : null;
}
