// ELI (European Legislation Identifier) of the civil-law countries, for the jurisdiction
// packages that follow the Polish one. Source of every template: the country's page in the
// EUR-Lex ELI register (eur-lex.europa.eu/eli-register/<country>.html, read 2026-11-08) or the
// country's own ELI page named in `source`; never written from memory. An address is built
// only where the template is documented; elsewhere the country is listed with its status and
// the package has to read its portal's documentation first.
//
// What the method calls a consolidated version (shared/TEMPORAL-LAW-CHECK.md) differs:
// - "osobny-akt": a separate act of the official journal with its own ELI (Poland: t.j.);
// - "wersja-z-data": a version of the same identifier at a point in time (ES, IT, AT, RS, SI…);
// - "wersja-bez-mocy": a consolidated text without legal force next to the original (BE, FR);
// - "nieustalone": the register does not say.
const pad = (value) => String(value ?? "").padStart(2, "0");
const parts = (...values) => values.filter((value) => value !== undefined && value !== "").map((value) => encodeURIComponent(String(value))).join("/");
const REGISTER = (country) => `https://eur-lex.europa.eu/eli-register/${country}.html`;
export const ELI_COUNTRIES = [
    {
        code: "PL",
        name: "Polska",
        family: "kontynentalne",
        portal: "https://eli.gov.pl, https://api.sejm.gov.pl/eli",
        pillars: "1, 2, 3",
        template: "https://eli.gov.pl/eli/{journal}/{year}/{position}/{ogl|tj|uj}/pol/{pdf|html}",
        consolidation: "osobny-akt",
        consolidatedVersion: "tj (tekst jednolity — osobna pozycja Dz.U.)",
        example: "https://eli.gov.pl/eli/DU/2026/795/tj/pol/pdf",
        api: { url: "https://api.sejm.gov.pl/eli", kind: "REST", auth: "brak", probe: "https://api.sejm.gov.pl/eli/acts/DU/2026/795", checked: "200 application/json" },
        source: REGISTER("poland"),
        level: "PEŁNA",
        checked: "200",
        build: (ref) => `https://eli.gov.pl/eli/${parts(ref.type, ref.year, ref.number, ref.version ?? "ogl", ref.language ?? "pol", ref.format ?? "pdf")}`
    },
    {
        code: "AT",
        name: "Austria",
        family: "kontynentalne",
        portal: "https://www.ris.bka.gv.at",
        pillars: "1 (4 aplikacje RIS)",
        template: "https://www.ris.bka.gv.at/eli/bgbl/{I|II|III}/{year}/{number}/{date} (dziennik); …/eli/bgbl/{year}/{number}/{unit}/{NOR-id} (prawo skonsolidowane)",
        consolidation: "wersja-z-data",
        example: "https://www.ris.bka.gv.at/eli/bgbl/I/2018/30/20180516",
        api: { url: "https://data.bka.gv.at/ris/api/v2.6", kind: "REST", auth: "brak", probe: "https://data.bka.gv.at/ris/api/v2.6/Bundesrecht?Applikation=BrKons&Titel=ABGB", checked: "200 application/json (OgdSearchResult)" },
        source: REGISTER("austria"),
        level: "ADRES-NIEPOTWIERDZONY",
        checked: "503",
        // The authentic gazette only: the consolidated address needs RIS's own NOR identifier.
        build: (ref) => `https://www.ris.bka.gv.at/eli/bgbl/${parts(ref.type, ref.year, ref.number, ref.pointInTime)}`
    },
    {
        code: "BE",
        name: "Belgia",
        family: "kontynentalne",
        portal: "https://www.ejustice.just.fgov.be/eli/",
        pillars: "1",
        template: "https://www.ejustice.just.fgov.be/eli/{type}/{YYYY}/{MM}/{DD}/{unique id}/{moniteur|justel}",
        consolidation: "wersja-bez-mocy",
        consolidatedVersion: "justel (wersja skonsolidowana bez mocy prawnej); moniteur = tekst pierwotny",
        example: "https://www.ejustice.just.fgov.be/eli/loi/2014/04/25/2014003194/justel",
        source: REGISTER("belgium"),
        level: "ADRES",
        checked: "200",
        build: (ref) => `https://www.ejustice.just.fgov.be/eli/${parts(ref.type, ref.year, pad(ref.month), pad(ref.day), ref.number, ref.version ?? "justel")}`
    },
    {
        code: "DK",
        name: "Dania",
        family: "nordyckie",
        portal: "https://www.retsinformation.dk/eli",
        pillars: "1, 2, 3",
        template: "https://www.retsinformation.dk/eli/{domain}/{year}/{natural identifier}/{pdf|html|xml}",
        consolidation: "nieustalone",
        example: "https://www.retsinformation.dk/eli/lta/2014/1308",
        api: { url: "https://api.retsinformation.dk/v1/Documents", kind: "REST", auth: "brak", probe: "?date={dzień z ostatnich 10 dni}", checked: "200 (lista zmian dnia; starsza data = 400)" },
        source: REGISTER("denmark"),
        level: "ADRES",
        checked: "200",
        build: (ref) => `https://www.retsinformation.dk/eli/${parts(ref.type, ref.year, ref.number, ref.format)}`
    },
    {
        code: "FI",
        name: "Finlandia",
        family: "nordyckie",
        portal: "https://data.finlex.fi",
        pillars: "1, 2, 3",
        template: "https://data.finlex.fi/eli/sd/{year}/{number}/{alkup|ajantasa}… (opis: data.finlex.fi/fi/urit)",
        consolidation: "wersja-z-data",
        example: "https://data.finlex.fi/eli/sd/2008/521/alkup.html",
        api: { url: "https://opendata.finlex.fi/finlex/avoindata/v1", kind: "AKN", auth: "brak", probe: "/akn/fi/act/statute-consolidated/list?page=1&limit=1", checked: "200 application/json (URI Akoma Ntoso)" },
        source: REGISTER("finland"),
        level: "BRAK-SZABLONU",
        // The register's example and its template page answer 404: the service moved.
        checked: "404 (przykład i strona szablonu)"
    },
    {
        code: "FR",
        name: "Francja",
        family: "kontynentalne",
        portal: "https://www.legifrance.gouv.fr/eli/",
        pillars: "1",
        template: "https://www.legifrance.gouv.fr/eli/{type}/{year}/{month}/{day}/{natural identifier}/{version}/{level}",
        consolidation: "wersja-bez-mocy",
        example: "https://www.legifrance.gouv.fr/eli/loi/2023/4/14/2023-270/jo/texte",
        api: { url: "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app", kind: "REST", auth: "klucz", probe: "/consult/ping bez klucza", checked: "400 (wymaga OAuth PISTE: konto piste.gouv.fr, aplikacja z subskrypcją API Légifrance i zgodą na CGU, token client_credentials z https://oauth.piste.gouv.fr/api/oauth/token, sandbox: sandbox-oauth.piste.gouv.fr; serwer tokenów odpowiada invalid_client bez kluczy)" },
        source: REGISTER("france"),
        level: "ADRES-NIEPOTWIERDZONY",
        checked: "403 (blokada automatów)",
        build: (ref) => `https://www.legifrance.gouv.fr/eli/${parts(ref.type, ref.year, ref.month, ref.day, ref.number, ref.version ?? "jo", "texte")}`
    },
    {
        code: "DE",
        name: "Niemcy",
        family: "kontynentalne",
        portal: "https://www.recht.bund.de",
        pillars: "1",
        consolidation: "nieustalone",
        source: REGISTER("germany"),
        level: "BRAK-SZABLONU",
        checked: "rejestr nie podaje szablonu"
    },
    {
        code: "IT",
        name: "Włochy",
        family: "kontynentalne",
        portal: "https://www.gazzettaufficiale.it/eli/",
        pillars: "1, 2, 3",
        template: "https://www.gazzettaufficiale.it/eli/id/{yyyy}/{mm}/{dd}/{codiceRedazionale}/{tipoSerie}",
        consolidation: "wersja-z-data",
        example: "https://www.gazzettaufficiale.it/eli/id/2015/04/16/15G00055/sg",
        source: REGISTER("italy"),
        level: "ADRES",
        checked: "200",
        build: (ref) => `https://www.gazzettaufficiale.it/eli/id/${parts(ref.year, pad(ref.month), pad(ref.day), ref.number, ref.type)}`
    },
    {
        code: "LU",
        name: "Luksemburg",
        family: "kontynentalne",
        portal: "https://legilux.public.lu/eli",
        pillars: "1, 2, 3",
        template: "http://data.legilux.public.lu/eli/etat/{serie}/{type}/{year}/{month}/{day}/{ID}",
        consolidation: "nieustalone",
        example: "http://data.legilux.public.lu/eli/etat/leg/loi/2017/06/13/a566/jo",
        api: { url: "https://data.legilux.public.lu/sparqlendpoint", kind: "SPARQL", auth: "brak", probe: "ASK {?s ?p ?o}", checked: "200 boolean true" },
        source: REGISTER("luxembourg"),
        level: "ADRES-NIEPOTWIERDZONY",
        checked: "połączenie zerwane",
        build: (ref) => `http://data.legilux.public.lu/eli/etat/leg/${parts(ref.type, ref.year, pad(ref.month), pad(ref.day), ref.number, ref.version ?? "jo")}`
    },
    {
        code: "NO",
        name: "Norwegia",
        family: "nordyckie",
        portal: "https://lovdata.no/eli/",
        pillars: "1, 2, 3 (beta)",
        template: "/eli/{jurisdiction}/{type}/{year}/{month}/{day}/{natural_identifier}/{level…}/{version}/{point in time}/{language}/{format} (wzorzec ogólny; adresy: lovdata.no/eli)",
        consolidation: "wersja-z-data",
        api: { url: "https://api.lovdata.no", kind: "REST", auth: "brak", probe: "/v1/publicData/list", checked: "405 (ścieżka do potwierdzenia)" },
        source: REGISTER("norway"),
        level: "BRAK-SZABLONU",
        checked: "405 (strona startowa ELI)"
    },
    {
        code: "PT",
        name: "Portugalia",
        family: "kontynentalne",
        portal: "https://data.dre.pt/eli",
        pillars: "1, 2",
        template: "http://data.dre.pt/eli/{type}/{number}/{year}/{month}/{day}/p/dre/pt/html",
        consolidation: "nieustalone",
        example: "http://data.dre.pt/eli/lei/26/2006/06/30/p/dre/pt/html",
        source: REGISTER("portugal"),
        level: "ADRES",
        checked: "200 (przekierowanie do diariodarepublica.pt)",
        build: (ref) => `http://data.dre.pt/eli/${parts(ref.type, ref.number, ref.year, pad(ref.month), pad(ref.day))}/p/dre/pt/html`
    },
    {
        code: "RS",
        name: "Serbia",
        family: "kontynentalne",
        portal: "https://www.pravno-informacioni-sistem.rs",
        pillars: "1, 2, 3",
        template: "http://www.pravno-informacioni-sistem.rs/SlGlasnikPortal/eli/{level}/{type_gazette}/{passed_by}/{type_document}/{year}/{number}/{serial_number}/{sg|reg}/{point_in_time YYYYMMDD}",
        consolidation: "wersja-z-data",
        consolidatedVersion: "reg (rejestr tekstów ujednoliconych) + punkt w czasie YYYYMMDD",
        example: "http://www.pravno-informacioni-sistem.rs/SlGlasnikPortal/eli/rep/sgrs/skupstina/zakon/2013/45/4/reg",
        source: REGISTER("serbia"),
        level: "ADRES",
        checked: "200",
        // type = "{passed_by}/{type_document}", e.g. "skupstina/zakon"; number = "{number}/{serial}".
        build: (ref) => `http://www.pravno-informacioni-sistem.rs/SlGlasnikPortal/eli/rep/sgrs/${ref.type.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(String(ref.year))}/${ref.number.split("/").map(encodeURIComponent).join("/")}/${parts(ref.version ?? "reg", ref.pointInTime)}`
    },
    {
        code: "SI",
        name: "Słowenia",
        family: "kontynentalne",
        portal: "https://pisrs.si/eli",
        pillars: "1, 2 (w budowie)",
        template: "https://pisrs.si/eli/{type}/{SOP}/{npb}/{version number}/{language}/{format}",
        consolidation: "wersja-z-data",
        consolidatedVersion: "npb/{numer wersji} (nieoficjalna wersja skonsolidowana; 0 = akt ogłoszony)",
        source: REGISTER("slovenia"),
        level: "ADRES-NIEPOTWIERDZONY",
        checked: "407 (proxy sieci aplikacji)",
        build: (ref) => `https://pisrs.si/eli/${parts(ref.type, ref.number, "npb", ref.version ?? "0", ref.language ?? "SI", ref.format ?? "html")}`
    },
    {
        code: "ES",
        name: "Hiszpania",
        family: "kontynentalne",
        portal: "https://www.boe.es/eli/, https://elidata.es",
        pillars: "1, 2, 3, 4",
        template: "https://www.boe.es/eli/{jurisdiction}/{type}/{year}/{month}/{day}/{number}/{version}/{version_date}/{language}/{format}",
        consolidation: "wersja-z-data",
        consolidatedVersion: "con/{RRRRMMDD} (bez daty: najnowsza wersja skonsolidowana); dof = tekst ogłoszony",
        example: "https://www.boe.es/eli/es/l/2015/10/01/39/con/20220713/spa/html",
        api: { url: "https://www.boe.es/datosabiertos/api/legislacion-consolidada", kind: "REST", auth: "brak", probe: "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/BOE-A-2015-10565/metadatos", checked: "200 application/json" },
        source: REGISTER("spain"),
        level: "ADRES",
        checked: "200",
        build: (ref) => `https://www.boe.es/eli/es/${parts(ref.type, ref.year, pad(ref.month), pad(ref.day), ref.number, ref.version ?? "con", ref.pointInTime, ref.language ?? "spa", ref.format ?? "html")}`
    },
    {
        code: "CH",
        name: "Szwajcaria",
        family: "kontynentalne",
        portal: "https://fedlex.data.admin.ch",
        pillars: "1, 2, 3 (Casemates, SPARQL)",
        template: "https://fedlex.data.admin.ch/eli/cc/{year}/{id}/{language} (konwencja: fedlex.data.admin.ch/home/convention)",
        consolidation: "wersja-z-data",
        example: "https://fedlex.data.admin.ch/eli/cc/1958/505_527_527/fr",
        api: { url: "https://fedlex.data.admin.ch/sparqlendpoint", kind: "SPARQL", auth: "brak", probe: "ASK {?s ?p ?o}", checked: "200 boolean true" },
        source: REGISTER("switzerland"),
        level: "ADRES",
        checked: "200",
        build: (ref) => `https://fedlex.data.admin.ch/eli/${parts(ref.type ?? "cc", ref.year, ref.number, ref.language ?? "de")}`
    },
    {
        code: "HR",
        name: "Chorwacja",
        family: "kontynentalne",
        portal: "https://narodne-novine.nn.hr/eli",
        pillars: "1 (Narodne novine)",
        template: "https://narodne-novine.nn.hr/eli/{sluzbeni|medunarodni}/{year}/{issue}/{number}… (z linków portalu)",
        consolidation: "nieustalone",
        example: "https://narodne-novine.nn.hr/eli/sluzbeni/2023/1/pdf",
        source: "https://narodne-novine.nn.hr/about_eli_hr.aspx",
        level: "BRAK-SZABLONU",
        checked: "200 (portal); szablonu aktu rejestr nie podaje"
    },
    { code: "CZ", name: "Czechy", family: "kontynentalne", portal: "https://e-sbirka.gov.cz", pillars: "1", consolidation: "wersja-z-data", source: "https://e-sbirka.gov.cz/pristup-pres-stale-url-a-eli", level: "BRAK-SZABLONU", checked: "200 (strona schematu ładowana skryptem; schemat do odczytania ręcznie)" },
    { code: "SK", name: "Słowacja", family: "kontynentalne", portal: "https://www.slov-lex.sk", pillars: "1", consolidation: "nieustalone", source: REGISTER("slovakia"), level: "BRAK-SZABLONU", checked: "rejestr nie podaje szablonu" },
    { code: "HU", name: "Węgry", family: "kontynentalne", portal: "https://njt.hu/eli", pillars: "1", consolidation: "nieustalone", source: "https://njt.hu/eli/urisemak", level: "BRAK-SZABLONU", checked: "brak odpowiedzi serwera (strona schematu)" },
    { code: "GR", name: "Grecja", family: "kontynentalne", portal: "https://www.et.gr", pillars: "1, 2, 3 (częściowo)", consolidation: "nieustalone", source: REGISTER("greece"), level: "BRAK-SZABLONU", checked: "rejestr nie podaje szablonu" },
    { code: "RO", name: "Rumunia", family: "kontynentalne", portal: "https://legislatie.just.ro", pillars: "1, 2", consolidation: "nieustalone", source: REGISTER("romania"), level: "BRAK-SZABLONU", checked: "rejestr nie podaje szablonu; portal: błąd protokołu" },
    { code: "LT", name: "Litwa", family: "kontynentalne", portal: "—", pillars: "1 (w trakcie)", consolidation: "nieustalone", source: REGISTER("lithuania"), level: "BRAK-SZABLONU", checked: "wdrożenie w toku" },
    { code: "NL", name: "Holandia", family: "kontynentalne", portal: "—", pillars: "1 (w trakcie)", consolidation: "nieustalone", source: REGISTER("netherlands"), level: "BRAK-SZABLONU", checked: "wdrożenie w toku" },
    { code: "SE", name: "Szwecja", family: "nordyckie", portal: "—", pillars: "1 (w trakcie)", consolidation: "nieustalone", source: REGISTER("sweden"), level: "BRAK-SZABLONU", checked: "wdrożenie w toku" },
    { code: "AL", name: "Albania", family: "kontynentalne", portal: "—", pillars: "nie podano", consolidation: "nieustalone", source: REGISTER("albania"), level: "BRAK-SZABLONU", checked: "rejestr podaje tylko koordynatorów" },
    {
        code: "MT",
        name: "Malta",
        family: "mieszane",
        portal: "https://legislation.mt/eli/",
        pillars: "1, 2, 3 (technicznie)",
        template: "https://legislation.mt/eli/{type}/{year}*/{natural identifier}/{lang}/{format}",
        consolidation: "osobny-akt",
        consolidatedVersion: "cap / sl = prawo skonsolidowane (bez roku); act / ln = publikacje",
        source: REGISTER("malta"),
        level: "ADRES-NIEPOTWIERDZONY",
        checked: "nie sprawdzano",
        build: (ref) => `https://legislation.mt/eli/${parts(ref.type, ref.type === "cap" || ref.type === "sl" ? undefined : ref.year, ref.number, ref.language ?? "eng", ref.format ?? "pdf")}`
    }
];
/** The EU's own ELI (EUR-Lex, Cellar): acts of the Union for every package. */
export const EU_ELI = {
    url: "https://publications.europa.eu/webapi/rdf/sparql",
    kind: "SPARQL",
    auth: "brak",
    probe: "ASK {?s ?p ?o} (Accept: application/sparql-results+json)",
    checked: "200 boolean true",
    template: "http://data.europa.eu/eli/{typedoc}/{year}/{naturalnumber}/oj",
    example: "http://data.europa.eu/eli/reg/2013/216/oj"
};
/** Countries of common law in the ELI register: not civil law, no package from this list. */
export const COMMON_LAW_IN_ELI_REGISTER = ["IE", "UK", "CY"];
export function eliCountry(code) {
    return ELI_COUNTRIES.find((country) => country.code === code.toUpperCase());
}
/** The official ELI address of an act, or null when the country has no documented template. */
export function eliAddress(code, ref) {
    const country = eliCountry(code);
    return country?.build ? country.build(ref) : null;
}
/** What the app can do with a country's ELI, in one line for the degraded-mode notice. */
export function eliCapabilityNotice(code) {
    const country = eliCountry(code);
    if (!country)
        return null;
    if (country.level === "PEŁNA")
        return null;
    if (country.build) {
        return `ELI ${country.name}: aplikacja zbuduje urzędowy adres aktu (${country.template ?? country.portal}), ale nie odczyta ani nie sprawdzi brzmienia przepisu${country.level === "ADRES-NIEPOTWIERDZONY" ? `; adres nie odpowiedział z sieci aplikacji (${country.checked})` : ""}.${apiLine(country)}`;
    }
    return `ELI ${country.name}: rejestr nie podaje szablonu adresu (${country.checked}); przepisy sprawdzaj na portalu ${country.portal}.${apiLine(country)}`;
}
function apiLine(country) {
    if (!country.api)
        return "";
    return ` API ${country.api.kind}: ${country.api.url}${country.api.auth === "klucz" ? " (wymaga klucza)" : ""}, kontrola: ${country.api.checked}.`;
}
