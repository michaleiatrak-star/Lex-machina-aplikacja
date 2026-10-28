import { searchStems } from "./core-law-search.js";
import { ARTICLE_LEAD } from "./legal-act-abbreviations.js";
import { articleWording, futureDate, hasPendingWording } from "./core-law-footnotes.js";
import { anchoredUrl, normalizeArticleId } from "./source-anchor.js";
import { todayWarsaw } from "./warsaw-date.js";
import { amendmentMentionsArticle, amendmentPartFor } from "./temporal-source-freshness.js";
import { claimedUnitState } from "./legal-source-verifier.js";
import { FRESHNESS_MAX_AGE_MS } from "./verification-ledger.js";
// Nazwa podana przez model musi być w >= 75% pokryta rdzeniami tytułu aktu.
const TITLE_MATCH_MIN = 0.75;
function articleToken(claim) {
    // „art. 11¹”, „art. 11[1]”, „art. 151⁹a” -> klucz kopii „11¹”, „151⁹a”.
    const token = new RegExp(`${ARTICLE_LEAD}(\\d+[a-ząćęłńóśźż]*(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+[a-z]*|\\[\\d+[a-z]*\\]|\\^\\d+[a-z]*)?)`, "iu")
        .exec(claim)?.[1];
    return token ? normalizeArticleId(token) : null;
}
function journalMatches(claim, elis) {
    const year = /\b(19\d{2}|20\d{2})\b/u.exec(claim)?.[1];
    const position = /\bpoz\.?\s*(\d+)\b/iu.exec(claim)?.[1];
    if (!year || !position)
        return false;
    return elis.includes(`DU/${year}/${Number(position)}`);
}
function comparable(value) {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase("pl")
        .replace(/[„”"«»]/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
}
function titleStems(value) {
    return new Set(searchStems(value.replace(/\b(?:z\s+dnia\s+)?\d{1,2}\s+\S+\s+\d{4}\s*r?\.?/giu, " ")).filter((stem) => !/^\d+$/.test(stem) && stem !== "dnia"));
}
// Odmiana skraca albo zmienia końcówkę ("karny"/"karnego" -> "karny"/"karneg"): wspólny
// przedrostek >= 4 liter, najwyżej jedna litera krócej niż krótszy rdzeń.
function stemsMatch(a, b) {
    if (a === b)
        return true;
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common])
        common += 1;
    return common >= 4 && common >= Math.min(a.length, b.length) - 1;
}
/**
 * Akt po treści nazwy (odporne na odmianę): pokrycie rdzeni nazwy z zapytania przez tytuł,
 * remis rozstrzyga pokrycie tytułu ("kodeks karny" -> KK, nie KKS); bez jednoznaczności null.
 */
export function resolveActByTitle(index, act) {
    const wanted = titleStems(act);
    if (wanted.size === 0)
        return null;
    const scored = index
        .summaries()
        .filter((summary) => summary.title && summary.articleCount > 0)
        .map((summary) => {
        const title = titleStems(summary.title);
        const shared = [...wanted].filter((stem) => [...title].some((candidate) => stemsMatch(stem, candidate))).length;
        return {
            eli: summary.eli,
            query: shared / wanted.size,
            title: title.size ? shared / title.size : 0
        };
    })
        .filter((item) => item.query >= TITLE_MATCH_MIN)
        .sort((a, b) => b.query - a.query || b.title - a.title);
    const [best, second] = scored;
    if (!best)
        return null;
    if (second && second.query === best.query && second.title === best.title)
        return null;
    return best.eli;
}
/**
 * Whether the amendments published after the t.j. touch the article: their text in the copy is
 * searched for the article ("w art. 484 § 2", "art. 480–485"). OCR text, a missing amendment
 * text or an article the search cannot read leave the impact unknown.
 */
export function postConsolidationImpact(index, amendments, article, actTitle) {
    if (!article || !index.record) {
        return { status: "UNKNOWN", reason: "TEMPORAL_POST_TJ_AMENDMENTS", amendments };
    }
    const affected = [];
    const unknown = [];
    for (const eli of amendments) {
        const record = index.record(eli);
        const body = record && record.textSource !== "ocr" && record.textSource !== "none"
            ? record.text ?? record.articleOrder.map((unit) => `Art. ${unit}. ${record.articles[unit] ?? ""}`).join("\n")
            : "";
        const touches = body.trim() ? amendmentMentionsArticle(amendmentPartFor(body, actTitle), article) : null;
        if (touches === true)
            affected.push(eli);
        else if (touches === null)
            unknown.push(eli);
    }
    if (affected.length)
        return { status: "AFFECTED", reason: "TEMPORAL_POST_TJ_AMENDMENT_TOUCHES_ARTICLE", amendments: affected };
    if (unknown.length)
        return { status: "UNKNOWN", reason: "TEMPORAL_POST_TJ_AMENDMENT_IMPACT_UNKNOWN", amendments: unknown };
    return { status: "UNAFFECTED", checked: amendments };
}
const REPEALED_ARTICLE = /^Art\.?\s*[^\s.]+\s*\.?\s*\((?:uchylony|uchylona|uchylone|skreślony|pominięty)\)/iu;
export function verifyFromCoreLaw(args) {
    if (args.asOf) {
        return { decision: "DENY", reason: "CORE_LAW_CURRENT_STATE_ONLY" };
    }
    const byReference = args.index.resolve(args.act)?.eli ?? null;
    const eli = byReference ?? resolveActByTitle(args.index, args.act);
    if (!eli)
        return { decision: "DENY", reason: "UNKNOWN_LEGAL_ACT" };
    const summary = args.index.summary(eli);
    if (!summary)
        return { decision: "DENY", reason: "CORE_LAW_ACT_NOT_IN_MAP" };
    const record = args.index.currentRecord(eli);
    if (!record || record.articleOrder.length === 0) {
        return { decision: "DENY", reason: "CORE_LAW_TEXT_UNAVAILABLE" };
    }
    // Amendments after the t.j.: the copy's wording stands for a provision none of them touches
    // (the same rule as in ELI, temporal-source-freshness.ts); a touched provision, or one whose
    // amendment cannot be read with certainty, is not verified from the copy.
    let amendmentsChecked = [];
    if (summary.amendmentsAfter.length > 0) {
        const impact = postConsolidationImpact(args.index, summary.amendmentsAfter.map((item) => item.eli), args.kind === "statute" ? articleToken(args.claim) : null, summary.title ?? undefined);
        if (impact.status !== "UNAFFECTED")
            return { decision: "DENY", reason: impact.reason };
        amendmentsChecked = impact.checked;
    }
    // Tekst z OCR skanu może mieć błędy odczytu: nie jest podstawą VERIFIED.
    if (record.textSource === "ocr") {
        return { decision: "DENY", reason: "CORE_LAW_OCR_TEXT" };
    }
    // A newer t.j. or new amendments were found but not applied yet
    // (automatic updates off): the copy is not the current wording.
    if (summary.pendingConsolidated || summary.pendingAmendments.length > 0) {
        return { decision: "DENY", reason: "TEMPORAL_UPDATE_PENDING" };
    }
    if (record.status &&
        !record.status.toLocaleLowerCase("pl").includes("obowiązując")) {
        return { decision: "DENY", reason: "TEMPORAL_ACT_NOT_IN_FORCE" };
    }
    // T.j. zawiera zmiany w vacatio legis (KP t.j. 2026/1245 ze zmianą od 5.11.2026). Zmiana
    // objęta t.j., a jeszcze nieobowiązująca, ma przy jednostce odnośnik z datą („wejdzie w życie
    // z dniem …”, dwa brzmienia): odmowa dotyczy tylko takich artykułów. Bez odnośników w kopii
    // (HTML, starsza kopia) albo gdy żaden odnośnik nie zapowiada zmiany — odmowa dla całego aktu.
    if (args.kind === "statute" && summary.notYetInForce.length > 0) {
        const today = todayWarsaw(args.now ?? Date.now());
        const article = articleToken(args.claim);
        const notes = record.footnotes;
        const announced = notes !== undefined &&
            Object.values(notes).some((note) => {
                const from = futureDate(note);
                return from !== null && from > today;
            });
        const known = Boolean(article) && record.articles[article] !== undefined;
        // The article carries a wording that is not in force yet: never from the copy.
        if (known && notes && hasPendingWording(record.markedArticles?.[article] ?? record.articles[article], notes, today)) {
            return { decision: "DENY", reason: "TEMPORAL_NOT_YET_IN_FORCE" };
        }
        // An article the act does not have (u.k.k. art. 36a cited as KC): no wording to be pending;
        // the lookup below says the unit is not in the text, so the model sees the wrong act.
        const missing = Boolean(article) && !known;
        if (!missing && (!notes || !announced || !known)) {
            // No dated footnotes to tell the articles apart: the amending acts in vacatio legis are
            // read as the amendments after the t.j. are (KC t.j. 2026/795 with the CEIDG act from
            // 2028: art. 481 is not touched by it, so its copy wording is the one in force).
            const impact = known
                ? postConsolidationImpact(args.index, summary.notYetInForce.map((item) => item.eli), article, summary.title ?? undefined)
                : null;
            if (impact?.status !== "UNAFFECTED")
                return { decision: "DENY", reason: "TEMPORAL_NOT_YET_IN_FORCE" };
        }
    }
    let evidence;
    let anchor;
    let failure = "";
    if (args.kind === "statute") {
        const article = articleToken(args.claim);
        anchor = article ? record.articleAnchors?.[article] : undefined;
        evidence = article ? record.articles[article] : undefined;
        // Artykuł z kilkoma brzmieniami: dowodem jest brzmienie obowiązujące w dniu weryfikacji.
        let pending = [];
        if (article && record.footnotes && record.markedArticles?.[article]) {
            const wording = articleWording(record.markedArticles[article], record.footnotes, todayWarsaw(args.now ?? Date.now()));
            if (!wording.unresolved)
                evidence = wording.text;
            pending = wording.pending;
        }
        // Jak w odczycie ELI (legal-source-verifier): artykuł uchylony i jednostka, której artykuł nie
        // ma, nie są VERIFIED. Test 500 na żywo: „art. 4 pkt 3 KC” VERIFIED z dowodem „Art. 4. (uchylony)”.
        if (evidence && REPEALED_ARTICLE.test(evidence.trim())) {
            evidence = undefined;
            failure = "Przepis jest w aktualnym tekście jednolitym uchylony.";
        }
        else if (evidence) {
            const unit = claimedUnitState(args.claim, evidence, pending);
            const problem = unit.state === "REPEALED"
                ? "Ta jednostka jest w aktualnym tekście jednolitym uchylona."
                : unit.state === "MISSING"
                    ? "Artykuł w aktualnym tekście jednolitym nie ma tej jednostki."
                    : unit.state === "PENDING"
                        ? `Ta jednostka jeszcze nie obowiązuje: tekst jednolity drukuje ją z wejściem w życie${unit.from ? ` z dniem ${unit.from}` : " w późniejszym terminie"}.`
                        : null;
            if (problem) {
                evidence = undefined;
                failure = problem;
            }
        }
        // Zgubiony nagłówek przy wyciąganiu z PDF: ten artykuł może zawierać tekst następnego.
        if (article && record.extractionCheck?.suspectArticles.includes(article)) {
            return { decision: "DENY", reason: "CORE_LAW_EXTRACTION_SUSPECT" };
        }
        if (!evidence) {
            failure ||= "Tekst jednolity ELI nie zawiera wskazanej jednostki redakcyjnej.";
        }
        else if (args.quote?.trim() &&
            !comparable(evidence).includes(comparable(args.quote))) {
            evidence = undefined;
            failure = "Podany cytat nie występuje w tej jednostce redakcyjnej tekstu jednolitego ELI.";
        }
    }
    else if (args.kind === "journal") {
        evidence = journalMatches(args.claim, [summary.eli, record.eli])
            ? record.title
            : undefined;
        if (!evidence)
            failure = "Numer Dz.U. nie odpowiada rozpoznanemu aktowi.";
    }
    else {
        return { decision: "DENY", reason: "CORE_LAW_UNSUPPORTED_KIND" };
    }
    const now = args.now ?? Date.now();
    const base = {
        claim: args.claim,
        kind: args.kind,
        sourceUrl: record.sourceUrl,
        sourceTier: "R1",
        toolCallId: args.toolCallId,
        verificationMethod: "file_read",
        sourceFormat: record.textSource === "pdf" ? "PDF" : "TEXT",
        temporalMode: "CURRENT",
        currentEli: record.eli
    };
    // Brzmienie na dzień pobrania kopii z ELI; ostatnie sprawdzenie relacji, jeśli było późniejsze.
    const checkedAt = summary.relationsCheckedAt &&
        Date.parse(summary.relationsCheckedAt) > Date.parse(record.fetchedAt)
        ? summary.relationsCheckedAt
        : record.fetchedAt;
    // Kopia niesprawdzana w ELI dłużej niż limit (ELI zablokowane, odświeżanie wyłączone)
    // nie jest podstawą VERIFIED/CURRENT.
    if (evidence && !(now - Date.parse(checkedAt) <= FRESHNESS_MAX_AGE_MS)) {
        return { decision: "DENY", reason: "TEMPORAL_COPY_STALE" };
    }
    const sourceAnchorUrl = anchoredUrl(record.sourceUrl, anchor);
    const verificationRecord = evidence
        ? {
            ...base,
            status: "VERIFIED",
            ...(sourceAnchorUrl ? { sourceAnchorUrl } : {}),
            fetchedAt: record.fetchedAt,
            retrieval: "RAG",
            temporalFreshnessStatus: "CURRENT",
            freshnessCheckedAt: checkedAt,
            evidence: evidence.slice(0, 4_000)
        }
        : {
            ...base,
            status: "UNVERIFIED",
            fetchedAt: new Date(now).toISOString(),
            evidence: failure
        };
    return {
        decision: "RECORD",
        record: verificationRecord,
        act: {
            eli: summary.eli,
            currentEli: record.eli,
            title: record.title,
            resolvedBy: byReference ? "REFERENCE" : "TITLE",
            relationsCheckedAt: summary.relationsCheckedAt,
            amendmentsChecked
        }
    };
}
