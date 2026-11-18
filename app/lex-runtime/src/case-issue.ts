// The legal issue of a case, for the searches made before the model answers (// 2026-11-16): the portals were asked with the user's own words ("przygotuj podważenie
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
 * The words in which this case's files speak of the issue, taken from the files themselves (no
 * word list per kind of case): the sentences that name the issue are read, and the words they
 * use far more often than the rest of the record become its vocabulary, as a lawyer who has read
 * the key passages then searches the record for the same words. a live case: a statement on the
 * issue at the end of a long hearing record shares those words, not the rule's.
 */
export function caseVocabulary(issue: string, fileText: string, limit = 16): string[] {
  const issueStems = new Set(stemsOf(issue));
  if (issueStems.size < 2) return [];
  const sentences = (fileText.replace(/\s*\n\s*/gu, " ").match(/[^.!?]{20,}(?:[.!?]+|$)/gu) ?? []).map((sentence) => new Set(stemsOf(sentence)));
  const seeds = sentences.filter((stems) => [...issueStems].filter((stem) => stems.has(stem)).length >= 2);
  if (seeds.length < 2 || sentences.length < 10) return [];
  const inAll = new Map<string, number>();
  for (const stems of sentences) for (const stem of stems) inAll.set(stem, (inAll.get(stem) ?? 0) + 1);
  const inSeeds = new Map<string, number>();
  for (const stems of seeds) for (const stem of stems) inSeeds.set(stem, (inSeeds.get(stem) ?? 0) + 1);
  return [...inSeeds]
    .filter(([stem, count]) => count >= 2 && !issueStems.has(stem) && stem.length >= 4)
    // How much more often in the issue's sentences than in the record (lift), common words out.
    .map(([stem, count]) => ({ stem, lift: (count / seeds.length) / ((inAll.get(stem)! + 1) / sentences.length) }))
    .filter((item) => item.lift >= 3)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, limit)
    .map((item) => item.stem);
}

/**
 * Legal concepts and the words in which any record speaks of them (a thesaurus of the law, the
 * same for every case): a threat of prosecution is spoken of as a notice to the authorities,
 * reporting, the prosecutor or the police, legal steps; an insult as offensive words.
 */
const CONCEPTS: ReadonlyArray<{ when: RegExp; words: string }> = [
  { when: /groz|groź|ścig|zawiadomieni\p{L}*\s+o\s+przestęp/iu, words: "zawiadomienie zgłoszenie zgłaszać organy prokuratura policja postępowanie karne kroki prawne konsekwencje odpowiedzialność karna" },
  { when: /obraźliw|znieważ|zniesławi|godnoś/iu, words: "obraźliwe wyrażenia znieważenie poniżenie zniesławienie" },
  { when: /tajemnic\p{L}*\s+(?:adwokack|zawodow|radcowsk)/iu, words: "ujawnienie poufne informacje klienta tajemnica" },
  { when: /konflikt\p{L}*\s+interes/iu, words: "reprezentował przeciwnika poprzednio pełnomocnik strony przeciwnej" }
];

/** The issue and its vocabulary (the law's concepts and the files' own words) as one text for choosing the parts of long files. */
export function caseFocus(clauses: readonly EthicsClause[], fileText: string, question: string): string {
  // The merits (the rule in dispute) when the file cites one; the procedural setting only without
  // it: the setting's words fill half of any record and would push the statement on the merits out.
  const merits = clauses.map((clause) => relevantClause(clause.text, `${fileText}\n${question}`));
  const issue = merits.length ? merits.join("\n") : caseIssue(clauses, fileText, question).text;
  const concepts = CONCEPTS.filter((item) => item.when.test(issue)).map((item) => item.words);
  const words = caseVocabulary(issue, fileText, 8);
  return [issue, ...concepts, words.join(" ")].filter(Boolean).join("\n");
}

export type FilePassage = { documentId: string; chunkIndex: number; page: number; text: string; weight?: number };

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ł/gu, "l");
const stemsOf = (text: string) =>
  [...new Set((fold(text).match(/\p{L}{4,}/gu) ?? []).filter((word) => !FOCUS_STOP.has(word)).map((word) => (word.length >= 6 ? word.slice(0, Math.max(5, word.length - 3)) : word)))];
const FOCUS_STOP = new Set("ktore ktory ktora jest oraz przez przy jako tego tych takze takze zgodnie ponizej powyzej wobec ramach sprawie sprawy dnia roku".split(" "));

/**
 * The sentences of the files that speak most of the issue (rare issue words weigh more), each
 * with its document, chunk and page: the model is pointed at them, as a lawyer marks the record
 * (live case: the attorney's statement at 01:53:35 of the hearing record went unused).
 */
/** How much a document's kind weighs as a source of facts (document-kind.ts categories). */
const SOURCE_WEIGHT: Record<string, number> = {
  ORZECZENIE: 1.3, // decisions and findings of an authority
  DOWOD: 1.3, // records of hearings, testimony, expert opinions
  KORESPONDENCJA: 1.2, // letters between the parties: often the very act in dispute
  UMOWA: 1.1,
  PISMO_PROCESOWE: 0.9, // a party's own pleading: its theses, not facts
  MATERIAL_PRAWNY: 0.7,
  INNE: 1
};

/**
 * The record's information on the issue, each sentence weighed (user 2026-11-16: score
 * the information of the files and give it by its weight, without a fixed share per document):
 * relevance (the issue's words, a rare one more than a common one) × the kind of the document it
 * comes from × novelty (each further sentence of the same document weighs a little less, never
 * excluded) × boilerplate (a list of authorities in a power of attorney weighs little). Given are
 * the sentences above a share of the strongest one's weight, strongest first, with their weight.
 */
export function issuePassages(
  attachments: ReadonlyArray<{ documentId: string; chunks: ReadonlyArray<{ index: number; pageStart?: number; text: string }> }>,
  focus: string,
  limit = 12,
  kinds: ReadonlyMap<string, string> = new Map()
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
  const candidates = sentences
    .map((sentence) => {
      const hits = terms.filter((term) => sentence.folded.includes(term));
      let relevance = hits.reduce((sum, term) => sum + 1 / Math.max(1, frequency.get(term)!), 0);
      // A list of authorities or courts (a power of attorney's boilerplate) weighs little.
      if ((sentence.folded.match(/,/gu) ?? []).length >= 4 && /\b(?:sadami|organami|komornikami|prokuratura|policja)\b/u.test(sentence.folded)) relevance *= 0.3;
      return { sentence, hits: hits.length, base: relevance * (SOURCE_WEIGHT[kinds.get(sentence.documentId) ?? "INNE"] ?? 1) };
    })
    .filter((item) => item.hits >= 2);
  // Greedy by weight with novelty: a sentence's weight falls by a third for each sentence of its
  // document already chosen, so a second document's strong sentence outranks a first one's weaker.
  const seen = new Set<string>();
  const perDocument = new Map<string, number>();
  const chosen: Array<FilePassage & { weight: number }> = [];
  let strongest = 0;
  const pool = [...candidates];
  while (chosen.length < limit && pool.length) {
    let best = -1;
    let bestWeight = 0;
    pool.forEach((item, index) => {
      const weight = item.base * Math.pow(2 / 3, perDocument.get(item.sentence.documentId) ?? 0);
      if (weight > bestWeight) {
        best = index;
        bestWeight = weight;
      }
    });
    if (best < 0) break;
    const [item] = pool.splice(best, 1);
    const key = item!.sentence.folded.slice(0, 120);
    if (seen.has(key)) continue;
    strongest ||= bestWeight;
    // Below a fifth of the strongest information: no longer worth the model's attention.
    if (bestWeight < strongest * 0.2) break;
    seen.add(key);
    perDocument.set(item!.sentence.documentId, (perDocument.get(item!.sentence.documentId) ?? 0) + 1);
    chosen.push({ documentId: item!.sentence.documentId, chunkIndex: item!.sentence.chunkIndex, page: item!.sentence.page, text: item!.sentence.text.slice(0, 500), weight: bestWeight });
  }
  return chosen.map((item) => ({ documentId: item.documentId, chunkIndex: item.chunkIndex, page: item.page, text: item.text, weight: strongest ? Math.round((item.weight / strongest) * 100) / 100 : 0 }));
}

export function issuePassagesPrompt(passages: readonly FilePassage[]): string {
  if (!passages.length) return "";
  return [
    "# FRAGMENTY AKT DOTYCZĄCE ZAGADNIENIA SPRAWY (wskazane przez aplikację)",
    "Informacje z akt ocenione przez aplikację według wagi (1,00 = najsilniejsza; waga łączy trafność do zagadnienia, rodzaj dokumentu i nowość). Rozważ każdą: czy wspiera, czy osłabia stanowisko strony. Powołując je, cytuj dosłownie ze wskazaniem dokumentu i strony, znacznikiem [[LEXDOC:<documentId>:<chunkIndex>]]. Nie pomijaj ich bez wyjaśnienia.",
    ...passages.map((passage) => `- waga ${(passage.weight ?? 0).toFixed(2).replace(".", ",")} · [[LEXDOC:${passage.documentId}:${passage.chunkIndex}]] (s. ${passage.page}) „${passage.text}”`)
  ].join("\n");
}
