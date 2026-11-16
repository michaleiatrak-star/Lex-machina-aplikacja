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
  const body = rule.replace(/^§\s*\d+[a-z]?\.\s*/u, "");
  const file = issueStems(fileText);
  const clauses = body.split(/[.;]\s+|,\s+|\s+(?:ani|oraz|albo)\s+/u).map((item) => item.trim().replace(/[.;,]+$/u, "")).filter((item) => item.split(/\s+/u).length >= 3);
  const scored = clauses.map((clause) => {
    const stems = [...issueStems(clause)];
    return { clause, hit: stems.filter((stem) => file.has(stem)).length, share: stems.length ? stems.filter((stem) => file.has(stem)).length / stems.length : 0 };
  });
  const best = scored.sort((a, b) => b.hit - a.hit || b.share - a.share)[0];
  return best && best.hit >= 2 ? best.clause : body.split(/[.;]\s+/u)[0] ?? body;
}

export type CaseIssue = { text: string; queries: PortalQuery[]; barDisciplinary: boolean };

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
  for (const posture of POSTURES) {
    if (!posture.when.test(all)) continue;
    parts.push(posture.phrase);
    for (const site of posture.sites) queries.push({ topic: "CASE_LAW", site, query: `${posture.phrase} site:${site}` });
  }
  const seen = new Set<string>();
  return {
    text: parts.join("\n"),
    queries: queries.filter((item) => !seen.has(item.query) && Boolean(seen.add(item.query))).slice(0, 4),
    barDisciplinary: clauses.some((clause) => clause.code === "KEA") || (DISCIPLINARY.test(all) && BAR.test(all))
  };
}
