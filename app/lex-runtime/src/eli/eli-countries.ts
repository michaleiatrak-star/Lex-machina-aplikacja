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

export type LegalFamily = "kontynentalne" | "nordyckie" | "mieszane";

export type EliConsolidation = "osobny-akt" | "wersja-z-data" | "wersja-bez-mocy" | "nieustalone";

export type EliLevel =
  // The app reads the text and checks the wording (Poland only).
  | "PEŁNA"
  // Address built from a documented template; the example address answered on 2026-11-08.
  | "ADRES"
  // Template documented, the example did not answer from the app's network (portal block,
  // proxy, outage): the address is built, reachability to be confirmed from the user's side.
  | "ADRES-NIEPOTWIERDZONY"
  // ELI announced or implemented without a public template in the register: no address.
  | "BRAK-SZABLONU";

export type EliReference = {
  type: string;
  year: number | string;
  month?: number | string;
  day?: number | string;
  number: string;
  version?: string;
  pointInTime?: string;
  language?: string;
  format?: string;
};

// Whether the app reads the text of an act from the country's official source (live check
// 2026-11-08): a reader exists, the source answers with text a reader can parse, only a PDF,
// a blocked or script-only page, a key needed, or no connection from the app's network.
export type TextReading =
  | "PEŁNY"
  | "CZYTNIK"
  | "PDF"
  | "BLOKADA"
  | "JS"
  | "KLUCZ"
  | "BRAK-POŁĄCZENIA"
  | "DO-ZBADANIA";

export type EliCountry = {
  code: string;
  name: string;
  family: LegalFamily;
  portal: string;
  pillars: string;
  template?: string;
  consolidation: EliConsolidation;
  // How the consolidated version is asked for in the address, when the template says.
  consolidatedVersion?: string;
  example?: string;
  source: string;
  level: EliLevel;
  // Live check of the example from the app's network, 2026-11-08 (HTTP status or the error).
  checked: string;
  build?: (ref: EliReference) => string;
  // The country's machine API (REST, SPARQL, Akoma Ntoso), checked live from the app's network.
  api?: EliApi;
  text?: { reading: TextReading; note: string };
};

export type EliApi = {
  url: string;
  kind: "REST" | "SPARQL" | "AKN";
  // What the API needs: none, or a key the user registers for.
  auth: "brak" | "klucz";
  // The probe that answered, and its result on 2026-11-08.
  probe: string;
  checked: string;
};

const pad = (value: number | string | undefined): string => String(value ?? "").padStart(2, "0");
const parts = (...values: Array<string | number | undefined>): string =>
  values.filter((value) => value !== undefined && value !== "").map((value) => encodeURIComponent(String(value))).join("/");
const REGISTER = (country: string): string => `https://eur-lex.europa.eu/eli-register/${country}.html`;

export const ELI_COUNTRIES: readonly EliCountry[] = [
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
    text: { reading: "PEŁNY", note: "eli.gov.pl i API Sejmu: tekst, t.j., nowelizacje (weryfikacja przepisów w aplikacji)" },
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
    text: { reading: "CZYTNIK", note: "readAustria: API RIS OGD (bez klucza) Titel + Abschnitt → XML normy z ogd.ris.bka.gv.at; ostatnia zmiana i data wejścia w życie; portal www.ris.bka.gv.at blokuje automaty" },
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
    text: { reading: "CZYTNIK", note: "readBelgium: Justel, akty zmieniające z datą wejścia w życie (bez mocy prawnej)" },
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
    consolidation: "osobny-akt",
    consolidatedVersion: "LBK (lovbekendtgørelse): osobny akt z listą uwzględnionych zmian, jak polski t.j.",
    example: "https://www.retsinformation.dk/eli/lta/2014/1308",
    api: { url: "https://api.retsinformation.dk/v1/Documents", kind: "REST", auth: "brak", probe: "?date={dzień z ostatnich 10 dni}", checked: "200 (lista zmian dnia; starsza data = 400)" },
    text: { reading: "CZYTNIK", note: "src/eli/readers.ts readDenmark: XML LexDania przez ELI …/xml" },
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
    text: { reading: "CZYTNIK", note: "src/eli/readers.ts readFinland: API Finlex AKN bez klucza, …/statute-consolidated/{rok}/{nr} (bez języka i wersji) zwraca najnowsze wyrażenia fin/swe; stare akty w częściach pod {nr}-001; tekst ujednolicony bez mocy (FRBRauthoritative false), pierwotny z mocą: …/statute/{rok}/{nr}/fin@" },
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
    text: { reading: "KLUCZ", note: "portal: Cloudflare; API Légifrance przez PISTE (OAuth); bez klucza: zrzut LEGI w otwartych danych DILA (echanges.dila.gouv.fr/OPENDATA/LEGI, 1,26 GB, codziennie, XML artykułów z datami wersji) — do pobrania raz i lokalnego indeksu" },
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
    consolidation: "wersja-z-data",
    // NeuRIS (rechtsinformationen.bund.de), test phase: ELI identifiers of the consolidated
    // versions (eli/bund/bgbl-1/{year}/s{page}/{version date}/{n}/deu/{date}/regelungstext-1.html),
    // text readable; on 2026-11-08 5 517 acts, BGB, StGB, ZPO and GG not among them.
    api: { url: "https://testphase.rechtsinformationen.bund.de/v1/legislation", kind: "REST", auth: "brak", probe: "https://testphase.rechtsinformationen.bund.de/v1/legislation?size=1", checked: "200 application/json (faza testowa; 5517 aktów, bez BGB/StGB/ZPO/GG; produkcja api.rechtsinformationen.bund.de zablokowana przez proxy sieci aplikacji)" },
    text: { reading: "CZYTNIK", note: "readGermany: gesetze-im-internet.de (nieurzędowy, kodeksy); NeuRIS (faza testowa, bez BGB/StGB/ZPO/GG)" },
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
    text: { reading: "CZYTNIK", note: "readItaly: Normattiva (akty samodzielne); artykuły kodeksów z załączników ładowane osobno — do zbadania" },
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
    text: { reading: "CZYTNIK", note: "readLuxembourg: ELI aktu → SPARQL (jolux:isExemplifiedBy) → Akoma Ntoso XML z filestore (legalValue: officiel); kodeksy skonsolidowane: ELI code/{kod}/art_N/{data} i PDF z datą" },
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
    text: { reading: "DO-ZBADANIA", note: "Lovdata API: ścieżka do potwierdzenia" },
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
    text: { reading: "JS", note: "diariodarepublica.pt wymaga JavaScriptu; DL 83/2016 przewiduje dane otwarte legislacji skonsolidowanej (dados.gov), publicznego API nie znaleziono" },
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
    text: { reading: "JS", note: "SlGlasnikPortal (pis-vue) wymaga JavaScriptu; publicznego API nie znaleziono (data.gov.rs: tylko rejestry MS)" },
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
    text: { reading: "JS", note: "PISRS wymaga JavaScriptu; rząd zapowiedział API (gov.si, 2024-03-27), pisrs.si z sieci aplikacji: 407 (proxy) — adres API do odczytu z dokumentacji PISRS" },
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
    api: { url: "https://www.boe.es/datosabiertos/api/legislacion-consolidada", kind: "REST", auth: "brak", probe: "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/BOE-A-2015-10565/metadatos", checked: "200 application/json; tekst: …/id/{BOE-A-…}/texto i …/texto/bloque/{a1} (Accept: application/xml), wersje z fecha_vigencia" },
    text: { reading: "CZYTNIK", note: "src/eli/es-boe.ts: artykuł z API BOE, wersje z fecha_vigencia" },
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
    text: { reading: "CZYTNIK", note: "readSwitzerland: Akoma Ntoso XML wersji z datą (filestore …/eli/cc/{id}/{RRRRMMDD}/{lang}/xml/…), adres pliku z SPARQL (jolux:isExemplifiedBy); przypisy ze zmianami (AS, in Kraft seit)" },
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
    text: { reading: "PDF", note: "Narodne novine: wydania w PDF (eli/sluzbeni/{rok}/{numer}/pdf)" },
    source: "https://narodne-novine.nn.hr/about_eli_hr.aspx",
    level: "BRAK-SZABLONU",
    checked: "200 (portal); szablonu aktu rejestr nie podaje"
  },
  { code: "CZ", name: "Czechy", family: "kontynentalne", portal: "https://e-sbirka.gov.cz", pillars: "1", consolidation: "wersja-z-data", api: { url: "https://api.e-sbirka.gov.cz", kind: "REST", auth: "klucz", probe: "bez nagłówka esel-api-access-key", checked: "401 NEPLATNY_API_KLIC (klucz: wniosek do datové schránky MV 6bnaawp, temat „e-Sbírka a e-Legislativa – registrace REST API”, ocena do 10 dni roboczych; nagłówek esel-api-access-key)" }, text: { reading: "CZYTNIK", note: "readCzech: publiczny cache portalu e-Sbírka (bez klucza): …/sbr-cache/dokumenty-sbirky/{staleUrl} i …/fragmenty; dane otwarte opendata.eselpoint.gov.cz (SPARQL, zbiory JSON-LD); REST API z kluczem MV" },
    source: "https://e-sbirka.gov.cz/pristup-pres-stale-url-a-eli", level: "BRAK-SZABLONU", checked: "200 (strona schematu ładowana skryptem; schemat do odczytania ręcznie)" },
  { code: "SK", name: "Słowacja", family: "kontynentalne", portal: "https://www.slov-lex.sk", pillars: "1", consolidation: "nieustalone", text: { reading: "JS", note: "Slov-Lex wymaga JavaScriptu; publicznego API nie znaleziono; dane otwarte MS (obcan.justice.sk/opendata) mają rejestry, nie zbiór ustaw; e-Zbierka: PDF podpisane (do sprawdzenia przez warstwę tekstową)" },
    source: REGISTER("slovakia"), level: "BRAK-SZABLONU", checked: "rejestr nie podaje szablonu" },
  { code: "HU", name: "Węgry", family: "kontynentalne", portal: "https://njt.hu/eli", pillars: "1", consolidation: "nieustalone", text: { reading: "BRAK-POŁĄCZENIA", note: "njt.hu (njt.jog.gov.hu): serwer nie odpowiada z sieci aplikacji; brak REST API (aplikacja JavaScript z sesją), adresy ELI …/eli/{typ}/{rok}" },
    source: "https://njt.hu/eli/urisemak", level: "BRAK-SZABLONU", checked: "brak odpowiedzi serwera (strona schematu)" },
  { code: "GR", name: "Grecja", family: "kontynentalne", portal: "https://www.et.gr", pillars: "1, 2, 3 (częściowo)", consolidation: "nieustalone", text: { reading: "PDF", note: "Εθνικό Τυπογραφείο: ΦΕΚ w PDF" },
    source: REGISTER("greece"), level: "BRAK-SZABLONU", checked: "rejestr nie podaje szablonu" },
  { code: "RO", name: "Rumunia", family: "kontynentalne", portal: "https://legislatie.just.ro", pillars: "1, 2", consolidation: "nieustalone", text: { reading: "BRAK-POŁĄCZENIA", note: "legislatie.just.ro: błąd protokołu z sieci aplikacji; bez klucza: usługa SOAP MS (…/apiws/FreeWebService.svc) — ta sama blokada; portal blokuje adresy centrów danych" },
    source: REGISTER("romania"), level: "BRAK-SZABLONU", checked: "rejestr nie podaje szablonu; portal: błąd protokołu" },
  { code: "LT", name: "Litwa", family: "kontynentalne", portal: "—", pillars: "1 (w trakcie)", consolidation: "nieustalone", text: { reading: "BLOKADA", note: "e-tar.lt: Cloudflare; bez klucza: API danych otwartych get.data.gov.lt (Spinta, zbiór TAR) — z sieci aplikacji 500, do sprawdzenia z sieci użytkownika" },
    source: REGISTER("lithuania"), level: "BRAK-SZABLONU", checked: "wdrożenie w toku" },
  { code: "NL", name: "Holandia", family: "kontynentalne", portal: "—", pillars: "1 (w trakcie)", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "readNetherlands: wetten.overheid.nl/{BWBR}/{data}/0" },
    source: REGISTER("netherlands"), level: "BRAK-SZABLONU", checked: "wdrożenie w toku" },
  { code: "SE", name: "Szwecja", family: "nordyckie", portal: "—", pillars: "1 (w trakcie)", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "readSweden: data.riksdagen.se/dokument/sfs-{rok}-{nr}.text (bez klucza), tekst ujednolicony Regeringskansliet z „Ändrad: t.o.m. SFS …”, rozdziały i paragrafy, akt zmieniający przy paragrafie" },
    source: REGISTER("sweden"), level: "BRAK-SZABLONU", checked: "wdrożenie w toku" },
  { code: "AL", name: "Albania", family: "kontynentalne", portal: "—", pillars: "nie podano", consolidation: "nieustalone", text: { reading: "JS", note: "qbz.gov.al: także adresy ELI (…/eli/ligj/{rok}/{mm}/{dd}/{nr}) zwracają tylko powłokę strony" },
    source: REGISTER("albania"), level: "BRAK-SZABLONU", checked: "rejestr podaje tylko koordynatorów" },

  // Outside the EUR-Lex ELI register (EU members without an entry, Turkey, Ukraine, Moldova and
  // the Balkan states outside the EU): no ELI template, the official portal and what it gives.
  { code: "BG", name: "Bułgaria", family: "kontynentalne", portal: "https://dv.parliament.bg", pillars: "brak w rejestrze", consolidation: "nieustalone", text: { reading: "JS", note: "Държавен вестник: aplikacja JSF; lex.bg (nieurzędowy) 403" }, source: "https://dv.parliament.bg/DVWeb/index.faces", level: "BRAK-SZABLONU", checked: "200 (portal)" },
  { code: "EE", name: "Estonia", family: "kontynentalne", portal: "https://www.riigiteataja.ee", pillars: "brak w rejestrze", consolidation: "nieustalone", text: { reading: "JS", note: "Riigi Teataja: strona wymaga JavaScriptu także pod adresem …/akt/{id}.xml; kod strony używa /public-api/api/v1 (kohtuteave, terminid, avalik/rtOsad), punktu z tekstem aktu w nim nie ma" }, source: "https://www.riigiteataja.ee/", level: "BRAK-SZABLONU", checked: "200 (strona JavaScript)" },
  { code: "LV", name: "Łotwa", family: "kontynentalne", portal: "https://likumi.lv", pillars: "brak w rejestrze", consolidation: "wersja-z-data", text: { reading: "CZYTNIK", note: "readLatvia: likumi.lv/ta/id/{id}, akapity p.TV213 (N. pants albo numer artykułu Kodeksu cywilnego)" }, source: "https://likumi.lv/ta/id/225418", level: "BRAK-SZABLONU", checked: "200 text/html" },
  { code: "TR", name: "Turcja", family: "kontynentalne", portal: "https://www.mevzuat.gov.tr", pillars: "brak ELI", consolidation: "wersja-bez-mocy", text: { reading: "PDF", note: "Mevzuat Bilgi Sistemi: PDF z warstwą tekstową (…/MevzuatMetin/{tür}.{tertip}.{no}.pdf, np. 1.5.4721 = Türk Medeni Kanunu, 206 stron)" }, source: "https://www.mevzuat.gov.tr/MevzuatMetin/1.5.4721.pdf", level: "BRAK-SZABLONU", checked: "200 application/pdf" },
  { code: "UA", name: "Ukraina", family: "kontynentalne", portal: "https://zakon.rada.gov.ua", pillars: "brak ELI", consolidation: "wersja-z-data", text: { reading: "BRAK-POŁĄCZENIA", note: "zakon.rada.gov.ua i data.rada.gov.ua: połączenie zerwane z sieci aplikacji (do sprawdzenia z sieci użytkownika)" }, source: "https://zakon.rada.gov.ua/", level: "BRAK-SZABLONU", checked: "połączenie zerwane" },
  { code: "MD", name: "Mołdawia", family: "kontynentalne", portal: "https://www.legis.md", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "BLOKADA", note: "legis.md: 403 dla automatów" }, source: "https://www.legis.md/", level: "BRAK-SZABLONU", checked: "403" },
  { code: "ME", name: "Czarnogóra", family: "kontynentalne", portal: "https://www.sluzbenilist.me", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "DO-ZBADANIA", note: "Službeni list i PIS CG: strona startowa odpowiada; akty do odnalezienia w PIS" }, source: "https://www.sluzbenilist.me/", level: "BRAK-SZABLONU", checked: "200 (portal)" },
  { code: "MK", name: "Macedonia Północna", family: "kontynentalne", portal: "http://www.slvesnik.com.mk", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "BRAK-POŁĄCZENIA", note: "Службен весник: odrzucony przez proxy sieci aplikacji" }, source: "http://www.slvesnik.com.mk/", level: "BRAK-SZABLONU", checked: "proxy" },
  { code: "BA", name: "Bośnia i Hercegowina", family: "kontynentalne", portal: "http://www.sluzbenilist.ba", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "DO-ZBADANIA", note: "Službeni list BiH: strona startowa odpowiada; prawo podzielone (BiH, FBiH, RS, Brčko)" }, source: "http://www.sluzbenilist.ba/", level: "BRAK-SZABLONU", checked: "200 (portal)" },
  { code: "XK", name: "Kosowo", family: "kontynentalne", portal: "https://gzk.rks-gov.net", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "DO-ZBADANIA", note: "Gazeta Zyrtare: portal odpowiada (sq, sr, en); akty na stronach ActDetail" }, source: "https://gzk.rks-gov.net/", level: "BRAK-SZABLONU", checked: "200 (portal)" },
  { code: "IS", name: "Islandia", family: "nordyckie", portal: "https://www.althingi.is/lagasafn/", pillars: "brak w rejestrze", consolidation: "wersja-z-data", text: { reading: "BLOKADA", note: "Lagasafn (Althingi): Cloudflare (403, JavaScript i ciasteczka)" }, source: "https://www.althingi.is/lagasafn/", level: "BRAK-SZABLONU", checked: "403 (Cloudflare)" },
  { code: "LI", name: "Liechtenstein", family: "kontynentalne", portal: "https://www.gesetze.li", pillars: "brak w rejestrze", consolidation: "wersja-z-data", text: { reading: "PDF", note: "Lilex: tekst skonsolidowany w PDF z warstwą tekstową (…/konso/pdf/{LGBl-id}?version={n}; PGR 1926.004: 1035 stron), strona HTML aktu to powłoka" }, source: "https://www.gesetze.li/konso/1926.004", level: "BRAK-SZABLONU", checked: "200 application/pdf" },
  { code: "MC", name: "Monako", family: "kontynentalne", portal: "https://legimonaco.mc", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "readMonaco: legimonaco.mc/code/{kod}/, section.art z ustawą zmieniającą i datą (aside.histo)" }, source: "https://legimonaco.mc/code/code-civil/", level: "BRAK-SZABLONU", checked: "200 text/html (835 tys. znaków tekstu)" },
  { code: "SM", name: "San Marino", family: "kontynentalne", portal: "https://www.consigliograndeegenerale.sm", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "DO-ZBADANIA", note: "Consiglio Grande e Generale: archiwum ustaw i dekretów (…/archivio-leggi-decreti-e-regolamenti.html), teksty jako dokumenty do pobrania" }, source: "https://www.consigliograndeegenerale.sm/on-line/home/archivio-leggi-decreti-e-regolamenti.html", level: "BRAK-SZABLONU", checked: "200 (portal)" },
  { code: "AD", name: "Andora", family: "kontynentalne", portal: "https://www.bopa.ad", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "JS", note: "BOPA: aplikacja JavaScript" }, source: "https://www.bopa.ad/", level: "BRAK-SZABLONU", checked: "200 (strona JavaScript)" },
  {
    code: "MT",
    name: "Malta",
    family: "mieszane",
    portal: "https://legislation.mt/eli/",
    pillars: "1, 2, 3 (technicznie)",
    template: "https://legislation.mt/eli/{type}/{year}*/{natural identifier}/{lang}/{format}",
    consolidation: "osobny-akt",
    consolidatedVersion: "cap / sl = prawo skonsolidowane (bez roku); act / ln = publikacje",
    text: { reading: "PDF", note: "legislation.mt: PDF z warstwą tekstową przez ELI (cap/sl skonsolidowane; Civil Code cap/16: 615 stron)" },
    source: REGISTER("malta"),
    level: "ADRES-NIEPOTWIERDZONY",
    checked: "nie sprawdzano",
    build: (ref) => `https://legislation.mt/eli/${parts(ref.type, ref.type === "cap" || ref.type === "sl" ? undefined : ref.year, ref.number, ref.language ?? "eng", ref.format ?? "pdf")}`
  }
];

/** The EU's own ELI (EUR-Lex, Cellar): acts of the Union for every package. */
export const EU_ELI: EliApi & { template: string; example: string } = {
  url: "https://publications.europa.eu/webapi/rdf/sparql",
  kind: "SPARQL",
  auth: "brak",
  probe: "ASK {?s ?p ?o} (Accept: application/sparql-results+json)",
  checked: "200 boolean true",
  template: "http://data.europa.eu/eli/{typedoc}/{year}/{naturalnumber}/oj",
  example: "http://data.europa.eu/eli/reg/2013/216/oj"
};

/** Countries of common law (EU: Ireland, Cyprus; and the UK): not civil law, no package from this list. */
export const COMMON_LAW_IN_ELI_REGISTER = ["IE", "UK", "CY"] as const;

export function eliCountry(code: string): EliCountry | undefined {
  return ELI_COUNTRIES.find((country) => country.code === code.toUpperCase());
}

/** The official ELI address of an act, or null when the country has no documented template. */
export function eliAddress(code: string, ref: EliReference): string | null {
  const country = eliCountry(code);
  return country?.build ? country.build(ref) : null;
}

/** What the app can do with a country's ELI, in one line for the degraded-mode notice. */
export function eliCapabilityNotice(code: string): string | null {
  const country = eliCountry(code);
  if (!country) return null;
  if (country.level === "PEŁNA") return null;
  if (country.build) {
    return `ELI ${country.name}: aplikacja zbuduje urzędowy adres aktu (${country.template ?? country.portal}), ale nie odczyta ani nie sprawdzi brzmienia przepisu${country.level === "ADRES-NIEPOTWIERDZONY" ? `; adres nie odpowiedział z sieci aplikacji (${country.checked})` : ""}.${apiLine(country)}`;
  }
  return `ELI ${country.name}: rejestr nie podaje szablonu adresu (${country.checked}); przepisy sprawdzaj na portalu ${country.portal}.${apiLine(country)}`;
}

function apiLine(country: EliCountry): string {
  if (!country.api) return "";
  return ` API ${country.api.kind}: ${country.api.url}${country.api.auth === "klucz" ? " (wymaga klucza)" : ""}, kontrola: ${country.api.checked}.`;
}
