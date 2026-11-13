// Codes of professional ethics a case file cites ("§ 16 zd. 3 KEA"): not acts of the Journal of
// Laws (not in ELI), published by the profession's own council. RD 121/26 (2026-11-12): the
// central norm of the case, § 16 KEA, was never read by the application, while the chat read it
// from the consolidated text of the Bar's council. The application reads the cited paragraphs
// before the model answers.
import { officialTextStore } from "../official-text-store.js";
export const ETHICS_CODES = [
    {
        key: "KEA",
        name: "Zbiór Zasad Etyki Adwokackiej i Godności Zawodu (Kodeks Etyki Adwokackiej)",
        issuer: "Naczelna Rada Adwokacka",
        sources: [
            {
                url: "https://www.adwokatura.pl/admin/wgrane_pliki/file-zal-do-uchwaly-prezydium-nra-nr-1742026kodeksetykiadwokackiejtekst-jednolity-44572.pdf",
                label: "tekst jednolity — załącznik do uchwały nr 174/2026 Prezydium NRA z 23 czerwca 2026 r."
            }
        ],
        names: /\bKEA\b|Kodeks\p{L}*\s+Etyki\s+Adwokackiej|Zbi\p{L}+\s+Zasad\s+Etyki\s+Adwokackiej|ZZEAiGZ/u,
        unit: "§"
    },
    {
        key: "KERP",
        name: "Kodeks Etyki Radcy Prawnego",
        issuer: "Krajowa Rada Radców Prawnych",
        sources: [
            {
                url: "https://kirp.pl/wp-content/uploads/2023/02/kodeks-etyki-radcy-prawnego-i-regulamin-wykonywania-zawodu.pdf",
                label: "tekst ujednolicony po zmianach uchwałą nr 1/2022 Nadzwyczajnego Krajowego Zjazdu Radców Prawnych (w mocy od 1 stycznia 2023 r.), wydanie KRRP 2023"
            }
        ],
        names: /\bKERP\b|Kodeks\p{L}*\s+Etyki\s+Radc\p{L}*\s+Prawn\p{L}*/u,
        unit: "Art."
    }
];
/** Paragraphs of a code the text cites: "§ 16 zd. 3 KEA", "§ 16 Kodeksu Etyki Adwokackiej", "§§ 16 i 17 KEA". */
export function citedEthicsParagraphs(text) {
    const found = [];
    for (const code of ETHICS_CODES) {
        const paragraphs = new Set();
        for (const sentence of text.split(/(?<=[.;])\s+(?=[\p{Lu}„(])|\n/u)) {
            if (!code.names.test(sentence))
                continue;
            const units = code.unit === "§" ? /§§?\s*(\d{1,3}[a-z]?)(?:\s*(?:i|oraz|,)\s*(\d{1,3}[a-z]?))?/gu : /\bart\.\s*(\d{1,3}[a-z]?)(?:\s*(?:i|oraz|,)\s*(\d{1,3}[a-z]?))?/giu;
            for (const match of sentence.matchAll(units)) {
                paragraphs.add(match[1]);
                if (match[2])
                    paragraphs.add(match[2]);
            }
        }
        if (paragraphs.size)
            found.push({ code, paragraphs: [...paragraphs].slice(0, 8) });
    }
    return found;
}
/** The paragraph "§ N" of a code's text: from its heading line to the next paragraph or chapter. */
export function ethicsParagraph(text, paragraph) {
    const start = new RegExp(`(?:^|\\n)\\s*§\\s*${paragraph}\\s*\\n`, "u").exec(text);
    if (!start)
        return null;
    const rest = text.slice(start.index + start[0].length);
    const next = /\n\s*(?:§\s*\d{1,3}[a-z]?\s*\n|Rozdział\s|ROZDZIAŁ\s)/u.exec(rest);
    const body = rest.slice(0, next ? next.index : 4_000).replace(/\s*\n\s*/gu, " ").trim();
    return body ? `§ ${paragraph}. ${body}` : null;
}
/** The cited paragraphs from the local copy of the code (official-text-store.ts), downloaded once and kept current. */
export async function readEthicsParagraphs(code, paragraphs, store = officialTextStore()) {
    for (const source of code.sources) {
        const kept = await store.ensure({ key: code.key, name: code.name, issuer: code.issuer, url: source.url, version: source.label, unit: code.unit });
        if (!kept)
            continue;
        return {
            status: "FOUND",
            code,
            source,
            from: kept.from,
            fetchedAt: kept.copy.fetchedAt,
            paragraphs: paragraphs.map((paragraph) => ({ paragraph, text: kept.copy.units[paragraph] ?? (code.unit === "§" ? ethicsParagraph(kept.copy.text, paragraph) : null) }))
        };
    }
    return { status: "UNAVAILABLE", code, detail: "ETHICS_CODE_SOURCE_UNAVAILABLE" };
}
export function ethicsPrompt(readings) {
    const lines = readings.flatMap((reading) => reading.status === "FOUND"
        ? [
            `${reading.code.name} — ${reading.source.label} (${reading.source.url}); źródło urzędowe samorządu zawodowego; ${reading.from === "LOCAL_STALE" ? `kopia lokalna z ${reading.fetchedAt.slice(0, 10)} (źródło teraz niedostępne — wskaż datę kopii)` : `kopia lokalna aplikacji, pobrana ${reading.fetchedAt.slice(0, 10)}, zgodna ze źródłem`}:`,
            ...reading.paragraphs.map((item) => (item.text ? `- ${item.text}` : `- ${reading.code.unit === "§" ? "§" : "art."} ${item.paragraph}: brak takiej jednostki w tym tekście — nie przypisuj jej treści (numeracja mogła się zmienić po nowelizacji kodeksu).`))
        ]
        : [`${reading.code.name}: tekst niedostępny (${reading.detail}) — oznacz powołania jako niezweryfikowane.`]);
    return [
        "# KODEKS ETYKI ZAWODOWEJ Z AKT SPRAWY — BRZMIENIE ODCZYTANE PRZEZ APLIKACJĘ (ustalone przez aplikację)",
        "Gdy sprawa dotyczy przewinienia dyscyplinarnego, normą centralną jest naruszona zasada etyki (np. § 16 KEA), a nie przepis karny przywołany w piśmie; cytuj brzmienie wyłącznie z tekstu poniżej.",
        ...lines
    ].join("\n");
}
