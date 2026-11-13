// Catalogue of every Polish act in force with a consolidated text (user, 2026-11-13: "RAG
// wszystkich obowiązujących aktów z ELI — teksty jednolite i nowelizacje, rozporządzenia, z
// monitorowaniem stanu raz na dzień, praca na lokalnej kopii"). Built from the ELI API: every
// in-force announcement of a consolidated text (Obwieszczenie … w sprawie ogłoszenia jednolitego
// tekstu), its base act, the newest t.j. per base act and the amendments after it. The core-law
// index (core-law-index.ts) takes these acts as its own and downloads, checks daily and reads
// them like the acts of the DR maps. The build resumes after an interruption: what was read is
// kept in the catalogue file after every batch.
import fs from "node:fs";
import path from "node:path";
export const ELI_CATALOG_API = "https://api.sejm.gov.pl/eli";
export const CATALOG_REFRESH_MS = 24 * 60 * 60 * 1000;
const DR = {
    "01": "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
    "02": "dr-02-prawo-cywilne-rodzinne-gospodarcze",
    "03": "dr-03-prawo-karne-wykroczenia-egzekucja",
    "04": "dr-04-prawo-pracy-zus-swiadczenia",
    "05": "dr-05-prawo-administracyjne-sadowoadministracyjne",
    "06": "dr-06-podatki-finanse-publiczne-aml",
    "07": "dr-07-zamowienia-publiczne-fundusze-ue",
    "08": "dr-08-samorzad-terytorialny-prawo-lokalne",
    "09": "dr-09-budownictwo-srodowisko-energia-transport",
    "10": "dr-10-zdrowie-farmacja-zywnosc-rolnictwo",
    "11": "dr-11-cyfrowe-cyber-ai-dane-ip",
    "12": "dr-12-sadownictwo-prokuratura-zawody-prawnicze",
    "13": "dr-13-sluzby-bezpieczenstwo-informacje-niejawne",
    "14": "dr-14-prawo-ue-miedzynarodowe-prawa-czlowieka",
    "15": "dr-15-compliance-iso-governance-audyt"
};
// The issuing minister and the subject in the title -> DR (a heuristic, named as such: domainSource TITLE).
const TITLE_RULES = [
    [/podat|akcyz|cło|celn|ordynacj\p{L}* podatk|finans\p{L}* publiczn|budżet|rachunkow|Ministra Finansów|przeciwdziałani\p{L}* praniu|bankow|kredyt|ubezpieczeń gospodarcz|kapitałow|giełd/iu, "06"],
    [/zamówie\p{L}* publiczn|koncesj\p{L}* na roboty|partnerstwie publiczno|funduszy europejsk|polityki spójności/iu, "07"],
    [/samorząd|gmin|powiat|województw|wojewod|metropolitaln|referendum lokaln/iu, "08"],
    [/budowl|planowani\p{L}* przestrzenn|środowisk|odpad|energ|klimat|wod\p{L}* |transport|drog|kolej|lotnic|morsk|żegl|geodez|górnicz|gazow|paliw|Ministra Infrastruktury|Ministra Klimatu|Ministra Rozwoju i Technologii|nieruchomości|mieszkan|lasach|łowiec/iu, "09"],
    [/zdrow|lecznicz|farmac|lekar|pielęgniar|pacjent|szpital|żywnoś|weteryn|rolni|nasien|zwierząt|roślin|Ministra Zdrowia|Ministra Rolnictwa|sanitar|epidem|narkoman|alkohol/iu, "10"],
    [/danych osobowych|cyberbezpiecz|telekomunik|elektroniczn|informatyz|cyfryzac|sztucznej inteligencji|prawie autorskim|własności przemysłowej|Ministra Cyfryzacji|zaufania|podpis\p{L}* elektron/iu, "11"],
    [/sądów|sąd\p{L}* powszechn|Sądzie Najwyższym|prokurat|adwokat|radc|notari|komornik|kurator|Krajowej Radzie Sądownictwa|kosztach sądowych|Ministra Sprawiedliwości/iu, "12"],
    [/Policj|wojsk|obron|żołnierz|służb\p{L}* (?:specjaln|celno|więzien)|Straży (?:Granicznej|Pożarnej)|informacji niejawnych|bezpieczeństw\p{L}* (?:państwa|wewnętrzn)|Agencji Bezpieczeństwa|broni|amunicj|Ministra Spraw Wewnętrznych|Ministra Obrony|ochronie ludności|zarządzani\p{L}* kryzysow/iu, "13"],
    [/umow\p{L}* międzynarodow|ratyfik|Unii Europejskiej|Konwencj/iu, "14"],
    [/sygnalist|biegłych rewidentach|audyt|nadzorze publicznym|normalizac|akredytac/iu, "15"],
    [/pracy|zatrudnieni|emerytur|rent\p{L}* |ubezpieczeń społecznych|zasiłk|świadcze\p{L}* (?:rodzin|socjaln)|pomocy społecznej|niepełnosprawn|Ministra Rodziny|związk\p{L}* zawodow|bezrobot/iu, "04"],
    [/karn|wykrocze|przestęp|więziennictw|egzekuc|probacj/iu, "03"],
    [/cywiln|rodzin\p{L}* i opiekuńcz|spół|upadłości|restrukturyzac|ksiąg\p{L}* wieczyst|własności lokali|spółdziel|fundacj|stowarzysz|gospodarcz|przedsiębiorc|konsument|spadk/iu, "02"],
    [/postępowani\p{L}* administracyjn|sądów administracyjnych|cudzoziem|ewidencji ludności|dowod\p{L}* osobist|stanu cywilnego|oświat|szkoln|nauk\p{L}* |szkolnictw|kultur|zabytk|sport|mediów|radiofonii|petycj|dostępie do informacji publicznej|Ministra Edukacji|Ministra Nauki/iu, "05"],
    [/Konstytucj|Trybunale Konstytucyjnym|Sejm|Senat|Prezydent|Rad\p{L}* Ministrów|wybor|Kodeks wyborczy|Rzecznik\p{L}* Praw Obywatelskich|Najwyższej Izbie Kontroli|ogłaszaniu aktów normatywnych/iu, "01"]
];
/** DR modules of an act by its title (the minister issuing it and its subject). */
export function domainsByTitle(title) {
    const hits = [];
    for (const [pattern, dr] of TITLE_RULES)
        if (pattern.test(title) && !hits.includes(DR[dr]))
            hits.push(DR[dr]);
    return hits.slice(0, 2).length ? hits.slice(0, 2) : [DR["05"]];
}
export function emptyCatalog() {
    return { schemaVersion: 1, builtAt: null, notices: {}, acts: {}, complete: false };
}
export function catalogFile(directory) {
    return path.join(directory, "eli-catalog.json");
}
export function loadCatalog(directory) {
    try {
        const value = JSON.parse(fs.readFileSync(catalogFile(directory), "utf8"));
        return value?.schemaVersion === 1 ? value : emptyCatalog();
    }
    catch {
        return emptyCatalog();
    }
}
function saveCatalog(directory, catalog) {
    fs.mkdirSync(directory, { recursive: true });
    const target = catalogFile(directory);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(catalog));
    fs.renameSync(`${target}.tmp`, target);
}
const eliId = (value) => {
    const id = typeof value === "string" ? value : value?.id;
    return typeof id === "string" && /^[A-Z]{2}\/\d{4}\/\d+$/u.test(id) ? id : null;
};
/**
 * Builds or refreshes the catalogue: the list of in-force announcements (a few requests), the
 * details of announcements not read yet, then the base acts not read yet or whose newest t.j.
 * changed. Saved after every batch: an interrupted build continues where it stopped.
 */
export async function refreshEliCatalog(args) {
    const fetcher = args.fetcher ?? globalThis.fetch.bind(globalThis);
    const gap = args.gapMs ?? 750;
    const batch = args.batch ?? 25;
    const now = args.now ?? Date.now;
    const limit = args.maxRequests ?? Infinity;
    const catalog = loadCatalog(args.directory);
    let requests = 0;
    const get = async (url) => {
        if (requests >= limit)
            throw new Error("ELI_CATALOG_REQUEST_LIMIT");
        requests += 1;
        if (gap)
            await new Promise((resolve) => setTimeout(resolve, gap));
        for (let attempt = 1;; attempt += 1) {
            try {
                const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
                if (response.status === 404)
                    return null;
                if (!response.ok)
                    throw new Error(`ELI_HTTP_${response.status}`);
                return await response.json();
            }
            catch (error) {
                if (attempt >= 3)
                    throw error;
                await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
            }
        }
    };
    try {
        // 1. Every in-force announcement of a consolidated text (Dz.U.).
        const listed = [];
        for (let offset = 0;; offset += 500) {
            const page = (await get(`${ELI_CATALOG_API}/acts/search?publisher=DU&title=jednolitego&type=Obwieszczenie&inForce=1&limit=500&offset=${offset}`));
            const items = page?.items ?? [];
            listed.push(...items);
            if (items.length < 500)
                break;
        }
        const inForce = new Set(listed.map((item) => item.ELI));
        for (const eli of Object.keys(catalog.notices))
            if (!inForce.has(eli))
                delete catalog.notices[eli];
        // 2. Base acts of the announcements not read yet.
        const unread = listed.filter((item) => !catalog.notices[item.ELI]);
        for (let index = 0; index < unread.length; index += 1) {
            const item = unread[index];
            const detail = (await get(`${ELI_CATALOG_API}/acts/${item.ELI}`));
            catalog.notices[item.ELI] = {
                date: item.announcementDate ?? detail?.announcementDate ?? null,
                base: (detail?.references?.["Tekst jednolity dla aktu"] ?? []).map(eliId).filter((eli) => Boolean(eli))
            };
            if ((index + 1) % batch === 0) {
                saveCatalog(args.directory, catalog);
                args.onProgress?.("obwieszczenia", index + 1, unread.length);
            }
        }
        saveCatalog(args.directory, catalog);
        // 3. The newest t.j. per base act; base acts not read yet or with a newer t.j.
        const newest = new Map();
        for (const [tj, notice] of Object.entries(catalog.notices)) {
            for (const base of notice.base) {
                const current = newest.get(base);
                if (!current || String(notice.date) > String(current.date))
                    newest.set(base, { tj, date: notice.date });
            }
        }
        for (const eli of Object.keys(catalog.acts))
            if (!newest.has(eli))
                delete catalog.acts[eli];
        const due = [...newest.entries()].filter(([eli, latest]) => catalog.acts[eli]?.tj !== latest.tj);
        for (let index = 0; index < due.length; index += 1) {
            const [eli, latest] = due[index];
            const detail = (await get(`${ELI_CATALOG_API}/acts/${eli}`));
            const title = detail?.title ?? "";
            const fromMap = [...new Set([...(args.mapDomains?.(eli) ?? []), ...(args.mapDomains?.(latest.tj) ?? [])])];
            catalog.acts[eli] = {
                eli,
                tj: latest.tj,
                tjDate: latest.date,
                title,
                type: detail?.type ?? "",
                inForce: detail?.inForce === "IN_FORCE",
                amendmentsAfter: (detail?.references?.["Nowelizacje po tekście jednolitym"] ?? []).map(eliId).filter((value) => Boolean(value)),
                domains: fromMap.length ? fromMap : domainsByTitle(title),
                domainSource: fromMap.length ? "MAP" : "TITLE"
            };
            if ((index + 1) % batch === 0) {
                saveCatalog(args.directory, catalog);
                args.onProgress?.("akty", index + 1, due.length);
            }
        }
        catalog.complete = true;
        catalog.builtAt = new Date(now()).toISOString();
    }
    catch (error) {
        if (!(error instanceof Error && error.message === "ELI_CATALOG_REQUEST_LIMIT")) {
            catalog.complete = false;
            saveCatalog(args.directory, catalog);
            throw error;
        }
        catalog.complete = false;
    }
    saveCatalog(args.directory, catalog);
    return { catalog, requests, complete: catalog.complete };
}
/** The catalogue's acts in force, as the core-law index takes them (the t.j. is the text to keep). */
export function catalogRefs(catalog) {
    return Object.values(catalog.acts)
        .filter((act) => act.inForce)
        .map((act) => ({ eli: act.eli, tj: act.tj, title: act.title, domains: act.domains, amendmentsAfter: act.amendmentsAfter }));
}
export function catalogDue(catalog, now = Date.now()) {
    return !catalog.complete || !catalog.builtAt || now - Date.parse(catalog.builtAt) >= CATALOG_REFRESH_MS;
}
