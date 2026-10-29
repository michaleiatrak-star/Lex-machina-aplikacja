import { euAct } from "./eu-law-verifier.js";
import { ARTICLE_LEAD, DOTTED_ACT_ALTERNATIVES, DOTTED_STATUTE, SPELLED_ACT_ALTERNATIVES, canonicalArticleLead, compactActAbbreviations, withStatuteTitles } from "./legal-act-abbreviations.js";
import { amountMarkerSpans, amountMatches, evidenceHasAmount, markerSpansAfter } from "./amount-references.js";
import { interpretationSignaturesInLine } from "./interpretation-verifier.js";
import { verificationMarker } from "./source-anchor.js";
import { statuteClaimsInLine } from "./status-consistency-gate.js";
import { caseFileKey } from "./verification-ledger.js";
import { signaturesIn } from "./court-of-signature.js";
import {
  VerificationLedger,
  type VerificationRecord
} from "./verification-ledger.js";

// "amount": stawka, termin, kara albo sankcja liczbowo (PRAWO-HARDGATE, ZASADA ABSOLUTNA);
// tylko w findings bramki, nie w references (to nie jest osobne powołanie źródła).
export type LegalReferenceKind = "statute" | "journal" | "case" | "interpretation" | "amount";

export type DetectedLegalReference = {
  // A statute cited without its act ("Art. 233" under a heading about the
  // Criminal Code) carries the act resolved from the line or the answer.
  claim: string;
  kind: LegalReferenceKind;
  line: number;
  lineText: string;
  // The text as written, when it differs from the claim.
  span?: string;
};

export type FinalizationFinding = {
  reference: DetectedLegalReference;
  status:
    | "VERIFIED"
    | "UNVERIFIED_MARKED"
    | "MISSING_LEDGER_RECORD"
    | "MISSING_VERIFICATION_MARKER"
    | "VERIFICATION_MARKER_MISMATCH"
    | "UNVERIFIED_NOT_MARKED";
  record?: VerificationRecord;
};

export type CaseQuoteFinding = {
  evidenceHash: string;
  line: number;
  lineText: string;
  status:
    | "VERIFIED"
    | "MISSING_CASE_QUOTE_LEDGER"
    | "QUOTE_TEXT_MISMATCH"
    | "CASE_SIGNATURE_MISSING";
  record?: VerificationRecord;
};

export type CaseSupportFinding = {
  evidenceHash: string;
  line: number;
  lineText: string;
  status:
    | "SUPPORTED"
    | "MISSING_CASE_SUPPORT_LEDGER"
    | "PROPOSITION_TEXT_MISMATCH"
    | "SUPPORT_QUOTE_MISSING"
    | "CASE_SIGNATURE_MISSING";
  record?: VerificationRecord;
};

export type FinalizationReport = {
  gate: "G8_HARD_GATE_FINALIZATION";
  result: "PASS" | "DEGRADED" | "BLOCKED";
  references: DetectedLegalReference[];
  findings: FinalizationFinding[];
  caseQuoteFindings: CaseQuoteFinding[];
  caseSupportFindings: CaseSupportFinding[];
};

const VERIFIED_MARKER = /✅\s*\[VER:/iu;
const VERIFIED_MARKER_TOKEN =
  /✅\s*\[VER:[^\]\r\n]+\]/giu;
// 🟨 KOTWICA URZĘDOWA (kanon PRAWO-HARDGATE-BLOKADA) nie jest ✅: liczy się jak oznaczony ⚠️.
const UNVERIFIED_MARKER = /⚠️?\s*\[NIEWERYFIKOWANE(?::[^\]\r\n]*)?\]|🟨\s*\[KOTWICA-URZĘDOWA[:\]]/iu;
const CASE_QUOTE_MARKER =
  /✅\s*\[CASE-QUOTE:([a-f0-9]{20})\]/giu;
const CASE_SUPPORT_MARKER =
  /🔗\s*\[CASE-SUPPORT:([a-f0-9]{20})\]/giu;

export function expectedVerificationMarker(
  record: VerificationRecord
): string | null {
  return verificationMarker(record);
}

// "art. 101² § 1 Kodeksu pracy" is one provision (KP), as "art. 101^2 § 1 KP".
// "art. 187 § 1 pkt 3 KPC": the point belongs to the provision, so a marker never splits it.
// "§ 2¹" is its own paragraph (art. 30 § 2¹ KP), not § 2 with a stray digit after the marker;
// "§ 2–3" is one reference with its act, the marker after the range (C12-007: "§ 2 ⚠️–3").
const SUPERSCRIPT = "(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\\^\\d+)?";
const UNIT_RANGE = `(?:[–—-]\\d+${SUPERSCRIPT}[a-z]?(?![\\d\\p{L}]))?`;
const ARTICLE_PATTERN = new RegExp(
  `${ARTICLE_LEAD}\\d+(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\\^\\d+)?[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*(?:\\s*§\\s*\\d+${SUPERSCRIPT}[a-zA-Z]*${UNIT_RANGE})?(?:\\s+ust\\.?\\s*\\d+${SUPERSCRIPT}[a-z]*${UNIT_RANGE})?(?:\\s+pkt\\s*\\d+${SUPERSCRIPT}[a-z]*${UNIT_RANGE})?(?:\\s+(?:${SPELLED_ACT_ALTERNATIVES}|${DOTTED_ACT_ALTERNATIVES}|KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)(?![\\p{L}]))?`,
  "giu"
);

const DZU_PATTERN =
  /\bDz\.?\s*U\.?\s*(?:(?:z\s+)?\d{4}\s*r?\.?\s*)?poz\.?\s*\d+/giu;

const CASE_PATTERN =
  /\bsygn\.?\s*(?:akt\s*)?[A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,8}(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,12}){0,3}\s+\d+\/\d{2,4}\b/gu;

function normalizeEvidenceText(
  value: string
): string {
  return value
    .normalize("NFKC")
    .toLocaleUpperCase("pl")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectMatches(
  lineText: string,
  line: number,
  kind: DetectedLegalReference["kind"],
  pattern: RegExp
): DetectedLegalReference[] {
  const references: DetectedLegalReference[] = [];
  pattern.lastIndex = 0;
  for (const match of lineText.matchAll(pattern)) {
    // "art. 233 k.k." and "art. 233 KK" are one provision.
    const written = match[0]?.trim() ?? "";
    // "art.415 KC" i "artykułem 415 KC" to ten sam przepis co "art. 415 KC".
    const claim = kind === "statute" ? canonicalArticleLead(compactActAbbreviations(written)) : written;
    if (!claim) continue;
    references.push({ claim, kind, line, lineText, ...(claim !== written ? { span: written } : {}) });
  }
  return references;
}

const ACT_SUFFIX = /\s(KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)$/u;
const ACT_IN_TEXT = /(?<![\p{L}])(KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)(?![\p{L}])/gu;
// Another act named in words: an act-less article on such a line is not resolved.
const OTHER_ACT = /(?<![\p{L}])(?:ustaw\p{L}*|konstytucj\p{L}*|ordynacj\p{L}*|praw[aoe]?\s+(?:budowlan|bankow|upadłościow|restrukturyzacyjn|energetyczn|autorsk|wodn|geologiczn|lotnicz|pocztow|telekomunikacyjn|przedsiębiorc|o\s+notariacie|o\s+adwokaturze|ochrony\s+środowiska|zamówień|prywatn|spółdzielcz|łowieck|atomow|farmaceutyczn|oświatow|restrukturyz)\p{L}*|pr\.?\s?(?:up|bud|bank|rest|energ|aut|ochr\.?\s?śr|zam\.?\s?publ)\.?|rozporządzeni\p{L}*(?=\s+(?:\(\s*(?:UE|WE|EWG)|Rady|Ministr|Prezesa|Parlamentu|Komisji|wykonawcz|delegowan|nr\b|w\s+sprawie))|dyrektyw\p{L}*|kodeks\p{L}*|p\.?\s?p\.?\s?s\.?\s?a\.?|Dz\.?\s?U\.?|traktat\p{L}*|konwencj\p{L}*|regulamin\p{L}*|statut\p{L}*|umow\p{L}*|TFUE|TUE|RODO|EKPC)(?![\p{L}])/iu;

// A line naming another act: in words, or as a dotted statute abbreviation ("u.k.k.").
const namesOtherAct = (lineText: string): boolean =>
  OTHER_ACT.test(compactActAbbreviations(withStatuteTitles(lineText))) || DOTTED_STATUTE.test(lineText);

const actsIn = (value: string): Set<string> =>
  new Set([...compactActAbbreviations(value).matchAll(ACT_IN_TEXT)].map((match) => match[1]!));

/**
 * The act of an act-less statute: the only act on its line, else the act this
 * article carries elsewhere in the answer, else the only act of the answer.
 * Never across another act named in words ("art. 4 ustawy o …").
 */
function resolveActs(references: DetectedLegalReference[], text: string): DetectedLegalReference[] {
  const actsByUnit = new Map<string, Set<string>>();
  for (const reference of references) {
    const act = reference.kind === "statute" ? ACT_SUFFIX.exec(reference.claim)?.[1] : undefined;
    if (!act) continue;
    const unit = reference.claim.replace(ACT_SUFFIX, "").replace(/\s+/g, " ").toLocaleLowerCase("pl");
    actsByUnit.set(unit, (actsByUnit.get(unit) ?? new Set()).add(act));
  }
  const answerActs = actsIn(text);
  return references.map((reference) => {
    if (reference.kind !== "statute" || ACT_SUFFIX.test(reference.claim)) return reference;
    // "art. 41¹ Kodeksu pracy" on the line is KP, not another act (live C13-019: art. 177 of the same
    // answer stayed act-less and ⚠️ next to a verified art. 177 KP).
    if (namesOtherAct(reference.lineText)) return reference;
    // An EU act named after the article ("art. 5 AI Act", "art. 6 GDPR"): never a Polish act
    // borrowed from elsewhere in the answer (before, "art. 5 AI Act" became "art. 5 KC").
    const written = reference.span ?? reference.claim;
    const found = new RegExp(`${written.replace(/[.*+?^$()|[\]\\{}]/gu, "\\$&")}(?![\\d\\p{L}^])`, "u").exec(reference.lineText);
    const own = found ? reference.lineText.slice(found.index + found[0].length).split(/(?<![\p{L}])art(?:ykuł\p{L}*|\.)\s*\d/iu)[0]!.slice(0, 160) : "";
    if (euAct(own)) return reference;
    const unit = reference.claim.replace(/\s+/g, " ").toLocaleLowerCase("pl");
    // "sprzeczne z art. 6 ust. 4 i nie wiąże (art. 58 § 1 i § 3 k.c.)": the k.c. is art. 58's own
    // (C12-018 verified art. 6 ust. 4 of the tenants' act as art. 6 KC). The line's act counts when
    // it follows this article ("art. 23 i 24 KC"), in a bare enumeration, or stands before it.
    const before = found ? reference.lineText.slice(0, found.index) : "";
    const lineActOwned =
      actsIn(own).size > 0 || /^\s*(?:,|i|oraz|lub|albo|a także|[–-])?\s*$/u.test(own) || actsIn(before).size > 0;
    const lineActs = lineActOwned ? actsIn(reference.lineText) : new Set<string>();
    const borrowedOnly = !lineActOwned && actsIn(reference.lineText).size > 0;
    const unitActs = actsByUnit.get(unit);
    const act =
      lineActs.size === 1
        ? [...lineActs][0]
        : lineActs.size === 0 && unitActs?.size === 1
          ? [...unitActs][0]
          : !borrowedOnly && lineActs.size === 0 && answerActs.size === 1
            ? [...answerActs][0]
            : undefined;
    return act ? { ...reference, claim: `${reference.claim} ${act}`, span: reference.span ?? reference.claim } : reference;
  });
}

const APP_CONTROL_NOTE = /^\s*⚠️?\uFE0F?\s*Kontrola aplikacji:/u;

// Units after the article number in a ledger claim ("art. 35 ust. 3 Prawa budowlanego" -> the act
// "Prawa budowlanego").
const CLAIM_UNITS = /^art\.\s*\d+[a-z]*(?:\^\d+)?(?:\s*(?:,|i|oraz)?\s+(?:§|ust\.?|pkt|lit\.?|zd\.?)\s*[\da-z]+(?:\^\d+)?)*\s*/iu;
// Codes are divided into paragraphs: "ust." never is a code's unit.
const CODE_ACT = /^(?:KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|KKS|KKW)$/u;
const ARTICLE_NUMBER = /^art\.\s*(\d+[a-z]*(?:\^\d+)?)/iu;
// Status markers after an article are no act ("✅ [VER: …/eli/acts/DU/…]").
const STATUS_MARKERS = /✅\s*\[VER:[^\]\r\n]*\]|⚠️?\s*\[NIEWERYFIKOWANE\]|🟨\s*\[KOTWICA-URZĘDOWA[^\]\r\n]*\]/gu;
const escapeRegExp = (value: string): string => value.replace(/[.*+?^$()|[\]\\{}]/gu, "\\$&");

export type CompletedArticleAct = { line: number; claim: string; act: string };

/** Bare articles left after completion whose number this turn verified in several acts. */
export type AmbiguousBareArticle = { line: number; claim: string; acts: string[] };

export function ambiguousBareArticles(text: string, ledger: VerificationLedger): AmbiguousBareArticle[] {
  const actsByNumber = verifiedActsByNumber(ledger);
  const result: AmbiguousBareArticle[] = [];
  for (const reference of detectLegalReferences(text)) {
    if (reference.kind !== "statute") continue;
    const guessed = Boolean(reference.span) && ACT_SUFFIX.test(reference.claim);
    if (ACT_SUFFIX.test(reference.claim) && !guessed) continue;
    const number = ARTICLE_NUMBER.exec(reference.claim)?.[1]?.toLocaleLowerCase("pl");
    const acts = number ? actsByNumber.get(number) : undefined;
    if (!acts || acts.size < 2) continue;
    const written = reference.span ?? reference.claim;
    const at = reference.lineText.indexOf(written);
    const own = at < 0 ? "" : reference.lineText.slice(at + written.length).replace(STATUS_MARKERS, "").split(/(?<![\p{L}])art(?:ykuł\p{L}*|\.)\s*\d/iu)[0]!.slice(0, 120);
    if (actsIn(own).size > 0 || namesOtherAct(own) || euAct(own)) continue;
    result.push({ line: reference.line, claim: reference.span ?? reference.claim, acts: [...acts].map(actLabel) });
  }
  return result;
}

function verifiedActsByNumber(ledger: VerificationLedger): Map<string, Set<string>> {
  const actsByNumber = new Map<string, Set<string>>();
  for (const record of ledger.all()) {
    if (record.status !== "VERIFIED" || record.kind !== "statute") continue;
    const claim = canonicalArticleLead(compactActAbbreviations(record.claim));
    const number = ARTICLE_NUMBER.exec(claim)?.[1]?.toLocaleLowerCase("pl");
    const act = claim.replace(CLAIM_UNITS, "").trim();
    if (!number || !act) continue;
    actsByNumber.set(number, (actsByNumber.get(number) ?? new Set()).add(act));
  }
  return actsByNumber;
}

const DOTTED_CODE: Record<string, string> = { KC: "k.c.", KPC: "k.p.c.", KK: "k.k.", KPK: "k.p.k.", KPA: "k.p.a.", KP: "k.p.", KRO: "k.r.o.", KSH: "k.s.h.", KW: "k.w.", KPW: "k.p.w." };

/**
 * The Dz.U. address of the text each provision was read from in ELI, written once per act at
 * its first citation ("art. 415 KC (Dz.U. 2026 poz. 795)"), when the answer gives that act no
 * Dz.U. address of its own. From the ledger, never from the model's memory: of the Dz.U.
 * addresses models wrote in test 500 only 48% were the text actually read.
 */
export function addVerifiedJournalAddresses(text: string, ledger: VerificationLedger): { text: string; added: string[] } {
  const journalByAct = new Map<string, string>();
  for (const record of ledger.all()) {
    if (record.status !== "VERIFIED" || record.kind !== "statute") continue;
    const eli = record.currentEli ?? /\/eli\/acts\/(DU\/\d{4}\/\d+)\//u.exec(record.sourceUrl ?? "")?.[1];
    const match = eli ? /^DU\/(\d{4})\/(\d+)$/u.exec(eli) : null;
    const act = canonicalArticleLead(compactActAbbreviations(record.claim)).replace(CLAIM_UNITS, "").trim();
    if (!match || !act || journalByAct.has(act)) continue;
    journalByAct.set(act, `Dz.U. ${match[1]} poz. ${match[2]}`);
  }
  if (journalByAct.size === 0) return { text, added: [] };
  const lines = text.split("\n");
  const added: string[] = [];
  const done = new Set<string>();
  for (const reference of detectLegalReferences(text)) {
    if (reference.kind !== "statute" || reference.span) continue;
    const code = ACT_SUFFIX.exec(reference.claim)?.[1];
    const lineText = lines[reference.line - 1] ?? "";
    let act: string | undefined;
    let end = -1;
    if (code) {
      act = code;
      const written = new RegExp(`${escapeRegExp(reference.claim.replace(ACT_SUFFIX, ""))}\\s+(?:${escapeRegExp(code)}|${escapeRegExp(DOTTED_CODE[code] ?? code)})(?![\\p{L}])`, "iu").exec(lineText);
      if (written) end = written.index + written[0].length;
    } else {
      const at = lineText.indexOf(reference.claim);
      const after = at < 0 ? "" : lineText.slice(at + reference.claim.length);
      act = [...journalByAct.keys()].find((name) => !ACT_SUFFIX.test(` ${name}`) && after.toLocaleLowerCase("pl").startsWith(` ${actLabel(name).toLocaleLowerCase("pl")}`));
      if (act) end = at + reference.claim.length + 1 + actLabel(act).length;
    }
    if (!act || end < 0 || done.has(act)) continue;
    const journal = journalByAct.get(act);
    if (!journal) continue;
    done.add(act);
    // The act already has an address in the answer: the model's own stays (G8 checks it).
    if (/Dz\.\s?U\./u.test(lineText.slice(end, end + 80)) || text.includes(journal)) continue;
    lines[reference.line - 1] = `${lineText.slice(0, end)} (${journal})${lineText.slice(end)}`;
    added.push(`${act}: ${journal}`);
  }
  return added.length ? { text: lines.join("\n"), added } : { text, added };
}

/** The units of the reference ("art. 35 ust. 3") exist in a VERIFIED record of the act. */
function unitInVerifiedAct(ledger: VerificationLedger, claim: string, act: string): boolean {
  const canonical = canonicalArticleLead(compactActAbbreviations(claim));
  const units = canonical.replace(ARTICLE_NUMBER, "").trim();
  if (!units) return true;
  if (CODE_ACT.test(act) && /(?<![\p{L}])ust\./iu.test(units)) return false;
  const wanted = comparableClaim(`${canonical} ${act}`);
  const article = ARTICLE_NUMBER.exec(canonical)?.[0] ?? "";
  return ledger.all().some((record) => {
    if (record.status !== "VERIFIED" || record.kind !== "statute") return false;
    const recordClaim = comparableClaim(canonicalArticleLead(compactActAbbreviations(record.claim)));
    if (recordClaim === wanted || recordClaim.startsWith(wanted.replace(comparableClaim(act), "").trim() + " ") && recordClaim.endsWith(comparableClaim(act))) return true;
    // The whole article read: its text has the unit ("§ 3", "3." for ust. 3, "3)" for pkt 3).
    if (recordClaim !== comparableClaim(`${article} ${act}`) || !record.evidence) return false;
    return [...units.matchAll(/(§|ust\.?|pkt|lit\.?)\s*(\d+[a-z]*|[a-z])\b/giu)].every(([, kind, value]) => {
      const unit = escapeRegExp(value!);
      const pattern = kind === "§" ? `§\\s*${unit}(?![\\d\\p{L}])` : kind!.startsWith("ust") ? `(?<!§\\s*)(?:^|\\s)${unit}\\.\\s` : `(?:^|\\s)${unit}\\)`;
      return new RegExp(pattern, "iu").test(record.evidence!);
    });
  });
}

/** "o Policji" read off a claim is "ustawy o Policji" in the text. */
const actLabel = (act: string): string => (/^o\s/iu.test(act) ? `ustawy ${act}` : act);

/**
 * The act of an article the answer cites bare ("art. 36a"), written into the text when the turn
 * verified that article number in exactly one act ("art. 36a u.k.s.c." read from ELI): the
 * reader sees which act is meant and every gate reads the same provision. No model call.
 * Test 500 dumps: 43% of answers cite articles bare; 61% of those have one verified act.
 * An article verified in several acts, or in none, is left as written (G8 marks or asks).
 */
export function completeBareArticleActs(
  text: string,
  ledger: VerificationLedger
): { text: string; completed: CompletedArticleAct[] } {
  const actsByNumber = new Map<string, Set<string>>();
  for (const record of ledger.all()) {
    if (record.status !== "VERIFIED" || record.kind !== "statute") continue;
    const claim = canonicalArticleLead(compactActAbbreviations(record.claim));
    const number = ARTICLE_NUMBER.exec(claim)?.[1]?.toLocaleLowerCase("pl");
    const act = claim.replace(CLAIM_UNITS, "").trim();
    if (!number || !act) continue;
    actsByNumber.set(number, (actsByNumber.get(number) ?? new Set()).add(act));
  }
  if (actsByNumber.size === 0) return { text, completed: [] };
  const references = detectLegalReferences(text);
  // The same number written with another act elsewhere in the answer: not completed (ambiguous).
  const writtenActs = new Map<string, Set<string>>();
  const ownText = (reference: DetectedLegalReference): string => {
    const found = new RegExp(`${escapeRegExp(reference.span ?? reference.claim)}(?![\\d\\p{L}^¹²³⁴⁵⁶⁷⁸⁹⁰])`, "u").exec(reference.lineText);
    return found ? reference.lineText.slice(found.index + found[0].length).replace(STATUS_MARKERS, "").split(/(?<![\p{L}])art(?:ykuł\p{L}*|\.)\s*\d/iu)[0]!.slice(0, 120) : "";
  };
  for (const reference of references) {
    if (reference.kind !== "statute") continue;
    const number = ARTICLE_NUMBER.exec(reference.claim)?.[1]?.toLocaleLowerCase("pl");
    if (!number) continue;
    // Written with a code ("art. 35 KPA") or with an act named in words after it ("art. 35 ust. 3
    // Prawa budowlanego"): the act this number has in the answer's own words.
    const act = !reference.span ? ACT_SUFFIX.exec(reference.claim)?.[1] : undefined;
    const named = !act && namesOtherAct(ownText(reference)) ? "\u0000named" : undefined;
    if (act || named) writtenActs.set(number, (writtenActs.get(number) ?? new Set()).add((act ?? named)!));
  }
  const lines = text.split("\n");
  const completed: CompletedArticleAct[] = [];
  const cursor = new Map<number, number>();
  for (const reference of references) {
    if (reference.kind !== "statute") continue;
    // An act the gate borrowed from the line or the answer ("art. 7 KPA …, art. 49g" read as
    // art. 49g KPA) is a guess: written as bare, unless that act has the article verified.
    const guessed = Boolean(reference.span) && ACT_SUFFIX.exec(reference.claim)?.[1];
    if (ACT_SUFFIX.test(reference.claim) && !guessed) continue;
    const number = ARTICLE_NUMBER.exec(reference.claim)?.[1]?.toLocaleLowerCase("pl");
    const acts = number ? actsByNumber.get(number) : undefined;
    if (!number || !acts || acts.size !== 1) continue;
    const act = [...acts][0]!;
    if (guessed && act === guessed) continue;
    const written = writtenActs.get(number);
    if (written && [...written].some((other) => other !== act)) continue;
    // "art. 35 ust. 3" with only art. 35 KPA verified: KPA has paragraphs, no ust. 3 — the
    // article is Prawo budowlane's. The unit written has to be in the verified act.
    if (!unitInVerifiedAct(ledger, guessed ? reference.span! : reference.claim, act)) continue;
    const lineText = lines[reference.line - 1] ?? "";
    const from = cursor.get(reference.line) ?? 0;
    const found = new RegExp(`${escapeRegExp(reference.span ?? reference.claim)}(?![\\d\\p{L}^¹²³⁴⁵⁶⁷⁸⁹⁰])`, "u").exec(lineText.slice(from));
    if (!found) continue;
    const end = from + found.index + found[0].length;
    // An act already written after the article ("art. 36a ustawy o …", "art. 5 AI Act", "art. 23 i 24 KC").
    const own = lineText.slice(end).replace(STATUS_MARKERS, "").split(/(?<![\p{L}])art(?:ykuł\p{L}*|\.)\s*\d/iu)[0]!.slice(0, 120);
    if (actsIn(own).size > 0 || namesOtherAct(own) || euAct(own) || /^\s*(?:,|i|oraz|lub|albo|a także|[–-])\s*\d/u.test(own)) {
      cursor.set(reference.line, end);
      continue;
    }
    const label = actLabel(act);
    lines[reference.line - 1] = `${lineText.slice(0, end)} ${label}${lineText.slice(end)}`;
    cursor.set(reference.line, end + label.length + 1);
    completed.push({ line: reference.line, claim: reference.claim, act: label });
  }
  return completed.length ? { text: lines.join("\n"), completed } : { text, completed };
}

export function detectLegalReferences(text: string): DetectedLegalReference[] {
  const references: DetectedLegalReference[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((lineText, index) => {
    const line = index + 1;
    // The application's own control note names the judgment it checked; it is no claim.
    if (APP_CONTROL_NOTE.test(lineText)) return;
    references.push(
      ...collectMatches(lineText, line, "statute", ARTICLE_PATTERN),
      ...collectMatches(lineText, line, "journal", DZU_PATTERN),
      ...collectMatches(lineText, line, "case", CASE_PATTERN),
      ...interpretationSignaturesInLine(lineText).map((claim) => ({ claim, kind: "interpretation" as const, line, lineText }))
    );
    // A signature without "sygn." ("uchwała SN z 2021 r., III CZP 12/21") is case law as well;
    // it used to pass the hard gate unchecked. Only repertories of a known court count.
    const written = references.filter((reference) => reference.line === line && (reference.kind === "case" || reference.kind === "interpretation"));
    for (const { signature } of signaturesIn(lineText)) {
      if (written.some((reference) => caseFileKey(reference.claim) === caseFileKey(signature) || reference.claim.includes(signature))) continue;
      references.push({ claim: signature, kind: "case", line, lineText });
    }
  });

  return resolveActs(references, text);
}

function comparableClaim(value: string): string {
  return compactActAbbreviations(value)
    .normalize("NFKC")
    .toLocaleLowerCase("pl")
    .replace(/[.,;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Wykrywanie rozpoznaje "art. 46", a zweryfikowano "art. 46 ust. 2 ustawy o ...": zapis
// bardziej szczegółowej jednostki tego artykułu obejmuje wzmiankę, gdy jego znacznik VER
// stoi w tym samym wierszu. Tylko jeden taki zapis; inaczej brak dopasowania.
function coveringVerifiedRecord(
  ledger: VerificationLedger,
  reference: DetectedLegalReference,
  lineMarkers: string[]
): VerificationRecord | undefined {
  if (reference.kind !== "statute") return undefined;
  const prefix = comparableClaim(reference.claim) + " ";
  const covering = ledger
    .all()
    .filter(
      (record) =>
        record.status === "VERIFIED" &&
        comparableClaim(record.claim).startsWith(prefix)
    )
    .filter((record) => {
      const marker = expectedVerificationMarker(record);
      return Boolean(marker) && lineMarkers.includes(marker!);
    });
  const claims = new Set(covering.map((record) => comparableClaim(record.claim)));
  // "art. 233 KK" and "art. 233 § 1 KK" with one marker on the line: one source.
  const markers = new Set(covering.map((record) => expectedVerificationMarker(record)));
  return claims.size === 1 || markers.size === 1 ? covering.at(-1) : undefined;
}

// "art. 286 § 1 KK" mentioned, "art. 286 KK" verified: the article's fetched text covers the
// units it holds (never the reverse, never a record without its text).
const ARTICLE_UNIT = /^(art\.?\s*\d+[a-zA-Z⁰¹²³⁴⁵⁶⁷⁸⁹^]*)\s+(?:§|ust\.?|pkt|lit\.?|zd\.?)[^]*?\s(KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)$/iu;

function articleRecord(ledger: VerificationLedger, reference: DetectedLegalReference): VerificationRecord | undefined {
  if (reference.kind !== "statute") return undefined;
  const match = ARTICLE_UNIT.exec(reference.claim.trim());
  if (!match) return undefined;
  const record = ledger.latest(`${match[1]} ${match[2]}`);
  if (record?.status !== "VERIFIED" || !record.evidence) return undefined;
  // Only a unit the fetched text of the article has ("§ 9" of a three-paragraph article is not).
  const units = [...reference.claim.slice(match[1]!.length).matchAll(/(§|ust\.?|pkt|lit\.?)\s*(\d+[a-z]*|[a-z])\b/giu)];
  const present = units.every(([, kind, value]) => {
    const unit = value!.replace(/[.*+?^$()|[\]\\{}]/gu, "\\$&");
    const pattern = kind === "§" ? `§\\s*${unit}(?![\\d\\p{L}])` : kind!.startsWith("ust") ? `(?:^|\\s)${unit}\\.\\s` : `(?:^|\\s)${unit}\\)`;
    return new RegExp(pattern, "iu").test(record.evidence!);
  });
  return units.length > 0 && present ? record : undefined;
}

function verifiedMarkersOf(ledger: VerificationLedger, claim: string): string[] {
  return ledger
    .find(claim)
    .filter((record) => record.status === "VERIFIED")
    .map(expectedVerificationMarker)
    .filter((marker): marker is string => Boolean(marker));
}

// Words of an act's title that tell no act from another (dates, "ustawy").
const ACT_TITLE_NOISE = new Set([
  "ustawy", "ustawa", "ustawą", "ustawie", "dnia", "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca",
  "sierpnia", "września", "października", "listopada", "grudnia"
]);

/**
 * "art. 11 ustawy o zwalczaniu nieuczciwej konkurencji": an act named in words. The
 * session's verified record of that very article, whose title words all stand on the
 * line, is that provision (it is not marked unverified again). Only one such record.
 */
function namedActRecord(ledger: VerificationLedger, reference: DetectedLegalReference): VerificationRecord | undefined {
  if (reference.kind !== "statute" || ACT_SUFFIX.test(reference.claim) || !namesOtherAct(reference.lineText)) return undefined;
  const prefix = comparableClaim(reference.claim) + " ";
  const line = comparableClaim(withStatuteTitles(reference.lineText));
  const matching = ledger.all().filter((record) => {
    if (record.status !== "VERIFIED" || record.kind !== "statute") return false;
    const claim = comparableClaim(record.claim);
    if (!claim.startsWith(prefix)) return false;
    const tail = claim.slice(prefix.length);
    // The same unit only: "art. 11 ust. 2 ustawy …" is not the article mentioned as a whole.
    if (!/^(?:ustaw|kodeks|rozporządz|konstytucj)/u.test(tail)) return false;
    const words = tail.split(" ").filter((word) => word.length >= 5 && !/\d/u.test(word) && !ACT_TITLE_NOISE.has(word));
    return words.length > 0 && words.every((word) => line.includes(word));
  });
  return new Set(matching.map((record) => comparableClaim(record.claim))).size === 1 ? matching.at(-1) : undefined;
}

// A pleading's header line holding only the case number ("Sygn. akt I C 900/26"): the
// number of the proceeding the letter is filed in, wherever else the text repeats it.
const CASE_FILE_HEADER = /^\s*(?:\*\*)?(?:sygn\.?\s*(?:akt)?|sygnatura\s+akt)\s*:?\s*((?:[A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,8}\s+){1,4}\d+\/\d{2,4})\s*(?:\*\*)?\s*$/iu;

export function headerCaseFileNumbers(text: string): string[] {
  return text.split(/\r?\n/u).flatMap((line) => {
    const signature = CASE_FILE_HEADER.exec(line)?.[1];
    return signature ? [caseFileKey(signature)] : [];
  });
}

/** Case numbers of the user's own proceeding: header lines of the case's documents and signatures the user writes. */
export function ownCaseFileNumbers(documents: string[], userText: string): string[] {
  const own = new Set<string>();
  const SIGNATURE = /\bsygn\.?\s*(?:akt\s*)?:?\s*((?:[A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż0-9]{1,8}\s+){1,4}\d+\/\d{2,4})\b/giu;
  for (const document of documents) {
    // The header of a court letter, pleading or decision names its own case first; a
    // judgment of a top court attached as authority is not the user's proceeding.
    const head = document.slice(0, 1_200);
    if (/Sąd\s+Najwyższy|Naczelny\s+Sąd\s+Administracyjny|Trybunał\s+(?:Konstytucyjny|Sprawiedliwości)/iu.test(head)) continue;
    // A header line ("Sygn. akt I C 900/26", "Sygn. akt I Nc 1234/26 — nakaz"), not a sentence
    // naming another proceeding ("skazany wyrokiem …, sygn. akt II K 345/24, za czyn …").
    for (const line of head.split(/\r?\n/u)) {
      if (line.trim().length > 80) continue;
      for (const match of line.matchAll(SIGNATURE)) own.add(caseFileKey(match[1]!));
    }
  }
  // The user's own case ("w mojej sprawie sygn. akt …"), never a judgment the user asks about.
  for (const match of userText.matchAll(SIGNATURE)) {
    const before = userText.slice(Math.max(0, match.index! - 60), match.index!);
    if (/(?<![\p{L}])spraw\p{L}*/iu.test(before) && !/wyrok|uchwał|orzecz|postanowieni|(?<![\p{L}])(?:SN|NSA|WSA|TK|SA)(?![\p{L}])|Sąd\p{L}*\s+Najwyższ/iu.test(before)) {
      own.add(caseFileKey(match[1]!));
    }
  }
  return [...own];
}

/** Case signatures the case's documents (whole text) or the user's messages name. */
export function mentionedCaseNumbers(texts: string[]): string[] {
  // Written with "sygn." or bare ("w sprawie II K 345/24"), when its repertory names a court.
  return [
    ...new Set(
      texts.flatMap((text) => [
        ...detectLegalReferences(text).filter((reference) => reference.kind === "case").map((reference) => caseFileKey(reference.claim)),
        ...signaturesIn(text).map((item) => caseFileKey(item.signature))
      ])
    )
  ].filter(Boolean);
}

// Rekord orzeczenia nosi brzmienie podane przez model ("uchwała SN, sygn. I KZP 3/24"),
// a odpowiedź pisze "sygn. I KZP 3/24": rozstrzyga sygnatura znormalizowana przy weryfikacji.
const caseSignatureKey = (value: string): string =>
  value.replace(/^sygn\.?\s*(?:akt\s*)?/iu, "").replace(/\./g, "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pl");

export function caseSignatureRecord(ledger: VerificationLedger, reference: DetectedLegalReference): VerificationRecord | undefined {
  if (reference.kind !== "case") return undefined;
  const key = caseSignatureKey(reference.claim);
  const records = ledger.all().filter((record) => record.kind === "case" && (record.caseScope ?? "FULL_TEXT") === "FULL_TEXT" && record.caseSignature && caseSignatureKey(record.caseSignature) === key);
  return records.filter((record) => record.status === "VERIFIED").at(-1) ?? records.at(-1);
}

// ⚠️ przypięty do wartości liczbowej albo do innej sygnatury interpretacji nie oznacza
// powołania, które sprawdzamy (każde ma mieć własny znacznik).
function withoutAttachedMarkers(reference: DetectedLegalReference): string {
  const line = reference.lineText;
  const signatures = interpretationSignaturesInLine(line).filter((signature) => signature !== reference.claim && line.includes(signature));
  const spans = [
    ...amountMarkerSpans(line),
    ...markerSpansAfter(line, signatures.map((signature) => line.indexOf(signature) + signature.length))
  ];
  if (reference.kind === "interpretation" && line.includes(reference.claim)) {
    // Sygnatura sprawdzana: liczy się wyłącznie ⚠️ tuż za nią.
    return markerSpansAfter(line, [line.indexOf(reference.claim) + reference.claim.length]).length ? "⚠️ [NIEWERYFIKOWANE]" : "";
  }
  return spans
    .sort((a, b) => b.start - a.start)
    .reduce((text, span) => text.slice(0, span.start) + text.slice(span.end), line);
}

/**
 * "removed": the text is a document whose verification markers were stripped
 * before rendering (STRIP-VER-GATE). Each reference is then judged by the
 * ledger alone: VERIFIED passes, anything else needs the user's decision.
 * The markers themselves were checked on the marked text before stripping.
 */
export type FinalizationMarkers = "in-text" | "removed";

/** A Dz.U. address that is the ELI text a VERIFIED record of this session was read from. */
function journalSourceRecord(ledger: VerificationLedger, reference: DetectedLegalReference): VerificationRecord | undefined {
  if (reference.kind !== "journal") return undefined;
  const match = /(\d{4})\D{1,12}?poz\.?\s*(\d+)/u.exec(reference.claim);
  if (!match) return undefined;
  const eli = `DU/${match[1]}/${match[2]}`;
  return ledger
    .all()
    .find(
      (record) =>
        record.status === "VERIFIED" &&
        (record.currentEli === eli || (record.sourceUrl ?? "").includes(`/eli/acts/${eli}/`))
    );
}

// "art. 46" mentioned, "art. 46 ust. 2 ustawy o ..." verified: one such record covers it.
function soleCoveringVerifiedRecord(
  ledger: VerificationLedger,
  reference: DetectedLegalReference
): VerificationRecord | undefined {
  if (reference.kind !== "statute") return undefined;
  const prefix = comparableClaim(reference.claim) + " ";
  const covering = ledger
    .all()
    .filter((record) => record.status === "VERIFIED" && comparableClaim(record.claim).startsWith(prefix));
  return new Set(covering.map((record) => comparableClaim(record.claim))).size === 1 ? covering.at(-1) : undefined;
}

export class FinalizationGate {
  evaluate(text: string, ledger: VerificationLedger, options: { markers?: FinalizationMarkers | undefined } = {}): FinalizationReport {
    // The proceeding's own case number (pleading header, the case's documents) is not case law.
    const caseFiles = new Set([...ledger.caseFileNumbers(), ...headerCaseFileNumbers(text)]);
    const references = detectLegalReferences(text).filter((reference) => !(reference.kind === "case" && caseFiles.has(caseFileKey(reference.claim))));
    const findings: FinalizationFinding[] = [];
    const caseQuoteFindings: CaseQuoteFinding[] = [];
    const caseSupportFindings: CaseSupportFinding[] = [];

    for (const reference of references) {
      if (options.markers === "removed") {
        const record = ledger.latest(reference.claim) ?? soleCoveringVerifiedRecord(ledger, reference) ?? caseSignatureRecord(ledger, reference) ?? articleRecord(ledger, reference);
        findings.push(
          record?.status === "VERIFIED"
            ? { reference, status: "VERIFIED", record }
            : { reference, status: "UNVERIFIED_MARKED", ...(record ? { record } : {}) }
        );
        continue;
      }
      const lineMarkers:
        string[] =
          reference.lineText.match(
            VERIFIED_MARKER_TOKEN
          ) ?? [];
      const allowedLineMarkers =
        new Set<string>(
          references
            .filter(
              (candidate) =>
                candidate.line ===
                  reference.line
            )
            .map(
              (candidate) =>
                ledger.latest(
                  candidate.claim
                ) ??
                coveringVerifiedRecord(
                  ledger,
                  candidate,
                  lineMarkers
                ) ??
                caseSignatureRecord(ledger, candidate) ??
                namedActRecord(ledger, candidate) ??
                articleRecord(ledger, candidate)
            )
            .filter(
              (
                candidate
              ): candidate is VerificationRecord =>
                candidate?.status ===
                  "VERIFIED"
            )
            .map(
              expectedVerificationMarker
            )
            .filter(
              (
                marker
              ): marker is string =>
                Boolean(marker)
            )
        );
      // A provision verified in several versions (the history of its changes: the current text
      // and the text on a past date): the marker of each of its VERIFIED records is its own.
      for (const candidate of references) {
        if (candidate.line !== reference.line) continue;
        for (const marker of verifiedMarkersOf(ledger, candidate.claim)) allowedLineMarkers.add(marker);
      }
      // Wyliczenie "art. 233 i 234 KK": znacznik drugiego przepisu też należy do wiersza.
      for (const claim of statuteClaimsInLine(reference.lineText)) {
        const enumerated = ledger.latest(claim);
        const marker =
          enumerated?.status === "VERIFIED"
            ? expectedVerificationMarker(enumerated)
            : null;
        if (marker) allowedLineMarkers.add(marker);
      }
      const unexpectedLineMarker =
        lineMarkers.some(
          (marker) =>
            !allowedLineMarkers.has(
              marker
            )
        );

      const record =
        ledger.latest(reference.claim) ??
        coveringVerifiedRecord(ledger, reference, lineMarkers) ??
        caseSignatureRecord(ledger, reference) ??
        namedActRecord(ledger, reference) ??
        articleRecord(ledger, reference) ??
        // "art. 118" bez nazwy aktu, gdy w sesji zweryfikowano ten artykuł tylko jednego aktu ("art. 118 KC").
        (namesOtherAct(reference.lineText) ? undefined : soleCoveringVerifiedRecord(ledger, reference));
      // HARD GATE: no access to a source -> [NIEWERYFIKOWANE], never an
      // unmarked claim. A marked claim without any record is shown marked.
      const ownUnverified = UNVERIFIED_MARKER.test(withoutAttachedMarkers(reference));
      // "t.j. Dz.U. 2019 poz. 1950" przy przepisie odczytanym z tego właśnie tekstu w ELI:
      // adres publikacji jest potwierdzony tym samym odczytem.
      const sourceText = !record ? journalSourceRecord(ledger, reference) : undefined;
      if (sourceText) {
        findings.push({ reference, status: "VERIFIED", record: sourceText });
        continue;
      }
      if (!record && ownUnverified) {
        findings.push({
          reference,
          status: "UNVERIFIED_MARKED"
        });
        continue;
      }
      if (!record) {
        findings.push({
          reference,
          status: "MISSING_LEDGER_RECORD"
        });
        continue;
      }

      if (record.status === "VERIFIED") {
        // The version the line's marker names, when it is another VERIFIED record of this claim.
        const named = ledger.find(reference.claim).find((candidate) => {
          const marker = candidate.status === "VERIFIED" ? expectedVerificationMarker(candidate) : null;
          return Boolean(marker) && lineMarkers.includes(marker!);
        });
        if (named && named !== record && !unexpectedLineMarker) {
          findings.push({ reference, status: "VERIFIED", record: named });
          continue;
        }
        const expectedMarker =
          expectedVerificationMarker(
            record
          );

        // Zweryfikowany przepis pokazany ostrożniej, z własnym ⚠️ (np. po ujednoliceniu
        // sprzecznych statusów): zaniżenie statusu nie wprowadza w błąd, więc nie blokuje.
        if (ownUnverified && (!VERIFIED_MARKER.test(reference.lineText) || !expectedMarker || !lineMarkers.includes(expectedMarker))) {
          findings.push({ reference, status: "UNVERIFIED_MARKED", record });
          continue;
        }

        if (!VERIFIED_MARKER.test(reference.lineText)) {
          findings.push({
            reference,
            status: "MISSING_VERIFICATION_MARKER",
            record
          });
        } else if (
          !expectedMarker ||
          !lineMarkers.includes(
            expectedMarker
          ) ||
          unexpectedLineMarker
        ) {
          findings.push({
            reference,
            status:
              "VERIFICATION_MARKER_MISMATCH",
            record
          });
        } else {
          findings.push({
            reference,
            status: "VERIFIED",
            record
          });
        }
        continue;
      }

      if (ownUnverified) {
        findings.push({
          reference,
          status: "UNVERIFIED_MARKED",
          record
        });
      } else {
        findings.push({
          reference,
          status: "UNVERIFIED_NOT_MARKED",
          record
        });
      }
    }

    const lines = text.split(/\r?\n/u);

    // Stawka, termin, kara: potwierdzona brzmieniem przepisu VERIFIED z tego wiersza; wiersz
    // bez przepisu (cytat paragrafu, punkt "§ 3: … do lat 2") omawia ostatni przepis nad nim.
    const statuteRecord = (claim: string): VerificationRecord | undefined => {
      const record = ledger.latest(claim) ?? articleRecord(ledger, { claim, kind: "statute", line: 0, lineText: "" });
      return record?.status === "VERIFIED" && record.evidence ? record : undefined;
    };
    lines.forEach((lineText, index) => {
      const amounts = amountMatches(lineText);
      if (amounts.length === 0) return;
      const claimsOf = (line: number, text: string) => [
        ...references.filter((reference) => reference.line === line && reference.kind === "statute").map((reference) => reference.claim),
        ...statuteClaimsInLine(text)
      ];
      let claims = claimsOf(index + 1, lineText);
      for (let above = index - 1; claims.length === 0 && above >= 0; above -= 1) claims = claimsOf(above + 1, lines[above]!);
      // Nagłówek lub wstęp nad przepisem ("## Termin przedawnienia: 2 lata"): przepisy całej odpowiedzi;
      // liczba nadal musi stać w brzmieniu jednego z nich.
      if (claims.length === 0) claims = references.filter((reference) => reference.kind === "statute").map((reference) => reference.claim);
      const lineRecords = claims.map(statuteRecord).filter((record): record is VerificationRecord => Boolean(record));
      const marked = amountMarkerSpans(lineText);
      const facts = new Set(ledger.factAmountKeys());
      for (const amount of amounts) {
        if (facts.has(amount.key)) continue;
        const reference: DetectedLegalReference = { claim: amount.text, kind: "amount", line: index + 1, lineText };
        const record = lineRecords.find((candidate) => evidenceHasAmount(candidate.evidence!, amount.key));
        if (record) {
          findings.push({ reference, status: "VERIFIED", record });
        } else if (
          marked.some((span) => span.start >= amount.end && span.start <= amount.end + 3) ||
          (lineRecords.length === 0 && !VERIFIED_MARKER.test(lineText) && UNVERIFIED_MARKER.test(lineText))
        ) {
          findings.push({ reference, status: "UNVERIFIED_MARKED" });
        } else {
          findings.push({ reference, status: "UNVERIFIED_NOT_MARKED" });
        }
      }
    });

    lines.forEach((lineText, index) => {
      CASE_QUOTE_MARKER.lastIndex = 0;

      for (
        const match of lineText.matchAll(
          CASE_QUOTE_MARKER
        )
      ) {
        const evidenceHash =
          match[1] ?? "";
        if (!evidenceHash) {
          continue;
        }

        const record =
          ledger.all().find(
            (candidate) =>
              candidate.status ===
                "VERIFIED" &&
              candidate.kind === "case" &&
              candidate.caseScope ===
                "EXACT_QUOTE" &&
              candidate.evidenceHash ===
                evidenceHash
          );

        if (!record) {
          caseQuoteFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "MISSING_CASE_QUOTE_LEDGER"
          });
          continue;
        }

        if (
          !record.claim ||
          !lineText.includes(
            record.claim
          )
        ) {
          caseQuoteFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "QUOTE_TEXT_MISMATCH",
            record
          });
          continue;
        }

        const normalizedLine =
          normalizeEvidenceText(lineText);
        const normalizedSignature =
          normalizeEvidenceText(
            record.caseSignature ?? ""
          );

        if (
          !normalizedSignature ||
          !normalizedLine.includes(
            normalizedSignature
          )
        ) {
          caseQuoteFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "CASE_SIGNATURE_MISSING",
            record
          });
          continue;
        }

        caseQuoteFindings.push({
          evidenceHash,
          line: index + 1,
          lineText,
          status: "VERIFIED",
          record
        });
      }

      CASE_SUPPORT_MARKER.lastIndex = 0;

      for (
        const match of lineText.matchAll(
          CASE_SUPPORT_MARKER
        )
      ) {
        const evidenceHash =
          match[1] ?? "";
        if (!evidenceHash) {
          continue;
        }

        const record =
          ledger.all().find(
            (candidate) =>
              candidate.status ===
                "SUPPORTED" &&
              candidate.kind === "case" &&
              candidate.caseScope ===
                "PROPOSITION_SUPPORT" &&
              candidate.evidenceHash ===
                evidenceHash
          );

        if (!record) {
          caseSupportFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "MISSING_CASE_SUPPORT_LEDGER"
          });
          continue;
        }

        if (
          !record.claim ||
          !lineText.includes(
            record.claim
          )
        ) {
          caseSupportFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "PROPOSITION_TEXT_MISMATCH",
            record
          });
          continue;
        }

        if (
          !record.supportQuote ||
          !lineText.includes(
            record.supportQuote
          )
        ) {
          caseSupportFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "SUPPORT_QUOTE_MISSING",
            record
          });
          continue;
        }

        const normalizedLine =
          normalizeEvidenceText(lineText);
        const normalizedSignature =
          normalizeEvidenceText(
            record.caseSignature ?? ""
          );

        if (
          !normalizedSignature ||
          !normalizedLine.includes(
            normalizedSignature
          )
        ) {
          caseSupportFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "CASE_SIGNATURE_MISSING",
            record
          });
          continue;
        }

        caseSupportFindings.push({
          evidenceHash,
          line: index + 1,
          lineText,
          status: "SUPPORTED",
          record
        });
      }
    });

    const blocked = findings.some((finding) =>
      [
        "MISSING_LEDGER_RECORD",
        "MISSING_VERIFICATION_MARKER",
        "VERIFICATION_MARKER_MISMATCH",
        "UNVERIFIED_NOT_MARKED"
      ].includes(finding.status)
    ) ||
    caseQuoteFindings.some(
      (finding) =>
        finding.status !== "VERIFIED"
    ) ||
    caseSupportFindings.some(
      (finding) =>
        finding.status !== "SUPPORTED"
    );

    const degraded =
      !blocked &&
      findings.some((finding) => finding.status === "UNVERIFIED_MARKED");

    return {
      gate: "G8_HARD_GATE_FINALIZATION",
      result: blocked ? "BLOCKED" : degraded ? "DEGRADED" : "PASS",
      references,
      findings,
      caseQuoteFindings,
      caseSupportFindings
    };
  }
}

export const UNVERIFIED_MARKER_TEXT = "⚠️ [NIEWERYFIKOWANE]";
// A judgment the case's materials name (the user's messages, attached documents, the firm's
// documents): not in the judgment databases is no sign of a fabrication; the marker says where
// it comes from (a parallel proceeding, a ruling the firm holds).
export const CASE_MATERIAL_MARKER_TEXT = "⚠️ [NIEWERYFIKOWANE: z materiałów sprawy]";

// Wiersz sam mówi, że sygnatury nie potwierdzono ("baza zwróciła 503", "nie mogę potwierdzić",
// "tylko metadane"): to jawny trop, pokazany z ⚠️, a nie powołanie podane jako pewne.
// A signature given as an example of what to fill in ("Podaj dane, np. „sygn. I Nc 123/26; …”",
// test 500, C12-008): no citation, shown with ⚠️ instead of blocking the whole letter.
function givenAsExample(reference: DetectedLegalReference): boolean {
  const at = reference.lineText.indexOf(reference.claim.replace(/^sygn\.?\s*(?:akt\s*)?/iu, ""));
  if (at < 0) return false;
  // "Podaj dane, na przykład „1: I C 1234/26, data nakazu…”": a numbered field before it (C12-008, live).
  return /(?:\bnp\.|\bna\s+przykład|\bprzykładow\p{L}*)\s*[„"“']?\s*(?:\(?\d{1,2}\s*[.):]\s*)?(?:sygn\.?\s*(?:akt\s*)?:?\s*)?$/iu.test(reference.lineText.slice(Math.max(0, at - 40), at));
}

const DISCLOSED_UNCONFIRMED =
  /nie\s+(?:udało\s+(?:mi\s+)?się\s+)?(?:mogę\s+)?(?:potwierdzi|zweryfikowa|pobra|sprawdzi|odczyta|powołuj)|niepotwierdz|niezweryfikowan(?!\S*\])|wymaga\p{L}*\s+weryfikacji|do\s+weryfikacji|sprawdź|captcha|HTTP\s*\d{3}|tylko\s+metadane|bez\s+treści|według\s+mojej\s+wiedzy|prawdopodobnie/iu;
export const OFFICIAL_ANCHOR_MARKER_TEXT = "🟨 [KOTWICA-URZĘDOWA]";

/**
 * Inserts the HARD GATE marker after every statute or Dz.U. reference that
 * has no VERIFIED record and no marker yet, so an unverified claim is never
 * shown unmarked. Case-law findings are not marked here: they block.
 */
export function markUnverifiedReferences(
  text: string,
  report: FinalizationReport,
  // Signatures of proceedings the case's materials or the user name: marked like an
  // unverified statute. Any other unverified case signature stays blocking (HARD GATE).
  caseReferences: ReadonlySet<string> = new Set(),
  // Signatures an official case-law database returned in this turn (sn.pl, CBOSA, the courts'
  // portal, TK, KIO, CURIA, ETPCz): an official anchor without full verification, 🟨 (NSA/WSA
  // snapshot, no promotion). SAOS, LEX, Legalis and other portals are leads (⚠️).
  retrievedCases: ReadonlySet<string> = new Set()
): string {
  const markable = new Set<FinalizationFinding["status"]>([
    "MISSING_LEDGER_RECORD",
    "UNVERIFIED_NOT_MARKED"
  ]);
  const byLine = new Map<number, Array<{ claim: string; marker: string }>>();
  // Sygnatura raz opisana jako niepotwierdzona (albo już z ⚠️) jest tym samym tropem w całej odpowiedzi.
  const disclosed = new Set(
    report.findings
      .filter((finding) => finding.reference.kind === "case" && (finding.status === "UNVERIFIED_MARKED" || DISCLOSED_UNCONFIRMED.test(finding.reference.lineText) || givenAsExample(finding.reference)))
      .map((finding) => caseFileKey(finding.reference.claim))
  );
  for (const finding of report.findings) {
    if (!markable.has(finding.status)) continue;
    const key = finding.reference.kind === "case" ? caseFileKey(finding.reference.claim) : "";
    if (finding.reference.kind === "case" && !caseReferences.has(key) && !retrievedCases.has(key) && !disclosed.has(key)) continue;
    // An official database's hit outranks the same number in the user's words or the files.
    const marker =
      finding.reference.kind === "case" && retrievedCases.has(key)
        ? OFFICIAL_ANCHOR_MARKER_TEXT
        : finding.reference.kind === "case" && caseReferences.has(key)
          ? CASE_MATERIAL_MARKER_TEXT
          : UNVERIFIED_MARKER_TEXT;
    byLine.set(finding.reference.line, [
      ...(byLine.get(finding.reference.line) ?? []),
      { claim: finding.reference.span ?? finding.reference.claim, marker }
    ]);
  }
  if (byLine.size === 0) return text;
  const lines = text.split(/\r?\n/u);
  for (const [line, claims] of byLine) {
    let lineText = lines[line - 1] ?? "";
    const done = new Set<string>();
    for (const { claim, marker } of claims) {
      if (done.has(claim)) continue;
      done.add(claim);
      const at = lineText.indexOf(claim);
      if (at < 0) continue;
      const end = at + claim.length;
      lineText = `${lineText.slice(0, end)} ${marker}${lineText.slice(end)}`;
    }
    lines[line - 1] = lineText;
  }
  return lines.join("\n");
}

/**
 * A provision verified in this turn but cited again without its marker (another
 * paragraph, a comparison table) gets the marker of its VERIFIED record from the
 * ledger. Only true ledger markers are added; a fabricated marker is not touched.
 * In a table row the markers go into the last cell, keeping the row valid.
 */
/** Markers of every verified record of the turn, also of provisions no finding names (a copied
 * marker of art. 35 KPA on a line about art. 35 ust. 3 Prawa budowlanego is a real one). */
export function verifiedLedgerMarkers(ledger: VerificationLedger): Set<string> {
  return new Set(
    ledger
      .all()
      .filter((record) => record.status === "VERIFIED")
      .map((record) => expectedVerificationMarker(record))
      .filter((marker): marker is string => Boolean(marker))
  );
}

export function addMissingVerificationMarkers(
  text: string,
  report: FinalizationReport,
  // Markers of every verified record of the turn: a copied real marker can be told from a fabricated one.
  ledgerMarkers: ReadonlySet<string> = new Set(
    report.findings.flatMap((finding) => (finding.record?.status === "VERIFIED" ? [expectedVerificationMarker(finding.record)].filter((marker): marker is string => Boolean(marker)) : []))
  )
): string {
  const byLine = new Map<number, Set<string>>();
  const mismatched = new Set<number>();
  for (const finding of report.findings) {
    if (finding.status !== "MISSING_VERIFICATION_MARKER" && finding.status !== "VERIFICATION_MARKER_MISMATCH") continue;
    const marker = finding.record ? expectedVerificationMarker(finding.record) : null;
    if (!marker) continue;
    byLine.set(finding.reference.line, (byLine.get(finding.reference.line) ?? new Set()).add(marker));
    if (finding.status === "VERIFICATION_MARKER_MISMATCH") mismatched.add(finding.reference.line);
  }
  if (byLine.size === 0) return text;
  // A real ledger marker of another provision copied onto this line ("art. 477⁹ § 3 KPC ✅ [VER: …
  // page=93]" holding § 1's marker; test 500, C03-016) stays a mismatch however many right
  // markers are added: on such a line only the markers of the line's own verified provisions stay.
  const owned = new Map<number, Set<string>>();
  for (const finding of report.findings) {
    if (!mismatched.has(finding.reference.line) || finding.record?.status !== "VERIFIED") continue;
    const marker = expectedVerificationMarker(finding.record);
    if (marker) owned.set(finding.reference.line, (owned.get(finding.reference.line) ?? new Set()).add(marker));
  }
  const lines = text.split(/\r?\n/u);
  for (const line of mismatched) {
    const keep = owned.get(line) ?? new Set<string>();
    // Only a ledger marker of another provision goes; a fabricated one stays and keeps blocking.
    lines[line - 1] = (lines[line - 1] ?? "").replace(/ ?✅\s*\[VER:[^\]\r\n]*\]/gu, (match) =>
      keep.has(match.trimStart()) || !ledgerMarkers.has(match.trimStart()) ? match : ""
    );
  }
  for (const [line, markers] of byLine) {
    const current = lines[line - 1] ?? "";
    const missing = [...markers].filter((marker) => !current.includes(marker));
    if (missing.length === 0) continue;
    const insert = missing.join(" ");
    lines[line - 1] = /\|\s*$/u.test(current)
      ? current.replace(/\s*\|\s*$/u, ` ${insert} |`)
      : `${current.trimEnd()} ${insert}`;
  }
  return lines.join("\n");
}

