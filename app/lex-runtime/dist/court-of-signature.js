/** Repertories of Sąd Najwyższy (the sn.pl database). */
export const SN_REPERTORIES = new Set([
    "CSK", "CSKP", "KK", "NKK", "UK", "NSNC", "NSNU", "NKN", "CNP", "CNPP", "SDI", "ZK", "CZP", "KZP",
    "UZP", "PZP", "NSNZP", "SNO", "DSI", "DSP", "CZ", "KO", "KSP", "NSW"
]);
const NSA = new Set(["OSK", "FSK", "GSK", "OZ", "FZ", "GZ", "OPS", "FPS", "GPS", "OW", "FW", "GW", "OPK", "FPK", "GPK"]);
const COMMON = new Set([
    "C", "Ca", "ACa", "ACz", "Cz", "Ns", "Nc", "Co", "Cps", "Nkd", "Nsm", "RC", "RCa", "RCz",
    "GC", "GCo", "GNc", "GNs", "Ga", "Gz", "AGa", "AGz", "GU", "Gzt",
    "K", "Ka", "Kz", "Kp", "Ko", "AKa", "AKz", "AKo", "W", "Wz", "Kop", "Kow",
    "P", "Pa", "Pz", "Po", "APa", "APz", "U", "Ua", "Uz", "AUa", "AUz", "Nmo"
]);
const TK = new Set(["K", "P", "SK", "U", "Kp", "Kpt", "Pp", "Ts", "Tw", "S"]);
// "II CSKP 89/26", "I SA/Wa 123/20", "KIO 512/25", "SK 3/20", "V ACa 12/2024".
const SIGNATURE = /(?<![\p{L}\d])((?:[IVXL]{1,5}\s+)?([A-Z][A-Za-z]{0,5})(?:\/([A-Z][a-z]{1,2}))?\s+\d{1,6}\/\d{2,4})(?![\p{L}\d])/gu;
export function courtOfSignature(value) {
    const text = value.normalize("NFKC").replace(/\./g, "").replace(/\s+/g, " ").trim();
    const match = /^(?:([IVXL]{1,5})\s+)?([A-Z][A-Za-z]{0,5})(?:\/([A-Z][a-z]{1,2}))?\s+\d{1,6}\/\d{2,4}$/u.exec(text);
    if (!match)
        return null;
    const [, roman, repertory, seat] = match;
    if (repertory === "KIO")
        return "KIO";
    if (seat)
        return /^SAB?$/.test(repertory) ? "NSA_WSA" : null;
    if (NSA.has(repertory))
        return "NSA_WSA";
    if (repertory === repertory.toUpperCase() && SN_REPERTORIES.has(repertory))
        return "SN";
    if (roman && COMMON.has(repertory))
        return "POWSZECHNY";
    if (!roman && TK.has(repertory))
        return "TK";
    return null;
}
/** Signatures in free text (a query, a claim) with their courts. */
export function signaturesIn(text) {
    const found = [];
    for (const match of text.normalize("NFKC").matchAll(SIGNATURE)) {
        const signature = match[1].replace(/\s+/g, " ").trim();
        const court = courtOfSignature(signature);
        if (court && !found.some((item) => item.signature === signature))
            found.push({ signature, court });
    }
    return found;
}
const WHERE = {
    SN: {
        label: "Sąd Najwyższy",
        use: "verify_case_reference (courtFamily=SN); źródłem jest karta orzeczenia na sn.pl",
        card: "https://www.sn.pl/pl/wyszukiwarka-orzeczen"
    },
    NSA_WSA: {
        label: "NSA/WSA",
        use: "search_case_law source=CBOSA albo cbosa_sprawdz_sygnature (snapshot, bez awansu)",
        card: "https://orzeczenia.nsa.gov.pl/cbo/query"
    },
    POWSZECHNY: {
        label: "sąd powszechny",
        use: "search_case_law source=SAOS (Portal Orzeczeń Sądów Powszechnych przez SAOS)",
        card: "https://orzeczenia.ms.gov.pl"
    },
    KIO: { label: "Krajowa Izba Odwoławcza", use: "kio_sprawdz_sygnature (UZP)", card: "https://orzeczenia.uzp.gov.pl" },
    TK: { label: "Trybunał Konstytucyjny", use: "search_case_law source=SAOS albo baza ipo.trybunal.gov.pl", card: "https://ipo.trybunal.gov.pl" }
};
// Courts each search source publishes.
const COVERS = {
    cbosa: ["NSA_WSA"],
    kio: ["KIO"],
    saos: ["SN", "POWSZECHNY", "TK", "KIO"],
    sn: ["SN"]
};
/**
 * A search for a signature in a source that does not publish its court:
 * the redirect to the right source instead of a misleading "no hits".
 */
export function misroutedSignature(source, text) {
    const covers = COVERS[source.toLowerCase()];
    if (!covers)
        return null;
    const signatures = signaturesIn(text);
    if (!signatures.length || signatures.some((item) => covers.includes(item.court)))
        return null;
    const { signature, court } = signatures[0];
    const where = WHERE[court];
    return {
        status: "OUT_OF_SCOPE",
        reason: "SIGNATURE_OF_OTHER_COURT",
        signature,
        court: where.label,
        useInstead: where.use,
        officialSearch: where.card,
        note: `Sygnatura ${signature} należy do: ${where.label}. Źródło ${source} nie publikuje tych orzeczeń; brak trafień tutaj nic nie mówi o istnieniu orzeczenia.`
    };
}
export function signatureRedirect(signature) {
    const court = courtOfSignature(signature);
    return court ? { court: WHERE[court].label, useInstead: WHERE[court].use, officialSearch: WHERE[court].card } : null;
}
/**
 * Links that are not sources: a blob: address exists only in one browser tab;
 * the old sn.pl PDF directory (/sites/orzecznictwo/Orzeczenia3/II CSKP 89-26.pdf)
 * no longer serves decisions. The signature in an old PDF name is recovered.
 */
export function caseLinkProblem(value) {
    const text = value.trim();
    if (/^blob:/i.test(text))
        return { kind: "BLOB" };
    let url;
    try {
        url = new URL(text);
    }
    catch {
        return null;
    }
    if (!/(^|\.)sn\.pl$/i.test(url.hostname) || !/\/sites\/orzecznictwo\//i.test(url.pathname))
        return null;
    const name = decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(/\.(pdf|docx?|rtf)$/i, "");
    const signature = /^(.*\S)\s+(\d{1,6})-(\d{2,4})(?:-\d+)?$/u.exec(name.replace(/_/g, " "));
    const recovered = signature ? `${signature[1]} ${signature[2]}/${signature[3]}` : undefined;
    return { kind: "SN_LEGACY_PDF", ...(recovered && courtOfSignature(recovered) === "SN" ? { signature: recovered } : {}) };
}
