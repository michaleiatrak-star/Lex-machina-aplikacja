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

// Legal family: decides the method (jurisdiction.ts). Common law: statute AND precedent are sources, the
// judgments are read like the acts; mixed: both traditions, by field (familyNote says which).
export type LegalFamily = "kontynentalne" | "nordyckie" | "mieszane" | "common-law";

export const LEGAL_FAMILY_LABELS: Readonly<Record<LegalFamily, string>> = {
  kontynentalne: "Prawo kontynentalne",
  nordyckie: "Prawo nordyckie",
  mieszane: "Systemy mieszane",
  "common-law": "Common law"
};

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
  // Mixed systems: which fields follow which tradition, and the language rule where texts differ.
  familyNote?: string;
  // Common law and mixed systems: where the judgments are read (precedent is a source).
  caseLaw?: { reading: TextReading; source: string; note: string };
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
    text: { reading: "CZYTNIK", note: "src/eli/fr-legi.ts: lokalny indeks zrzutu LEGI (otwarte dane DILA, echanges.dila.gouv.fr/OPENDATA/LEGI, około 1,2 GB, bez klucza; budowa: Ustawienia > Aplikacja > Prawo francuskie (LEGI)); kodeksy obowiązujące, wszystkie wersje artykułów z datami; portal: Cloudflare; alternatywa: API Légifrance przez PISTE (OAuth)" },
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
    text: { reading: "BLOKADA", note: "Lovdata (lovdata.no i api.lovdata.no, dane otwarte NLOD): z sieci aplikacji 405 „Request stopped by Varnish IPS” dla każdego żądania (2026-11-09); kopia w Internet Archive nieosiągalna; N-Lex nie obejmuje Norwegii; data.stortinget.no odpowiada (projekty i uchwalone ustawy — nie tekst obowiązujący). Czytnik po odczycie struktury Lovdata z sieci użytkownika" },
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
    text: { reading: "PDF", note: "diariodarepublica.pt wymaga JavaScriptu; PDF Diário da República: files.diariodarepublica.pt/{serie}/{rok}/{mm}/{nr}/{strony}.pdf (odczyt PDF; stare wydania to skany → OCR/RAG); dados.gov.pt: zbiory DR (wyszukiwanie aktów); tekst jednolity tylko w portalu" },
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
    text: { reading: "JS", note: "readParagraf: paragraf.rs/propisi/{nazwa}.html (nieurzędowy tekst jednolity, tylko do odnalezienia); SlGlasnikPortal i pravno-informacioni-sistem.rs: aplikacje JavaScript; parlament.gov.rs odpowiada (PDF uchwalonych ustaw); nieurzędowy tekst jednolity: paragraf.rs/propisi/{nazwa}.html (odpowiada) — tylko do odnalezienia artykułu" },
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
    api: { url: "https://pisrs.si/api", kind: "REST", auth: "brak", probe: "https://pisrs.si/api/rezultat/zbirka/id/ZAKO1263", checked: "200 application/json (karta aktu z wersjami Osnovni, NPB 1…4 i plikami HTML/DOCX/PDF)" },
    text: { reading: "CZYTNIK", note: "readPisrs: API PISRS (bez klucza, także akty po 28.02.2026): karta …/api/rezultat/zbirka/id/{ZAKOnnnn}, tekst wersji …/api/datoteke/integracije/{id pliku HTML}; NPB = tekst jednolity nieurzędowy; readSlovenia: archiwum Uradni list (uradni-list.si/glasilo-uradni-list-rs/vsebina/{rok}-01-{nr}, wydania do 28.02.2026)" },
    source: REGISTER("slovenia"),
    level: "ADRES-NIEPOTWIERDZONY",
    checked: "407 (proxy sieci aplikacji, 2026-11-08 rano); API pisrs.si/api: 200 (2026-11-08 wieczorem)",
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
    text: { reading: "CZYTNIK", note: "readCroatia: HTML aktu w Narodne novine (clanci/sluzbeni/{RRRR}_{MM}_{wydanie}_{nr}.html; adresy z mapy sitemap_1_{rok}_{wydanie}.xml), tekst ogłoszony — zmiany są osobnymi aktami NN, tekstu jednolitego urzędowego brak (zakon.hr: nieurzędowy)" },
    source: "https://narodne-novine.nn.hr/about_eli_hr.aspx",
    level: "BRAK-SZABLONU",
    checked: "200 (portal); szablonu aktu rejestr nie podaje"
  },
  { code: "CZ", name: "Czechy", family: "kontynentalne", portal: "https://e-sbirka.gov.cz", pillars: "1", consolidation: "wersja-z-data", api: { url: "https://api.e-sbirka.gov.cz", kind: "REST", auth: "klucz", probe: "bez nagłówka esel-api-access-key", checked: "401 NEPLATNY_API_KLIC (klucz: wniosek do datové schránky MV 6bnaawp, temat „e-Sbírka a e-Legislativa – registrace REST API”, ocena do 10 dni roboczych; nagłówek esel-api-access-key)" }, text: { reading: "CZYTNIK", note: "readCzech: publiczny cache portalu e-Sbírka (bez klucza): …/sbr-cache/dokumenty-sbirky/{staleUrl} i …/fragmenty; dane otwarte opendata.eselpoint.gov.cz (SPARQL, zbiory JSON-LD); REST API z kluczem MV" },
    source: "https://e-sbirka.gov.cz/pristup-pres-stale-url-a-eli", level: "BRAK-SZABLONU", checked: "200 (strona schematu ładowana skryptem; schemat do odczytania ręcznie)" },
  { code: "SK", name: "Słowacja", family: "kontynentalne", portal: "https://www.slov-lex.sk", pillars: "1", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "readSlovakia: statyczna wersja Slov-Lex bez JavaScriptu, static.slov-lex.sk/static/SK/ZZ/{rok}/{nr}/ = historia wersji z datami obowiązywania i nowelami, {RRRRMMDD}.html = tekst skonsolidowany obowiązujący od tego dnia; date wybiera wersję (np. 40/1964 Občiansky zákonník: 69 wersji)" },
    source: REGISTER("slovakia"), level: "BRAK-SZABLONU", checked: "rejestr nie podaje szablonu" },
  { code: "HU", name: "Węgry", family: "kontynentalne", portal: "https://njt.hu/eli", pillars: "1", consolidation: "nieustalone", text: { reading: "BRAK-POŁĄCZENIA", note: "njt.hu: brak połączenia z sieci aplikacji. N-Lex (n-lex.europa.eu/n-lex/legis_hu/jogszabalytar_form) wyszukuje akty (tytuł, Magyar Közlöny) — działa z sieci aplikacji; dokumenty pod nlex.njt.hu/cgi_bin_teszt/njt_doc.exe?docid=… — z sieci aplikacji przekroczenie czasu, do sprawdzenia z sieci użytkownika" },
    source: "https://njt.hu/eli/urisemak", level: "BRAK-SZABLONU", checked: "brak odpowiedzi serwera (strona schematu)" },
  { code: "GR", name: "Grecja", family: "kontynentalne", portal: "https://www.et.gr", pillars: "1, 2, 3 (częściowo)", consolidation: "nieustalone", text: { reading: "PDF", note: "Εθνικό Τυπογραφείο: ΦΕΚ w PDF; search.et.gr (wyszukiwarka ΦΕΚ) odpowiada; nieurzędowe kodiko.gr — tylko do odnalezienia" },
    source: REGISTER("greece"), level: "BRAK-SZABLONU", checked: "rejestr nie podaje szablonu" },
  { code: "RO", name: "Rumunia", family: "kontynentalne", portal: "https://legislatie.just.ro", pillars: "1, 2", consolidation: "nieustalone", text: { reading: "BRAK-POŁĄCZENIA", note: "legislatie.just.ro (i jego SOAP), cdep.ro, data.gov.ro, ccr.ro: brak połączenia z sieci aplikacji (blokada adresów centrów danych). Alternatywy: N-Lex (n-lex.europa.eu/n-lex/legis_ro/rodb_form) — łącznik UE do legislatie.just.ro, 2026-11-08 przekroczenie czasu po stronie łącznika; e-monitor (monitoruloficial.ro): bezpłatne PDF Monitorul Oficial cz. I od 2000 r. (także republicări = teksty jednolite), przeglądarka wymaga sesji przeglądarki — do okna weryfikacji użytkownika; senat.ro odpowiada (projekty, nie teksty jednolite); nieurzędowe: legex.ro, codulcivil.ro (kodeks cywilny artykułami) — tylko do odnalezienia" },
    source: REGISTER("romania"), level: "BRAK-SZABLONU", checked: "rejestr nie podaje szablonu; portal: błąd protokołu" },
  { code: "LT", name: "Litwa", family: "kontynentalne", portal: "—", pillars: "1 (w trakcie)", consolidation: "nieustalone", text: { reading: "BLOKADA", note: "2026-11-08: N-Lex ma łącznik do Seimasu (n-lex.europa.eu/n-lex/legis_lt/seimas_form), wynik niejednoznaczny — do ponowienia; e-tar.lt i e-seimas.lrs.lt: 403 (Cloudflare); get.data.gov.lt (Spinta, zbiór TAR): 500 z sieci aplikacji; do sprawdzenia z sieci użytkownika" },
    source: REGISTER("lithuania"), level: "BRAK-SZABLONU", checked: "wdrożenie w toku" },
  { code: "NL", name: "Holandia", family: "kontynentalne", portal: "—", pillars: "1 (w trakcie)", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "readNetherlands: wetten.overheid.nl/{BWBR}/{data}/0" },
    source: REGISTER("netherlands"), level: "BRAK-SZABLONU", checked: "wdrożenie w toku" },
  { code: "SE", name: "Szwecja", family: "nordyckie", portal: "—", pillars: "1 (w trakcie)", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "readSweden: data.riksdagen.se/dokument/sfs-{rok}-{nr}.text (bez klucza), tekst ujednolicony Regeringskansliet z „Ändrad: t.o.m. SFS …”, rozdziały i paragrafy, akt zmieniający przy paragrafie" },
    source: REGISTER("sweden"), level: "BRAK-SZABLONU", checked: "wdrożenie w toku" },
  { code: "AL", name: "Albania", family: "kontynentalne", portal: "—", pillars: "nie podano", consolidation: "nieustalone", text: { reading: "JS", note: "2026-11-08: qbz.gov.al i parlament.al zwracają powłokę JavaScript; qbz.gov.al: także adresy ELI (…/eli/ligj/{rok}/{mm}/{dd}/{nr}) zwracają tylko powłokę strony" },
    source: REGISTER("albania"), level: "BRAK-SZABLONU", checked: "rejestr podaje tylko koordynatorów" },

  // Outside the EUR-Lex ELI register (EU members without an entry, Turkey, Ukraine, Moldova and
  // the Balkan states outside the EU): no ELI template, the official portal and what it gives.
  { code: "BG", name: "Bułgaria", family: "kontynentalne", portal: "https://dv.parliament.bg", pillars: "brak w rejestrze", consolidation: "nieustalone", text: { reading: "BRAK-POŁĄCZENIA", note: "Държавен вестник: dv.parliament.bg odpowiada (JSF, wyszukiwarka wydań); parliament.bg/bg/laws odpowiada; lex.bg 403. N-Lex (n-lex.europa.eu/n-lex/legis_bg/apis_form, baza APIS) wyszukuje akty — działa; dokumenty nlex.apis.bg/nlex/docview.aspx?id=… — z sieci aplikacji przekroczenie czasu, do sprawdzenia z sieci użytkownika" }, source: "https://dv.parliament.bg/DVWeb/index.faces", level: "BRAK-SZABLONU", checked: "200 (portal)" },
  { code: "EE", name: "Estonia", family: "kontynentalne", portal: "https://www.riigiteataja.ee", pillars: "brak w rejestrze", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "src/eli/readers.ts readEstonia: publiczne API Riigi Teataja bez klucza: wyszukiwarka /api/oigusakt_otsing/1/otsi?pealkiri= (wersje z kehtivus algus/lopp) → XML wersji /public-api/api/v1/akt/{globaalID}/blob-xml; wersja na dzień zdarzenia; strona portalu wymaga JavaScriptu" }, source: "https://www.riigiteataja.ee/", level: "BRAK-SZABLONU", checked: "200 (strona JavaScript)" },
  { code: "LV", name: "Łotwa", family: "kontynentalne", portal: "https://likumi.lv", pillars: "brak w rejestrze", consolidation: "wersja-z-data", text: { reading: "CZYTNIK", note: "readLatvia: likumi.lv/ta/id/{id}, akapity p.TV213 (N. pants albo numer artykułu Kodeksu cywilnego)" }, source: "https://likumi.lv/ta/id/225418", level: "BRAK-SZABLONU", checked: "200 text/html" },
  { code: "TR", name: "Turcja", family: "kontynentalne", portal: "https://www.mevzuat.gov.tr", pillars: "brak ELI", consolidation: "wersja-bez-mocy", text: { reading: "CZYTNIK", note: "readTurkey: HTML aktu z Mevzuat Bilgi Sistemi (…/anasayfa/MevzuatFihristDetayIframe?MevzuatTur={tür}&MevzuatNo={no}&MevzuatTertip={tertip}, np. 1/4721/5 = Türk Medeni Kanunu), tekst obowiązujący z adnotacjami (Değişik/Ek/Mülga: data i ustawa zmieniająca); PDF …/MevzuatMetin/{tür}.{tertip}.{no}.pdf jako zapas; urzędowy jest tekst w Resmî Gazete (resmigazete.gov.tr, HTML wydań)" }, source: "https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=1&MevzuatNo=4721&MevzuatTertip=5", level: "BRAK-SZABLONU", checked: "200 text/html (1,49 MB, 1036 artykułów)" },
  { code: "GE", name: "Gruzja", family: "kontynentalne", portal: "https://matsne.gov.ge", pillars: "brak ELI", consolidation: "wersja-z-data", text: { reading: "CZYTNIK", note: "readMatsne: Matsne (Legislative Herald of Georgia), …/ka/document/view/{id} (tekst urzędowy gruziński; /en/ = tłumaczenie), publikacje skonsolidowane z datami (?publication={n}); date wybiera publikację z tego dnia lub ostatnią wcześniejszą" }, source: "https://matsne.gov.ge/ka/document/view/31702", level: "BRAK-SZABLONU", checked: "200 text/html (Kodeks cywilny, 140 publikacji)" },
  { code: "AM", name: "Armenia", family: "kontynentalne", portal: "https://www.arlis.am", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "DO-ZBADANIA", note: "2026-11-08: DocumentView.aspx?docid={id} odpowiada, tekst ładowany osobno — ARLIS odpowiada — czytnik do zrobienia" }, source: "https://www.arlis.am/", level: "BRAK-SZABLONU", checked: "200 text/html" },
  { code: "AZ", name: "Azerbejdżan", family: "kontynentalne", portal: "https://e-qanun.az", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "JS", note: "e-qanun.az: powłoka aplikacji JavaScript" }, source: "https://e-qanun.az/", level: "BRAK-SZABLONU", checked: "200 (powłoka)" },
  { code: "GB", name: "Wielka Brytania", family: "common-law", portal: "https://www.legislation.gov.uk", pillars: "własne identyfikatory", consolidation: "wersja-z-data", api: { url: "https://www.legislation.gov.uk", kind: "REST", auth: "brak", probe: "https://www.legislation.gov.uk/ukpga/1979/54/section/14/data.xml", checked: "200 application/xml" }, text: { reading: "CZYTNIK", note: "readUnitedKingdom: legislation.gov.uk/{typ}/{rok}/{nr}/section/{n} (tekst zrewidowany; /section/{n}/{RRRR-MM-DD} = brzmienie na dzień), akt zmieniający z datą wejścia w życie z komentarzy F; Szkocja i Irlandia Północna mają odrębne prawo w części dziedzin (zakres terytorialny przy przepisie)" }, caseLaw: { reading: "CZYTNIK", source: "https://caselaw.nationalarchives.gov.uk", note: "readUkJudgment: Find Case Law (The National Archives), /{sąd}/{rok}/{nr}/data.xml, akapity [N], sygnatura neutralna, sąd i data; od 2001 r. (wybrane sądy), starsze: BAILII (nieurzędowe)" }, source: "https://www.legislation.gov.uk/developer", level: "BRAK-SZABLONU", checked: "200" },
  { code: "IE", name: "Irlandia", family: "common-law", portal: "https://www.irishstatutebook.ie", pillars: "ELI", consolidation: "osobny-akt", template: "https://www.irishstatutebook.ie/eli/{rok}/act/{nr}/{section/{n}/}enacted/en/html", text: { reading: "CZYTNIK", note: "readIreland: Irish Statute Book, tekst uchwalony (enacted); teksty zrewidowane Law Reform Commission (revisedacts.lawreform.ie) tylko dla części aktów; przy rozbieżności tekstów ustawy rozstrzyga tekst w języku narodowym — irlandzkim (Konstytucja, art. 25 ust. 4 pkt 6°, odczyt z irishstatutebook.ie 2026-11-09)" }, caseLaw: { reading: "CZYTNIK", source: "https://judgments.courts.ie", note: "judgments.courts.ie/judgments/{id}: strona orzeczenia (sąd, sędzia, sygnatura neutralna [RRRR] IEHC/IECA/IESC N, data wydania) i PDF wyroku; numeracja akapitów z tekstu orzeczenia (1., 1.2)" }, source: "https://www.irishstatutebook.ie/", level: "ADRES", checked: "200", build: (ref) => `https://www.irishstatutebook.ie/eli/${parts(ref.year, "act", ref.number, "enacted", ref.language ?? "en", ref.format ?? "html")}` },
  { code: "CY", name: "Cypr", family: "mieszane", portal: "https://www.cylaw.org", pillars: "brak ELI", consolidation: "nieustalone", familyNote: "System mieszany: prawo umów, deliktów i procedura oparte na prawie angielskim (np. ustawa o umowach, ΚΕΦ.149, art. 2: wykładnia według zasad prawa angielskiego — odczyt z CyLaw 2026-11-08), pozostałe dziedziny i rola precedensu — do ustalenia w źródłach (nie odczytano w sesji).", text: { reading: "CZYTNIK", note: "readCyprus: CyLaw (Παγκύπριος Δικηγορικός Σύλλογος), tekst jednolity nieurzędowy z historią zmian przy przepisie, …/nomoi/enop/non-ind/{id}/full.html (windows-1253); urzędowa jest Επίσημη Εφημερίδα" }, caseLaw: { reading: "CZYTNIK", source: "https://www.cylaw.org/apofaseis.html", note: "readCyprusJudgment: CyLaw, …/cgi-bin/open.pl?file=/{supreme|courtOfAppeal|apofaseis|administrative|areiospagos}/…htm (windows-1253), sąd z nagłówka; akapity ¶N nadaje czytnik (orzeczenie ich nie numeruje) — nieurzędowe, rola precedensu do ustalenia" }, source: "https://www.cylaw.org/", level: "BRAK-SZABLONU", checked: "200 text/html" },
  { code: "US", name: "Stany Zjednoczone", family: "common-law", portal: "https://www.govinfo.gov", pillars: "brak ELI", consolidation: "wersja-z-data", text: { reading: "CZYTNIK", note: "readUsCode: GovInfo (GPO) govinfo.gov/link/uscode/{tytuł}/{sekcja}, United States Code z notami zmian; prawo federalne; prawo stanowe (umowy, delikty, rodzina, większość prawa karnego) osobne dla każdego stanu — czytnik kodeksów stanowych, DC i terytoriów (us-states.ts: 41 z 56 jurysdykcji, pozostałe z powodem: LexisNexis, Cloudflare/antybot, aplikacja JS); eCFR (ecfr.gov/api) dla rozporządzeń" }, caseLaw: { reading: "CZYTNIK", source: "https://static.case.law", note: "readCapCase: Caselaw Access Project (Harvard), static.case.law/{reporter}/{tom}/cases/{strona}-{nn}.json, orzeczenia do 2020 r. (opinia większości, zdania odrębne); nowsze: CourtListener (API z kluczem)" }, source: "https://www.govinfo.gov/developers", level: "BRAK-SZABLONU", checked: "200" },
  { code: "UA", name: "Ukraina", family: "kontynentalne", portal: "https://zakon.rada.gov.ua", pillars: "brak ELI", consolidation: "wersja-z-data", text: { reading: "BRAK-POŁĄCZENIA", note: "2026-11-08: data.gov.ua nie ma zbioru ustaw Rady (tylko wykazy aktów lokalnych); zakon.rada.gov.ua, data.rada.gov.ua (…/laws/show/{nr}.txt) i reestr.minjust.gov.ua: połączenie zerwane z sieci aplikacji, www.rada.gov.ua odpowiada; do sprawdzenia z sieci użytkownika; nieurzędowe kodeksy.com.ua/{kodeks}/statja-{n}.htm (z odesłaniem do Rady) — tylko do odnalezienia artykułu" }, source: "https://zakon.rada.gov.ua/", level: "BRAK-SZABLONU", checked: "połączenie zerwane (zakon i data.rada.gov.ua, reestr.minjust.gov.ua); www.rada.gov.ua 200" },
  { code: "MD", name: "Mołdawia", family: "kontynentalne", portal: "https://www.legis.md", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "BLOKADA", note: "legis.md i parlament.md: 403 dla automatów; monitorul.gov.md (Monitorul Oficial) odpowiada — dziennik urzędowy, do zbadania odczyt aktu" }, source: "https://www.legis.md/", level: "BRAK-SZABLONU", checked: "403" },
  { code: "ME", name: "Czarnogóra", family: "kontynentalne", portal: "https://www.sluzbenilist.me", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "DO-ZBADANIA", note: "readParagraf: paragraf.me/propisi-crnegore/{nazwa}.html (nieurzędowy tekst jednolity, tylko do odnalezienia); sluzbenilist.me odpowiada (Službeni list CG); akty do odnalezienia w PIS" }, source: "https://www.sluzbenilist.me/", level: "BRAK-SZABLONU", checked: "200 (portal)" },
  { code: "MK", name: "Macedonia Północna", family: "kontynentalne", portal: "http://www.slvesnik.com.mk", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "BRAK-POŁĄCZENIA", note: "2026-11-08: slvesnik.com.mk nadal bez połączenia; pravda.gov.mk (Ministerstwo Sprawiedliwości) odpowiada — do zbadania; Службен весник: odrzucony przez proxy sieci aplikacji" }, source: "http://www.slvesnik.com.mk/", level: "BRAK-SZABLONU", checked: "proxy" },
  { code: "BA", name: "Bośnia i Hercegowina", family: "kontynentalne", portal: "http://www.sluzbenilist.ba", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "DO-ZBADANIA", note: "readParagraf: paragraf.ba (nieurzędowy, tylko do odnalezienia); Službeni list BiH: strona startowa odpowiada; prawo podzielone (BiH, FBiH, RS, Brčko)" }, source: "http://www.sluzbenilist.ba/", level: "BRAK-SZABLONU", checked: "200 (portal)" },
  { code: "XK", name: "Kosowo", family: "kontynentalne", portal: "https://gzk.rks-gov.net", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "readKosovo: Gazeta Zyrtare, tekst aktu ActDocumentDetail.aspx?ActID={id} (Neni N) i status ActDetail.aspx?ActID={id} (uchylenie „I shfuqizuar”, akty zmieniające z datą publikacji); tekst pierwotny, bez tekstu jednolitego" }, source: "https://gzk.rks-gov.net/ActDocumentDetail.aspx?ActID=18413", level: "BRAK-SZABLONU", checked: "200 text/html (Kodi Penal 06/L-074)" },
  { code: "RW", name: "Rwanda", family: "mieszane", portal: "https://rwandalii.org", pillars: "brak ELI", consolidation: "wersja-z-data", familyNote: "Rodzina prawa nieustalona w źródłach odczytanych w sesji (Konstytucja, strony RLRC, RwandaLII) — oznaczenie „mieszane” robocze. Języki urzędowe: kinyarwanda, angielski, francuski (Konstytucja, art. 8); przy rozbieżności rozstrzyga język, w którym ustawę uchwalono (Konstytucja, art. 96) — odczyt z RwandaLII 2026-11-09.", text: { reading: "CZYTNIK", note: "readRwandaLii: RwandaLII (Laws.Africa), /akn/rw/act/{typ}/{rok}/{nr}/eng@{data} (Akoma Ntoso, wersja z datą); akty bez tekstu na stronie (np. Konstytucja) — z source.pdf; urzędowy jest Official Gazette" }, caseLaw: { reading: "DO-ZBADANIA", source: "https://rwandalii.org/judgments/", note: "lista orzeczeń ładowana skryptem — czytnik do zrobienia" }, source: "https://rwandalii.org/", level: "BRAK-SZABLONU", checked: "200 text/html" },
  { code: "IS", name: "Islandia", family: "nordyckie", portal: "https://www.althingi.is/lagasafn/", pillars: "brak w rejestrze", consolidation: "wersja-z-data", text: { reading: "CZYTNIK", note: "readIceland: althingi.is/lagas blokuje automaty (403, Cloudflare); odczyt z lagasafn-xml (althingi-net, XML zbudowany z HTML Althingi, wydania {sesja}{litera}, np. 158a): raw.githubusercontent.com/althingi-net/lagasafn-xml/master/data/xml/{wydanie}/{rok}.{nr}.xml — kopia nieurzędowa, brzmienie do potwierdzenia w althingi.is; adres althingi.is/lagas/nuna/{RRRR}{NNN}.html też przyjmowany" }, source: "https://raw.githubusercontent.com/althingi-net/lagasafn-xml/master/data/xml/158a/1944.33.xml", level: "BRAK-SZABLONU", checked: "althingi.is 403; lagasafn-xml 200 (wydanie 158a)" },
  { code: "FO", name: "Wyspy Owcze", family: "nordyckie", portal: "https://www.logir.fo", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "readFaroe: Lógasavnið (Løgmansskrivstovan), strona aktu logir.fo/{rodzaj}/{nr}-fra-{DD-MM-RRRR}-… (§ N, Gildisstøða = status); prawo Løgting w sprawach przejętych, w pozostałych prawo duńskie (retsinformation.dk, często w osobnej wersji dla Wysp Owczych)" }, source: "https://www.logir.fo/", level: "BRAK-SZABLONU", checked: "200 text/html" },
  { code: "VA", name: "Watykan", family: "kontynentalne", portal: "https://www.vaticanstate.va, https://www.vatican.va", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "readCanonLaw: prawo kanoniczne jest pierwszym źródłem prawa Państwa Watykańskiego; Codex Iuris Canonici 1983, tekst łaciński autentyczny (vatican.va/archive/cod-iuris-canonici/latin/documents/cic_liber{I…VII}_la.html; księga VI w brzmieniu z 2021), odczyt dostępny przy każdym kraju; ustawy Państwa Watykańskiego: PDF z vaticanstate.va (Legge fondamentale 31.07.2026, Articolo N)" }, source: "https://www.vatican.va/archive/cod-iuris-canonici/cic_index_la.html", level: "BRAK-SZABLONU", checked: "200 text/html (CIC), 200 application/pdf (vaticanstate.va)" },
  { code: "LI", name: "Liechtenstein", family: "kontynentalne", portal: "https://www.gesetze.li", pillars: "brak w rejestrze", consolidation: "wersja-z-data", text: { reading: "PDF", note: "Lilex: tekst skonsolidowany w PDF z warstwą tekstową (…/konso/pdf/{LGBl-id}?version={n}; PGR 1926.004: 1035 stron), strona HTML aktu to powłoka" }, source: "https://www.gesetze.li/konso/1926.004", level: "BRAK-SZABLONU", checked: "200 application/pdf" },
  { code: "MC", name: "Monako", family: "kontynentalne", portal: "https://legimonaco.mc", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "CZYTNIK", note: "readMonaco: legimonaco.mc/code/{kod}/, section.art z ustawą zmieniającą i datą (aside.histo)" }, source: "https://legimonaco.mc/code/code-civil/", level: "BRAK-SZABLONU", checked: "200 text/html (835 tys. znaków tekstu)" },
  { code: "SM", name: "San Marino", family: "kontynentalne", portal: "https://www.consigliograndeegenerale.sm", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "DO-ZBADANIA", note: "Consiglio Grande e Generale: archiwum ustaw i dekretów (…/archivio-leggi-decreti-e-regolamenti.html), teksty jako dokumenty do pobrania" }, source: "https://www.consigliograndeegenerale.sm/on-line/home/archivio-leggi-decreti-e-regolamenti.html", level: "BRAK-SZABLONU", checked: "200 (portal)" },
  { code: "AD", name: "Andora", family: "kontynentalne", portal: "https://www.bopa.ad", pillars: "brak ELI", consolidation: "nieustalone", text: { reading: "JS", note: "2026-11-08: także strony Legislacio/Detall to powłoka; BOPA: aplikacja JavaScript" }, source: "https://www.bopa.ad/", level: "BRAK-SZABLONU", checked: "200 (strona JavaScript)" },
  {
    code: "MT",
    name: "Malta",
    family: "mieszane",
    portal: "https://legislation.mt/eli/",
    pillars: "1, 2, 3 (technicznie)",
    template: "https://legislation.mt/eli/{type}/{year}*/{natural identifier}/{lang}/{format}",
    consolidation: "osobny-akt",
    consolidatedVersion: "cap / sl = prawo skonsolidowane (bez roku); act / ln = publikacje",
    text: { reading: "PDF", note: "legislation.mt: PDF z warstwą tekstową przez ELI (cap/sl skonsolidowane; Civil Code cap/16: 615 stron); artykuły „74. …” także po nocie marginesowej" },
    familyNote: "System mieszany: prawo prywatne skodyfikowane w tradycji kontynentalnej (Civil Code, Cap. 16), prawo publiczne i proceduralne pod wpływem prawa angielskiego. Ustawy uchwala się po maltańsku i angielsku; przy rozbieżności rozstrzyga tekst maltański (Konstytucja, art. 74 — odczyt z legislation.mt 2026-11-08). Rolę orzecznictwa ustalaj w źródłach, nie zakładaj stare decisis.",
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
