const clean = (value) => value
    .replace(/\s+/gu, " ")
    .replace(/^[\s:,-]+|[\s:,;-]+$/gu, "")
    .trim()
    .slice(0, 140);
const SIGNATURE = /(?:Sygn\.?\s*(?:akt)?\s*:?\s*)?\b([IVXLC]{1,6}\s+[A-Z][A-Za-z]{0,5}(?:-[A-Za-z]+)?\s+\d{1,6}\/\d{2,4})\b/u;
const DATE = /(?:Dnia|dnia|Data)[\s,:]*(\d{1,2}(?:[.\s]+(?:\d{1,2}|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia))[.\s]+\d{4})/u;
const PAIRS = [
    [/z\s+powództwa\s*:?\s*/iu, /\s+przeciwko\s*:?\s*/iu],
    [/z\s+wniosku\s*:?\s*/iu, /\s+z\s+udziałem\s*:?\s*/iu],
    [/z\s+odwołania\s*:?\s*/iu, /\s+od\s+(?:decyzji|orzeczenia)\s*/iu]
];
const WITNESS = /(?<![\p{L}])[Śś]wiad(?:ek|ka|kiem|kowi)\s+((?:\p{Lu}[\p{L}'-]+|\[PII[^\]]*\])(?:\s+(?:\p{Lu}[\p{L}'-]+|\[PII[^\]]*\]))?)/gu;
/** The parties, signature and date a court record's heading states; the witnesses it hears. */
export function recordParties(documentId, text) {
    const head = text.slice(0, 1_800);
    const flat = head.replace(/\n\s*\d{0,3}\s*/gu, " ");
    let claimant;
    let respondent;
    for (const [opening, against] of PAIRS) {
        const start = opening.exec(flat);
        if (!start)
            continue;
        const rest = flat.slice(start.index + start[0].length);
        const split = against.exec(rest);
        if (!split || split.index > 160)
            continue;
        claimant = clean(rest.slice(0, split.index));
        respondent = clean(rest.slice(split.index + split[0].length).split(/\s+o\s+(?=\p{Ll})|\s+(?:Sąd|Protokolant|Obecni|Na\s+rozpraw)/u)[0]);
        break;
    }
    const witnesses = [...new Set([...text.matchAll(WITNESS)].map((match) => clean(match[1])))].filter((name) => !/^(?:Sąd|Przewodnicząc|Pełnomocnik|Pozwan|Powód|Powódk)/u.test(name));
    if (!claimant && !respondent)
        return null;
    return {
        documentId,
        ...(SIGNATURE.exec(head)?.[1] ? { signature: SIGNATURE.exec(head)[1].replace(/\s+/gu, " ") } : {}),
        ...(DATE.exec(head)?.[1] ? { date: clean(DATE.exec(head)[1]) } : {}),
        ...(claimant ? { claimant } : {}),
        ...(respondent ? { respondent } : {}),
        witnesses: witnesses.slice(0, 8)
    };
}
export function recordPartiesPrompt(records) {
    if (!records.length)
        return "";
    return [
        "# STRONY I SPRAWY Z NAGŁÓWKÓW PROTOKOŁÓW (ustalone przez aplikację)",
        ...records.map((record) => [
            `- ${record.label}${record.signature ? `, sygn. ${record.signature}` : ""}${record.date ? `, ${record.date}` : ""}:`,
            record.claimant ? ` powód/wnioskodawca: ${record.claimant};` : "",
            record.respondent ? ` pozwany/uczestnik: ${record.respondent};` : "",
            record.witnesses.length ? ` świadkowie: ${record.witnesses.join(", ")}` : ""
        ].join("")),
        "Zasady: (1) strony pisma bierz z nagłówka protokołu, nie z tego, kto najwięcej mówi; świadek nigdy nie jest stroną. (2) Pismo kieruj do sprawy, którą wskazuje pytanie albo wybrana sprawa; gdy pytanie jej nie wskazuje, do sprawy z najnowszego protokołu. Protokół innej sprawy to dowód (art. 244 k.p.c.), nie adresat pisma."
    ].join("\n");
}
