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

type Provision = { article: string; paragraph?: string; section?: string };

function provisionOf(text: string): Provision | null {
  let last: RegExpExecArray | null = null;
  PROVISION.lastIndex = 0;
  for (let match = PROVISION.exec(text); match; match = PROVISION.exec(text)) last = match;
  if (!last) return null;
  return { article: last[1]!.toLowerCase(), ...(last[2] ? { paragraph: last[2] } : {}), ...(last[3] ? { section: last[3] } : {}) };
}

function sameProvision(claim: string, provision: Provision): boolean {
  const own = provisionOf(claim);
  if (!own || own.article !== provision.article) return false;
  if (provision.paragraph && own.paragraph && own.paragraph !== provision.paragraph) return false;
  if (provision.section && own.section && own.section !== provision.section) return false;
  return true;
}

/** Quotations of provisions that are not the verified wording of that provision. */
export function statuteQuoteFindings(answer: string, statutes: ReadonlyArray<{ claim: string; evidence?: string }>): QuoteSourceFinding[] {
  const findings: QuoteSourceFinding[] = [];
  QUOTE.lastIndex = 0;
  for (let match = QUOTE.exec(answer); match; match = QUOTE.exec(answer)) {
    const quote = (match[1] ?? match[2] ?? "").trim();
    if (quote.split(/\s+/u).length < 4) continue;
    const end = match.index + match[0].length;
    // The provision right after the quote ("…”, art. 41 ust. 2") or the last one before it in the sentence.
    const after = /^[\s)]*(?:⚠️\s*\[[^\]]*\]\s*)?[,;(–—-]?\s*\(?\s*(art\.[^\n.;]{0,60})/u.exec(answer.slice(end, end + 120))?.[1];
    // The sentence before the quote: a full stop followed by a capital ends a sentence ("art. 483" does not).
    const windowStart = Math.max(answer.lastIndexOf("\n", match.index) + 1, match.index - 240, 0);
    const before = answer.slice(windowStart, match.index);
    const ends = [...before.matchAll(/[.!?]\s+(?=[\p{Lu}„])(?<!\b(?:art|ust|pkt|lit|nr|poz|Dz|U|r|zm|t\.j|k\.c|k\.p)\.\s+)/gu)];
    const sentenceStart = windowStart + (ends.length ? ends.at(-1)!.index! + ends.at(-1)![0].length : 0);
    const provision = (after ? provisionOf(after) : null) ?? provisionOf(answer.slice(sentenceStart, match.index));
    if (!provision) continue;
    const record = statutes.find((item) => item.evidence && sameProvision(item.claim, provision));
    if (!record?.evidence) continue;
    if (normalizedWords(record.evidence).includes(normalizedWords(quote))) continue;
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
