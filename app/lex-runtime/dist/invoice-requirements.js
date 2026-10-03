// Katalog elementów faktury z art. 106e ust. 1 ustawy o VAT, które obsługuje generator.
//
// Katalog NIE jest źródłem prawa. Przy budowie nie było dostępu do ELI, więc każdy wpis
// ma status UNVERIFIED, dopóki verifyRequirements() nie porówna go z brzmieniem
// art. 106e pobranym na żywo z ELI (konektor ISAP). Rozbieżność = MISMATCH, nie cicha zgoda.
export const VAT_ACT_ELI = "DU/2004/535";
export const VAT_INVOICE_ARTICLE = "106e";
export const INVOICE_REQUIREMENTS = [
    { id: "issue-date", point: "1", label: "Data wystawienia", fields: ["issueDate"], keyword: "datę wystawienia" },
    { id: "number", point: "2", label: "Kolejny numer faktury", fields: ["number"], keyword: "kolejny numer" },
    { id: "parties", point: "3", label: "Nazwy (imiona i nazwiska) oraz adresy sprzedawcy i nabywcy", fields: ["seller.name", "seller.address", "buyer.name", "buyer.address"], keyword: "adresy" },
    { id: "seller-nip", point: "4", label: "NIP sprzedawcy", fields: ["seller.nip"], keyword: "podatnik" },
    { id: "buyer-nip", point: "5", label: "NIP nabywcy", fields: ["buyer.nip"], condition: "gdy nabywca jest zidentyfikowany na potrzeby podatku", keyword: "nabywca" },
    { id: "sale-date", point: "6", label: "Data dostawy, wykonania usługi lub otrzymania zapłaty", fields: ["saleDate"], condition: "gdy jest określona i różni się od daty wystawienia", keyword: "dostawy" },
    { id: "line-name", point: "7", label: "Nazwa (rodzaj) towaru lub usługi", fields: ["lines.name"], keyword: "towaru lub usługi" },
    { id: "line-quantity", point: "8", label: "Miara i ilość", fields: ["lines.unit", "lines.quantity"], keyword: "ilość" },
    { id: "line-price", point: "9", label: "Cena jednostkowa netto", fields: ["lines.unitNetPrice"], keyword: "cenę jednostkową" },
    { id: "line-discount", point: "10", label: "Opusty i obniżki cen", fields: ["lines.discount"], condition: "gdy nie są uwzględnione w cenie jednostkowej netto", keyword: "opust" },
    { id: "line-net", point: "11", label: "Wartość sprzedaży netto", fields: ["computed"], keyword: "wartość" },
    { id: "line-rate", point: "12", label: "Stawka podatku", fields: ["lines.vatRate"], keyword: "stawkę podatku" },
    { id: "net-by-rate", point: "13", label: "Suma wartości sprzedaży netto w podziale na stawki", fields: ["computed"], keyword: "sumę wartości sprzedaży netto" },
    { id: "vat-by-rate", point: "14", label: "Kwota podatku w podziale na stawki", fields: ["computed"], keyword: "kwotę podatku" },
    { id: "gross", point: "15", label: "Kwota należności ogółem", fields: ["computed"], keyword: "należności ogółem" },
    { id: "cash-method", point: "16", label: "Wyrazy „metoda kasowa”", fields: ["annotations.cashMethod"], condition: "gdy obowiązek podatkowy powstaje według metody kasowej", keyword: "metoda kasowa" },
    { id: "self-billing", point: "17", label: "Wyraz „samofakturowanie”", fields: ["annotations.selfBilling"], condition: "gdy fakturę wystawia nabywca", keyword: "samofakturowanie" },
    { id: "reverse-charge", point: "18", label: "Wyrazy „odwrotne obciążenie”", fields: ["annotations.reverseCharge"], condition: "gdy podatek rozlicza nabywca", keyword: "odwrotne obciążenie" },
    { id: "split-payment", point: "18a", label: "Wyrazy „mechanizm podzielonej płatności”", fields: ["annotations.splitPayment"], condition: "przy transakcjach objętych obowiązkowym MPP", keyword: "mechanizm podzielonej płatności" },
    { id: "exemption-basis", point: "19", label: "Podstawa zwolnienia od podatku", fields: ["annotations.exemptionBasis"], condition: "przy sprzedaży zwolnionej", keyword: "zwolnion" }
];
// Drugorzędne źródła użyte przy budowie katalogu (nie ELI); pokazywane obok statusu.
export const CATALOG_SECONDARY_SOURCES = [
    "https://arslege.pl/elementy-faktury/k76/a67789/",
    "https://lexlege.pl/ustawa-o-podatku-od-towarow-i-uslug/art-106e/",
    "https://przepisy.gofin.pl/przepisyno,670,66246,0,0,20140101,2,0.html"
];
function normalize(value) {
    return value
        .replace(/-\s*\n\s*/g, "")
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("pl");
}
// Wycina ust. 1 i dzieli go na punkty „N) …”.
export function splitPoints(articleText) {
    const text = normalize(articleText);
    const start = text.search(/\b1\.\s*faktura/);
    const scope = start >= 0 ? text.slice(start) : text;
    const end = scope.search(/\s1a\.\s|\s2\.\s/);
    const body = end > 0 ? scope.slice(0, end) : scope;
    const points = new Map();
    const marker = /(?:^|[\s:;])(\d{1,2}[a-z]?)\)\s/g;
    const found = [...body.matchAll(marker)];
    found.forEach((match, index) => {
        const from = match.index + match[0].length;
        const to = index + 1 < found.length ? found[index + 1].index : body.length;
        const point = match[1];
        // Litery a), b) wewnątrz punktu nie są osobnymi punktami.
        if (/^\d/.test(point) && !points.has(point))
            points.set(point, body.slice(from, to).trim());
    });
    return points;
}
export function unverifiedReport(error) {
    return {
        eli: VAT_ACT_ELI,
        article: VAT_INVOICE_ARTICLE,
        requirements: INVOICE_REQUIREMENTS.map((entry) => ({ ...entry, status: "UNVERIFIED" })),
        uncoveredPoints: [],
        ...(error ? { error } : {})
    };
}
export function verifyRequirements(articleText, meta = {}) {
    const points = splitPoints(articleText);
    const covered = new Set(INVOICE_REQUIREMENTS.map((entry) => entry.point));
    return {
        eli: VAT_ACT_ELI,
        article: VAT_INVOICE_ARTICLE,
        ...meta,
        requirements: INVOICE_REQUIREMENTS.map((entry) => {
            const text = points.get(entry.point);
            if (!text)
                return { ...entry, status: "NOT_FOUND" };
            return {
                ...entry,
                status: text.includes(normalize(entry.keyword)) ? "VERIFIED" : "MISMATCH",
                excerpt: text.slice(0, 400)
            };
        }),
        uncoveredPoints: [...points.entries()]
            .filter(([point]) => !covered.has(point))
            .map(([point, excerpt]) => ({ point, excerpt: excerpt.slice(0, 400) }))
    };
}
// Wynik konektora ISAP bywa zagnieżdżony albo zserializowany jako JSON w treści MCP.
export function findLegalText(value, depth = 0) {
    if (depth > 6 || value === null || value === undefined)
        return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
                return findLegalText(JSON.parse(trimmed), depth + 1);
            }
            catch {
                return null;
            }
        }
        return null;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = findLegalText(entry, depth + 1);
            if (found)
                return found;
        }
        return null;
    }
    if (typeof value === "object") {
        const record = value;
        if (typeof record.tresc === "string") {
            return {
                text: record.tresc,
                ...(typeof record.url_zrodlowy === "string" ? { sourceUrl: record.url_zrodlowy } : {}),
                ...(typeof record.stan_prawny_na === "string" ? { statusDate: record.stan_prawny_na } : {})
            };
        }
        for (const entry of Object.values(record)) {
            const found = findLegalText(entry, depth + 1);
            if (found)
                return found;
        }
    }
    return null;
}
