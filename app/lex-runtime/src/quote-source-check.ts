// A quote must be the words of its source. A quotation of a provision ("art. 41 ust. 2 …
// „…”") is compared with the wording verified in this turn (the ledger's evidence); a quotation
// attributed to a case document and not found in it is the document gate's finding
// (QUOTE_UNSOURCED_MARKER). Both go to the correction round with the source's own words, so the
// model replaces the quote with the exact wording or drops the quotation marks (user, 2026-11-08:
// "w przypadku błędu ustawa–cytat ma być korekta w rundzie poprawczej; to samo źródło–cytat").
import { QUOTE_UNSOURCED_MARKER } from "./document-citations.js";

export type QuoteSourceFinding = {
  kind: "STATUTE" | "DOCUMENT";
  quote: string;
  // The provision the quote is attributed to and the verified wording it was compared with.
  claim?: string;
  wording?: string;
};

const QUOTE = /„([^„”\r\n]{12,1500})”|“([^“”\r\n]{12,1500})”/gu;
const PROVISION = /\bart\.\s*(\d+[a-z]?(?:\^\d+|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?)(?:\s*§\s*(\d+[a-z]?))?(?:\s*ust\.\s*(\d+[a-z]?))?(?:\s*pkt\s*(\d+[a-z]?))?/giu;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export function normalizedWords(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/­/gu, "")
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2")
    .toLocaleLowerCase("pl")
    .replace(/[„”“"'’«»()[\]…:;,.!?–—-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

type Provision = { article: string; paragraph?: string; section?: string; point?: string; act?: string };

// Codes and acts named after a provision: "art. 17 ust. 3 RODO" and "art. 17 § 1 k.p.k." are two
// provisions, not one (live case: a GDPR quote was compared with the Code of Criminal Procedure).
const ACT_ALIASES: Array<[RegExp, string]> = [
  [/^(?:rodo|rozporządzeni\p{L}*\s+2016\/679|ogólnego\s+rozporządzenia\s+o\s+ochronie\s+danych)/iu, "rodo"],
  [/^(?:k\.?\s*p\.?\s*k\b\.?|kodeksu\s+postępowania\s+karnego|kodeks\s+postępowania\s+karnego)/iu, "kpk"],
  [/^(?:k\.?\s*p\.?\s*c\b\.?|kodeksu\s+postępowania\s+cywilnego|kodeks\s+postępowania\s+cywilnego)/iu, "kpc"],
  [/^(?:k\.?\s*p\.?\s*a\b\.?|kodeksu\s+postępowania\s+administracyjnego)/iu, "kpa"],
  [/^(?:k\.?\s*k\.?\s*w\b\.?|kodeksu\s+karnego\s+wykonawczego)/iu, "kkw"],
  [/^(?:k\.?\s*k\.?\s*s\b\.?|kodeksu\s+karnego\s+skarbowego)/iu, "kks"],
  [/^(?:k\.?\s*k\b\.?|kodeksu\s+karnego|kodeks\s+karny)/iu, "kk"],
  [/^(?:k\.?\s*c\b\.?|kodeksu\s+cywilnego|kodeks\s+cywilny)/iu, "kc"],
  [/^(?:k\.?\s*p\b\.?|kodeksu\s+pracy|kodeks\s+pracy)/iu, "kp"],
  [/^(?:k\.?\s*r\.?\s*o\b\.?|kodeksu\s+rodzinnego)/iu, "kro"],
  [/^(?:k\.?\s*w\b\.?|kodeksu\s+wykroczeń)/iu, "kw"],
  [/^(?:konstytucji|konstytucja)/iu, "konstytucja"]
];

/** The act named right after a provision, as a comparable key; null when none is named. */
export function actKey(rest: string): string | null {
  const text = rest.replace(/^(?:\s*(?:lit\.\s*[a-z]+|zd(?:anie|\.)\s*\S+|in\s+fine|⚠️\s*\[[^\]]*\]|✅\s*\[[^\]]*\]))*[\s,]*/u, "");
  for (const [pattern, key] of ACT_ALIASES) if (pattern.test(text)) return key;
  // "tej ustawy", "niniejszej ustawy", "ustawy z 4 września 2026 r.": an act other than any code.
  if (/^(?:tej|niniejszej|tejże|powołanej|zmieniającej|nowelizującej)\s+ustaw/iu.test(text) || /^ustaw\p{L}*\s+(?:z\s|zmieniaj|o\s)/iu.test(text)) {
    const named = /^ustaw\p{L}*\s+o\s+((?:\p{L}+\s*){1,3})/iu.exec(text);
    return named ? `ustawa o ${stems(named[1]!)}` : "inna ustawa";
  }
  // "Prawa o adwokaturze", "Prawo budowlane": compared by the stems of the first words.
  const named = /^(Praw\p{L}*(?:\s+(?:o\s+)?\p{L}+){1,2})/u.exec(text);
  return named ? stems(named[1]!) : null;
}

const stems = (words: string) => words.toLocaleLowerCase("pl").split(/\s+/u).filter(Boolean).map((word) => word.slice(0, 4)).join(" ");

function provisionOf(text: string, which: "first" | "last" = "last"): Provision | null {
  let last: RegExpExecArray | null = null;
  PROVISION.lastIndex = 0;
  for (let match = PROVISION.exec(text); match; match = PROVISION.exec(text)) {
    last = match;
    if (which === "first") break;
  }
  if (!last) return null;
  const act = actKey(text.slice(last.index + last[0].length, last.index + last[0].length + 80));
  return {
    article: last[1]!.toLowerCase(),
    ...(last[2] ? { paragraph: last[2] } : {}),
    ...(last[3] ? { section: last[3] } : {}),
    ...(last[4] ? { point: last[4] } : {}),
    ...(act ? { act } : {})
  };
}

// The closest record: the same act, then the same units ("ust. 3" is not "§ 1": another act's shape).
function matchScore(provision: Provision, own: Provision | null): number {
  if (!own) return 0;
  let score = 0;
  if (provision.act && own.act === provision.act) score += 8;
  if (provision.section && own.section === provision.section) score += 4;
  if (provision.paragraph && own.paragraph === provision.paragraph) score += 4;
  if (provision.point && own.point === provision.point) score += 1;
  if ((provision.section && own.paragraph && !own.section) || (provision.paragraph && own.section && !own.paragraph)) score -= 4;
  return score;
}

function sameProvision(claim: string, provision: Provision): boolean {
  const own = provisionOf(claim);
  if (!own || own.article !== provision.article) return false;
  if (provision.paragraph && own.paragraph && own.paragraph !== provision.paragraph) return false;
  if (provision.section && own.section && own.section !== provision.section) return false;
  if (provision.point && own.point && own.point !== provision.point) return false;
  // Two different acts named: not the same provision. An act named only on one side is unknown.
  if (provision.act && own.act && provision.act !== own.act) return false;
  // "art. 4 ust. 1 tej ustawy" names an act that is no code: never a code's article of that number.
  if (provision.act === "inna ustawa" && own.act && ACT_ALIASES.some(([, key]) => key === own.act)) return false;
  return true;
}

/** Quotations of provisions that are not the verified wording of that provision. */
export function statuteQuoteFindings(
  answer: string,
  statutes: ReadonlyArray<{ claim: string; evidence?: string }>,
  // Texts a quote may come from besides the provisions: the case documents and the case law read
  // in this turn. A quote found there is that source's words, not a misquoted provision.
  otherSources: readonly string[] = []
): QuoteSourceFinding[] {
  const findings: QuoteSourceFinding[] = [];
  const others = otherSources.map(normalizedWords);
  QUOTE.lastIndex = 0;
  for (let match = QUOTE.exec(answer); match; match = QUOTE.exec(answer)) {
    const quote = (match[1] ?? match[2] ?? "").trim();
    if (quote.split(/\s+/u).length < 4) continue;
    const end = match.index + match[0].length;
    // A quote marked with its case document ("„…” [[LEXDOC:…]]") is that document's words, not the
    // provision standing near it (live case: a message quoted from the file was compared with art. 190a k.k.).
    if (/^[\s*_)]*\[\[LEXDOC/u.test(answer.slice(end, end + 40))) continue;
    // The provision right after the quote ("…”, art. 41 ust. 2") or the last one before it in the sentence.
    const after = /^[\s)]*(?:⚠️\s*\[[^\]]*\]\s*)?[,;(–—-]?\s*\(?\s*(art\.[^\n;)]{0,80})/u.exec(answer.slice(end, end + 120))?.[1];
    // The sentence before the quote: a full stop followed by a capital ends a sentence ("art. 483" does not).
    const windowStart = Math.max(answer.lastIndexOf("\n", match.index) + 1, match.index - 240, 0);
    const before = answer.slice(windowStart, match.index);
    const ends = [...before.matchAll(/[.!?]\s+(?=[\p{Lu}„])(?<!\b(?:art|ust|pkt|lit|nr|poz|Dz|U|r|zm|t\.j|k\.c|k\.p)\.\s+)/gu)];
    const sentenceStart = windowStart + (ends.length ? ends.at(-1)!.index! + ends.at(-1)![0].length : 0);
    const provision = (after ? provisionOf(after, "first") : null) ?? provisionOf(answer.slice(sentenceStart, match.index));
    if (!provision) continue;
    const candidates = statutes.filter((item) => item.evidence && sameProvision(item.claim, provision));
    // The record naming the same act first, then the most specific one.
    const record = candidates
      .map((item) => ({ item, score: matchScore(provision, provisionOf(item.claim)) }))
      .sort((a, b) => b.score - a.score)[0]?.item;
    if (!record?.evidence) continue;
    const words = normalizedWords(quote);
    if (normalizedWords(record.evidence).includes(words)) continue;
    // The quote is the words of another source the model read (a letter in the file, a ruling).
    if (others.some((other) => other.includes(words))) continue;
    // The same quote elsewhere in the answer with its case document's marker.
    if (new RegExp(`[„“]${escapeRegExp(quote)}[”"]\\s*[*_]*\\s*\\[\\[LEXDOC`, "u").test(answer)) continue;
    findings.push({ kind: "STATUTE", quote, claim: record.claim, wording: record.evidence.replace(/\s+/gu, " ").trim().slice(0, 900) });
  }
  return findings;
}

/** Quotations the document gate marked: attributed to a case document and not found in it. */
export function documentQuoteFindings(markedAnswer: string): QuoteSourceFinding[] {
  const findings: QuoteSourceFinding[] = [];
  QUOTE.lastIndex = 0;
  for (let match = QUOTE.exec(markedAnswer); match; match = QUOTE.exec(markedAnswer)) {
    const end = match.index + match[0].length;
    if (!markedAnswer.slice(end, end + QUOTE_UNSOURCED_MARKER.length + 2).includes(QUOTE_UNSOURCED_MARKER)) continue;
    findings.push({ kind: "DOCUMENT", quote: (match[1] ?? match[2] ?? "").trim() });
  }
  return findings;
}

export function quoteCorrectionPrompt(findings: readonly QuoteSourceFinding[]): string {
  const lines = findings.map((item) =>
    item.kind === "STATUTE"
      ? `- Cytat „${item.quote}” przypisany do ${item.claim} nie jest jego brzmieniem. Brzmienie zweryfikowane w tej turze: „${item.wording}”. Zastąp cytat dosłownym fragmentem tego brzmienia albo usuń cudzysłów i opisz treść własnymi słowami.`
      : `- Cytat „${item.quote}” przypisany do dokumentu sprawy nie występuje w aktach. Zastąp go dosłownym fragmentem dokumentu albo usuń cudzysłów i opisz treść własnymi słowami; nie twórz cytatu, którego w dokumencie nie ma.`
  );
  return ["KOREKTA CYTATÓW: cytat musi być słowami swojego źródła.", ...lines, "Resztę odpowiedzi zostaw bez zmian."].join("\n");
}
