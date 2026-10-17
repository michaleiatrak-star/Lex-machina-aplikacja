// The court of a case, kept in the case memory: read from the case's own documents (a court's
// letter, summons or judgment: its header, department and signature) or, for a case not yet in
// court, the court the application found for the first letter (court_for_address). Later
// letters of the case are addressed to it without asking the model to know any address.
import { courtByName, courtsInText, regionalCourt } from "./court-base.js";
import { courtOfSignature } from "../court-of-signature.js";
// "I Wydział Cywilny", "III Wydział Rodzinny i Nieletnich": the department's name on its line.
const DEPARTMENT = /\b([IVXL]{1,6})[ \t]+Wydzia[łl][ \t]+((?:[A-ZĄĆĘŁŃÓŚŹŻ][\p{Ll}]+)(?:[ \t]+(?:i[ \t]+)?[A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż][\p{Ll}]+){0,4})/u;
const SIGNATURE = /\b(?:sygn\.?\s*(?:akt)?\s*:?\s*)?((?:[IVXL]{1,6})\s+[A-Z][A-Za-z]{0,4}(?:\s*-\s*[A-Za-z]+)?\s+\d{1,6}\/\d{2,4})\b/u;
export function validCaseCourt(value) {
    if (!value || typeof value !== "object")
        return null;
    const raw = value;
    if (typeof raw.nazwa !== "string" || !courtByName(raw.nazwa) || (raw.zrodlo !== "AKTA" && raw.zrodlo !== "PISMO") || typeof raw.at !== "string")
        return null;
    return {
        nazwa: courtByName(raw.nazwa).nazwa,
        ...(typeof raw.wydzial === "string" && raw.wydzial.length <= 120 ? { wydzial: raw.wydzial } : {}),
        ...(typeof raw.sygnatura === "string" && raw.sygnatura.length <= 40 ? { sygnatura: raw.sygnatura } : {}),
        zrodlo: raw.zrodlo,
        ...(typeof raw.documentId === "string" && raw.documentId.length <= 80 ? { documentId: raw.documentId } : {}),
        at: raw.at
    };
}
/**
 * The court a case's document comes from or is filed with: the first court named in its head
 * (the first ~1500 characters), with a department and a common-court signature near it.
 */
export function courtOfDocument(text) {
    const head = text.slice(0, 1_500);
    const named = courtsInText(head)[0];
    if (!named)
        return null;
    const near = head.slice(named.index, named.index + 400);
    const department = DEPARTMENT.exec(near);
    const signature = [...head.matchAll(new RegExp(SIGNATURE, "gu"))]
        .map((match) => match[1].replace(/\s+/gu, " ").trim())
        .find((value) => courtOfSignature(value.replace(/\s*-\s*/gu, "-").replace(/-[A-Za-z]+/u, "")) === "POWSZECHNY");
    return {
        nazwa: named.court.nazwa,
        ...(department ? { wydzial: `${department[1]} Wydział ${department[2].trim()}` } : {}),
        ...(signature ? { sygnatura: signature } : {})
    };
}
/**
 * The court of a case from its documents: the court named with a signature wins; otherwise
 * the court named most often. Null when the documents name none.
 */
export function courtOfCaseDocuments(documents) {
    const found = documents
        .map((document) => ({ document, court: courtOfDocument(document.text) }))
        .filter((item) => Boolean(item.court));
    if (!found.length)
        return null;
    const signed = found.find((item) => item.court.sygnatura);
    if (signed)
        return { ...signed.court, ...(signed.document.documentId ? { documentId: signed.document.documentId } : {}) };
    const counts = new Map();
    for (const item of found)
        counts.set(item.court.nazwa, (counts.get(item.court.nazwa) ?? 0) + 1);
    const best = found.sort((a, b) => (counts.get(b.court.nazwa) ?? 0) - (counts.get(a.court.nazwa) ?? 0))[0];
    return { ...best.court, ...(best.document.documentId ? { documentId: best.document.documentId } : {}) };
}
/** The court a letter is addressed to: the first court named in its head. */
export function addresseeCourt(letter) {
    const start = letter.search(/===\s*PISMO\s*===|@TYTUL:|^#\s/mu);
    const head = letter.slice(Math.max(0, start), Math.max(0, start) + 1_200);
    return courtsInText(head)[0]?.court.nazwa ?? null;
}
/** What the model is told about the case's court (the drafting turn's system prompt). */
export function caseCourtPrompt(court) {
    const known = regionalCourt(court.nazwa) ?? courtByName(court.nazwa);
    const contact = known?.adres;
    const address = contact ? `, ${/^(?:ul\.|al\.|pl\.|os\.|Plac|Aleja|Al\.)/u.test(contact.ulica) ? contact.ulica : `ul. ${contact.ulica}`}, ${contact.kod} ${contact.miejscowosc}` : "";
    return [
        "# SĄD SPRAWY (rejestr aplikacji)",
        `${court.nazwa}${court.wydzial ? `, ${court.wydzial}` : ""}${address}${court.sygnatura ? `; sygn. akt ${court.sygnatura}` : ""}.`,
        court.zrodlo === "AKTA"
            ? "Źródło: dokumenty sprawy. Pismo w toczącym się postępowaniu kieruj do tego sądu i wydziału, z tą sygnaturą."
            : "Źródło: sąd ustalony przez aplikację dla pierwszego pisma (court_for_address). Kolejne pisma w tej sprawie kieruj do niego; sygnaturę podaj dopiero z pisma sądu.",
        "Pismo wszczynające odrębne postępowanie (inny pozwany, inna podstawa właściwości): sąd ponownie przez court_for_address."
    ].join("\n");
}
