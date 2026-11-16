// The legal issue of a case, for the searches made before the model answers (RD 121/26,
// 2026-11-16): the portals were asked with the user's own words ("przygotuj podważenie
// postanowienia…"), so the rulings on the issue itself (§ 16 KEA: the threat of criminal
// prosecution; a refusal to open proceedings on incomplete material) were never found, while the
// chat searched by the norm and by the procedural setting. The issue is taken from the clause of
// the cited ethics rule that the file speaks of and from the kind of decision challenged.
import { issueStems } from "./courts/wsd-topics.js";
import { portalPhrase, type PortalQuery } from "./official-portal-search.js";

export type EthicsClause = { code: "KEA" | "KERP"; paragraph: string; text: string };

/** Procedural settings whose standard arguments the courts' portals answer. */
const POSTURES: ReadonlyArray<{ when: RegExp; phrase: string; sites: string[] }> = [
  {
    when: /odm\p{L}*\s+wszczęcia|odmowie\s+wszczęcia/iu,
    phrase: "odmowa wszczęcia przedwczesna niekompletny materiał dowodowy",
    sites: ["orzeczenia.ms.gov.pl", "sn.pl"]
  },
  {
    when: /umorz\p{L}*\s+(?:postępowania|dochodzenia|śledztwa)/iu,
    phrase: "umorzenie przedwczesne niewyjaśnione okoliczności zażalenie uwzględnione",
    sites: ["orzeczenia.ms.gov.pl", "sn.pl"]
  }
];

const DISCIPLINARY = /rzeczni\p{L}*\s+dyscyplinarn|sąd\p{L}*\s+dyscyplinarn|przewinieni\p{L}*\s+dyscyplinarn|postępowani\p{L}*\s+dyscyplinarn/iu;
const BAR = /adwoka|\bKEA\b|Izb\p{L}*\s+Adwokack/iu;

/** The clause of a rule the file speaks of: "ani grozić ściganiem karnym" rather than the whole § 16. */
export function relevantClause(rule: string, fileText: string): string {
  const paragraph = /^§\s*(\d+[a-z]?)\./u.exec(rule)?.[1];
  const body = rule.replace(/^§\s*\d+[a-z]?\.\s*/u, "");
  // What the file says where it cites the paragraph ("Zakaz z § 16 KEA chroni przed … groźby
  // ścigania karnego"); the whole file only when it never cites it.
  const around = paragraph ? [...fileText.matchAll(new RegExp(`[\\s\\S]{0,300}§\\s*${paragraph}(?![\\d])[\\s\\S]{0,300}`, "gu"))].map((match) => match[0]).join("\n") : "";
  const file = issueStems(around || fileText);
  const clauses = body.split(/[.;]\s+|,\s+|\s+(?:ani|oraz|albo)\s+/u).map((item) => item.trim().replace(/[.;,]+$/u, "")).filter((item) => item.split(/\s+/u).length >= 3);
  const scored = clauses.map((clause) => {
    const stems = [...issueStems(clause)];
    return { clause, hit: stems.filter((stem) => file.has(stem)).length, share: stems.length ? stems.filter((stem) => file.has(stem)).length / stems.length : 0 };
  });
  const best = scored.sort((a, b) => b.share - a.share || b.hit - a.hit)[0];
  return best && best.hit >= 2 ? best.clause : body.split(/[.;]\s+/u)[0] ?? body;
}

export type CaseIssue = { text: string; queries: PortalQuery[]; barDisciplinary: boolean; procedural: string[] };

/** The issue's words and the portal queries made from them (at most four, before the question's own). */
export function caseIssue(clauses: readonly EthicsClause[], fileText: string, question: string): CaseIssue {
  const all = `${fileText}\n${question}`;
  const queries: PortalQuery[] = [];
  const parts: string[] = [];
  for (const clause of clauses) {
    const words = relevantClause(clause.text, all);
    parts.push(words);
    const phrase = portalPhrase(words).split(" ").slice(0, 7).join(" ");
    if (phrase.split(" ").length < 2) continue;
    const site = clause.code === "KEA" ? "wsd.adwokatura.pl" : "kirp.pl";
    queries.push({ topic: "DISCIPLINARY", site, query: `${phrase} site:${site}` });
    queries.push({ topic: "DISCIPLINARY", site: "sn.pl", query: `${phrase} ${clause.code === "KEA" ? "adwokat" : "radca prawny"} site:sn.pl` });
  }
  const procedural: string[] = [];
  for (const posture of POSTURES) {
    if (!posture.when.test(all)) continue;
    parts.push(posture.phrase);
    procedural.push(posture.phrase);
    for (const site of posture.sites) queries.push({ topic: "CASE_LAW", site, query: `${posture.phrase} site:${site}` });
  }
  const seen = new Set<string>();
  return {
    text: parts.join("\n"),
    queries: queries.filter((item) => !seen.has(item.query) && Boolean(seen.add(item.query))).slice(0, 4),
    barDisciplinary: clauses.some((clause) => clause.code === "KEA") || (DISCIPLINARY.test(all) && BAR.test(all)),
    procedural
  };
}

/**
 * The words in which case files speak of an issue (a threat of prosecution is "zgłaszana do
 * odpowiednich organów", "kroki prawne", "nękanie"): they choose which parts of long files reach
 * the model whole (context-orchestrator.ts), as a lawyer searching the record would.
 */
const VOCABULARY: ReadonlyArray<{ when: RegExp; words: string }> = [
  {
    when: /groz|groź|ścig|ścigan|zawiadomieni\p{L}*\s+o\s+przestęp/iu,
    words: "zgłaszana zgłoszenie zgłoszę organów zawiadomienie zawiadomić prokuratura policja nękanie uporczywe kroki prawne konsekwencje prawne odpowiedzialność karna 190a"
  },
  { when: /odm\p{L}*\s+wszczęcia|umorz\p{L}*/iu, words: "świadek zeznania przesłuchanie wyjaśnienia dowody nie ustalono pominięto wniosek dowodowy" },
  { when: /obraźliw|znieważ|godnoś/iu, words: "obraźliwe wyrażenia znieważenie poniżenie" }
];

/** The issue and its vocabulary as one text for choosing the parts of long files. */
export function caseFocus(clauses: readonly EthicsClause[], fileText: string, question: string): string {
  // The merits (the rule in dispute and its words) when the file cites one; the procedural setting
  // ("odmowa wszczęcia": witnesses, evidence) only without it: its words fill half of any record
  // and would push the statement on the merits out (RD 121/26).
  const merits = clauses.map((clause) => relevantClause(clause.text, `${fileText}\n${question}`));
  const issue = merits.length ? merits.join("\n") : caseIssue(clauses, fileText, question).text;
  const words = VOCABULARY.filter((item) => item.when.test(`${issue}\n${merits.length ? "" : question}`)).map((item) => item.words);
  return [issue, ...words].filter(Boolean).join("\n");
}

export type FilePassage = { documentId: string; chunkIndex: number; page: number; text: string };

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ł/gu, "l");
const stemsOf = (text: string) =>
  [...new Set((fold(text).match(/\p{L}{4,}/gu) ?? []).filter((word) => !FOCUS_STOP.has(word)).map((word) => (word.length >= 6 ? word.slice(0, Math.max(5, word.length - 3)) : word)))];
const FOCUS_STOP = new Set("ktore ktory ktora jest oraz przez przy jako tego tych takze takze zgodnie ponizej powyzej wobec ramach sprawie sprawy dnia roku".split(" "));

/**
 * The sentences of the files that speak most of the issue (rare issue words weigh more), each
 * with its document, chunk and page: the model is pointed at them, as a lawyer marks the record
 * (RD 121/26: the attorney's statement at 01:53:35 of the hearing record went unused).
 */
export function issuePassages(
  attachments: ReadonlyArray<{ documentId: string; chunks: ReadonlyArray<{ index: number; pageStart?: number; text: string }> }>,
  focus: string,
  limit = 10
): FilePassage[] {
  // One stem per word family ("zglos" covers "zglosze"), so that a sentence is not counted twice.
  const all = stemsOf(focus);
  const terms = all.filter((term) => !all.some((other) => other !== term && term.startsWith(other)));
  if (!terms.length) return [];
  const sentences = attachments.flatMap((attachment) =>
    attachment.chunks.flatMap((chunk) =>
      (chunk.text.replace(/\s*\n\s*/gu, " ").match(/[^.!?]{20,}(?:[.!?]+|$)/gu) ?? []).map((text) => ({ documentId: attachment.documentId, chunkIndex: chunk.index, page: chunk.pageStart ?? chunk.index + 1, text: text.replace(/\s+/gu, " ").trim(), folded: fold(text) }))
    )
  );
  const frequency = new Map(terms.map((term) => [term, sentences.filter((sentence) => sentence.folded.includes(term)).length]));
  const scored = sentences
    .map((sentence) => {
      const hits = terms.filter((term) => sentence.folded.includes(term));
      return { sentence, hits: hits.length, score: hits.reduce((sum, term) => sum + 1 / Math.max(1, frequency.get(term)!), 0) };
    })
    .filter((item) => item.hits >= 2)
    // Three different words of the issue first (a statement on it), two only to fill the list.
    .sort((a, b) => Number(b.hits >= 3) - Number(a.hits >= 3) || b.score - a.score);
  const seen = new Set<string>();
  const chosen: FilePassage[] = [];
  for (const { sentence } of scored) {
    const key = sentence.folded.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push({ documentId: sentence.documentId, chunkIndex: sentence.chunkIndex, page: sentence.page, text: sentence.text.slice(0, 500) });
    if (chosen.length >= limit) break;
  }
  return chosen;
}

export function issuePassagesPrompt(passages: readonly FilePassage[]): string {
  if (!passages.length) return "";
  return [
    "# FRAGMENTY AKT DOTYCZĄCE ZAGADNIENIA SPRAWY (wskazane przez aplikację)",
    "Zdania z dokumentów sprawy najmocniej związane z zagadnieniem. Rozważ każde: czy wspiera, czy osłabia stanowisko strony. Powołując je, cytuj dosłownie ze wskazaniem dokumentu i strony, znacznikiem [[LEXDOC:<documentId>:<chunkIndex>]]. Nie pomijaj ich bez wyjaśnienia.",
    ...passages.map((passage) => `- [[LEXDOC:${passage.documentId}:${passage.chunkIndex}]] (s. ${passage.page}) „${passage.text}”`)
  ].join("\n");
}
