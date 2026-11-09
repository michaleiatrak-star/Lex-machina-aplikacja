import { plainText, type NationalArticle } from "./readers.js";

/**
 * Law of the US states, the District of Columbia and the territories: each jurisdiction's own code on
 * its legislature's (or code reviser's) site. Federal law: readUsCode (govinfo.gov). State law governs
 * contracts, torts, family, property, most crime and procedure, so the state is named with the question.
 *
 * Every entry was checked from the app's network on 2026-11-09 (index of addresses: LII, law.cornell.edu
 * /states; each address then opened at the source itself). Only public pages and published downloads are
 * read: a code that the source serves only through its web application, or behind a bot check, is listed
 * with that status and no reader.
 */
export type UsJurisdictionKind = "stan" | "dystrykt" | "terytorium";

// HTML: the page carries the section text; PDF: the official PDF of the section or chapter; ZBIORCZE: the
// official bulk database file, read by byte ranges (us-ca-pubinfo.ts);
// APLIKACJA-JS: text only inside the site's web application; LEXIS: the state publishes its code through
// LexisNexis (terms of use, bot check); BLOKADA / BRAK-POŁĄCZENIA: refused or unreachable from the app.
export type UsReading = "HTML" | "PDF" | "ZBIORCZE" | "APLIKACJA-JS" | "LEXIS" | "BLOKADA" | "BRAK-POŁĄCZENIA" | "DO-ZBADANIA";

export type UsJurisdiction = {
  code: string;
  name: string;
  kind: UsJurisdictionKind;
  // The official code and where it is published.
  codeName: string;
  portal: string;
  reading: UsReading;
  // Hosts of the official pages read for this jurisdiction (HTML or PDF).
  hosts?: RegExp;
  // An address that answered with the text, and the unit asked of it (tests and the tool description).
  sample?: { url: string; unit: string };
  note: string;
  checked: string;
};

const hosts = (...names: string[]): RegExp => new RegExp(`^(?:${names.map((name) => name.replace(/\./gu, "\\.")).join("|")})$`, "u");

export const US_JURISDICTIONS: UsJurisdiction[] = [
  { code: "US-AL", name: "Alabama", kind: "stan", codeName: "Code of Alabama", portal: "https://alison.legislature.state.al.us/code-of-alabama", reading: "APLIKACJA-JS", note: "tekst tylko w aplikacji ALISON (nieudokumentowane API GraphQL) — bez czytnika; przepis podawany z adresu dla człowieka", checked: "200 (aplikacja JS)" },
  { code: "US-AK", name: "Alaska", kind: "stan", codeName: "Alaska Statutes", portal: "https://www.akleg.gov/basis/statutes.asp", reading: "HTML", hosts: hosts("www.akleg.gov", "akleg.gov"), sample: { url: "https://www.akleg.gov/basis/statutes.asp?media=print&secStart=11.41.100&secEnd=11.41.100", unit: "11.41.100" }, note: "Legislative Affairs Agency; wersja do druku/osadzenia (media=print&secStart=&secEnd=), którą strona sama udostępnia", checked: "200" },
  { code: "US-AZ", name: "Arizona", kind: "stan", codeName: "Arizona Revised Statutes", portal: "https://www.azleg.gov/arstitle/", reading: "HTML", hosts: hosts("www.azleg.gov", "azleg.gov"), sample: { url: "https://www.azleg.gov/ars/13/01105.htm", unit: "13-1105" }, note: "Arizona Legislature, /ars/{tytuł}/{sekcja 5 cyfr}.htm", checked: "200" },
  { code: "US-AR", name: "Arkansas", kind: "stan", codeName: "Arkansas Code", portal: "https://www.arkleg.state.ar.us/", reading: "LEXIS", note: "kodeks publikowany przez LexisNexis — bez czytnika; kopie Public.Resource.Org (law.resource.org, archive.org) z lat 2008–2013 — nieaktualne, tylko trop; Justia za Cloudflare", checked: "200 → advance.lexis.com" },
  { code: "US-CA", name: "Kalifornia", kind: "stan", codeName: "California Codes", portal: "https://leginfo.legislature.ca.gov/faces/codes.xhtml", reading: "ZBIORCZE", hosts: hosts("downloads.leginfo.legislature.ca.gov"), sample: { url: "https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip", unit: "PEN 187" }, note: "Legislative Counsel: baza pubinfo (pubinfo_{rok rozpoczęcia sesji}.zip, aktualizowana codziennie), czytana zakresami bajtów — spis i tabela przepisów (ok. 26 MB) raz na sesję, potem przepis; leginfo.legislature.ca.gov za Cloudflare (403) — bez obchodzenia; unit = skrót kodeksu i numer (PEN 187, CIV 1714)", checked: "206 (zakresy bajtów)" },
  { code: "US-CO", name: "Kolorado", kind: "stan", codeName: "Colorado Revised Statutes", portal: "https://content.leg.colorado.gov/agencies/office-legislative-legal-services/2026-crs-titles-download", reading: "HTML", hosts: hosts("olls.info"), sample: { url: "https://olls.info/crs/crs2026-title-18.htm", unit: "18-3-102" }, note: "Office of Legislative Legal Services: tytuł w jednym pliku HTML (olls.info/crs/crs{rok}-title-{NN}.htm) z adnotacjami; serwis przepisów leg.colorado.gov kieruje do LexisNexis", checked: "200" },
  { code: "US-CT", name: "Connecticut", kind: "stan", codeName: "Connecticut General Statutes", portal: "https://www.cga.ct.gov/current/pub/titles.htm", reading: "HTML", hosts: hosts("www.cga.ct.gov", "cga.ct.gov"), sample: { url: "https://www.cga.ct.gov/current/pub/chap_952.htm", unit: "Sec. 53a-54a" }, note: "Connecticut General Assembly, rozdział w jednym pliku (chap_{NNN}.htm); serwer nie wysyła certyfikatu pośredniego — dołączany publiczny (us-tls.ts)", checked: "200 (z certyfikatem pośrednim)" },
  { code: "US-DE", name: "Delaware", kind: "stan", codeName: "Delaware Code", portal: "https://delcode.delaware.gov/", reading: "HTML", hosts: hosts("delcode.delaware.gov"), sample: { url: "https://delcode.delaware.gov/title11/c005/sc02/index.html", unit: "§ 636" }, note: "Delaware Code Online, podrozdział w jednym pliku", checked: "200" },
  { code: "US-DC", name: "Dystrykt Kolumbii", kind: "dystrykt", codeName: "D.C. Official Code", portal: "https://code.dccouncil.gov/", reading: "HTML", hosts: hosts("code.dccouncil.gov"), sample: { url: "https://code.dccouncil.gov/us/dc/council/code/sections/22-2101", unit: "22-2101" }, note: "Council of the District of Columbia, code.dccouncil.gov/us/dc/council/code/sections/{nr}", checked: "200" },
  { code: "US-FL", name: "Floryda", kind: "stan", codeName: "Florida Statutes", portal: "https://www.leg.state.fl.us/statutes/", reading: "HTML", hosts: hosts("www.leg.state.fl.us", "leg.state.fl.us"), sample: { url: "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0700-0799/0782/Sections/0782.04.html", unit: "782.04" }, note: "Online Sunshine (Florida Legislature)", checked: "200" },
  { code: "US-GA", name: "Georgia", kind: "stan", codeName: "Official Code of Georgia Annotated", portal: "https://www.legis.ga.gov/", reading: "LEXIS", note: "O.C.G.A. publikowany przez LexisNexis — bez czytnika; jedyna inna kopia: tomy OCGA z lat 2004–2024 bez suplementów (Public.Resource.Org, archive.org/details/gov.ga.ocga.2024) — nieaktualne, tylko trop; Justia za Cloudflare", checked: "200 → advance.lexis.com" },
  { code: "US-HI", name: "Hawaje", kind: "stan", codeName: "Hawaii Revised Statutes", portal: "https://data.capitol.hawaii.gov/hrscurrent/", reading: "HTML", hosts: hosts("data.capitol.hawaii.gov"), sample: { url: "https://data.capitol.hawaii.gov/hrscurrent/Vol14_Ch0701-0853/HRS0707/HRS_0707-0701.htm", unit: "707-701" }, note: "Hawaii State Legislature: host danych data.capitol.hawaii.gov (www.capitol.hawaii.gov za Cloudflare 403)", checked: "200" },
  { code: "US-ID", name: "Idaho", kind: "stan", codeName: "Idaho Statutes", portal: "https://legislature.idaho.gov/statutesrules/idstat/", reading: "HTML", hosts: hosts("legislature.idaho.gov"), sample: { url: "https://legislature.idaho.gov/statutesrules/idstat/Title18/T18CH40/SECT18-4001", unit: "18-4001" }, note: "Idaho Legislature", checked: "200" },
  { code: "US-IL", name: "Illinois", kind: "stan", codeName: "Illinois Compiled Statutes", portal: "https://www.ilga.gov/Legislation/ILCS/Chapters", reading: "HTML", hosts: hosts("www.ilga.gov", "ilga.gov"), sample: { url: "https://www.ilga.gov/legislation/ILCS/details?ActID=1876&ChapterID=53&ChapAct=720+ILCS+5%2F&SeqStart=11200000&SeqEnd=12400000", unit: "9-1" }, note: "Illinois General Assembly, artykuł ustawy (details?ActID=&SeqStart=&SeqEnd=); serwer bez certyfikatu pośredniego — dołączany publiczny (us-tls.ts)", checked: "200 (z certyfikatem pośrednim)" },
  { code: "US-IN", name: "Indiana", kind: "stan", codeName: "Indiana Code", portal: "https://iga.in.gov/laws/", reading: "APLIKACJA-JS", note: "tekst tylko w aplikacji iga.in.gov; oficjalne API Indiana General Assembly (api.iga.in.gov) wymaga klucza — czytnik po uzyskaniu klucza", checked: "200 (aplikacja JS)" },
  { code: "US-IA", name: "Iowa", kind: "stan", codeName: "Iowa Code", portal: "https://www.legis.iowa.gov/law/statutory", reading: "PDF", hosts: hosts("www.legis.iowa.gov", "legis.iowa.gov"), sample: { url: "https://www.legis.iowa.gov/docs/code/707.2.pdf", unit: "707.2" }, note: "Iowa Legislature, sekcja w PDF (/docs/code/{nr}.pdf)", checked: "200 application/pdf" },
  { code: "US-KS", name: "Kansas", kind: "stan", codeName: "Kansas Statutes Annotated", portal: "https://www.kslegislature.gov/li/", reading: "HTML", hosts: hosts("www.kslegislature.gov", "kslegislature.gov"), sample: { url: "https://www.kslegislature.gov/li/b2025_26/statute/021_000_0000_chapter/021_054_0000_article/021_054_0002_section/021_054_0002_k/", unit: "21-5402" }, note: "Kansas Legislature, ścieżka z kadencją (b2025_26)", checked: "200" },
  { code: "US-KY", name: "Kentucky", kind: "stan", codeName: "Kentucky Revised Statutes", portal: "https://apps.legislature.ky.gov/law/statutes/", reading: "PDF", hosts: hosts("apps.legislature.ky.gov"), sample: { url: "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=19903", unit: "524.010" }, note: "Kentucky General Assembly, sekcja w PDF (statute.aspx?id=)", checked: "200 application/pdf" },
  { code: "US-LA", name: "Luizjana", kind: "stan", codeName: "Louisiana Revised Statutes", portal: "https://www.legis.la.gov/legis/LawSearch.aspx", reading: "HTML", hosts: hosts("www.legis.la.gov", "legis.la.gov"), sample: { url: "https://www.legis.la.gov/legis/Law.aspx?d=78337", unit: "14:2" }, note: "Louisiana State Legislature, Law.aspx?d={id} (id z wyszukiwarki); połączenie bywa zrywane — ponowić", checked: "200 (raz timeout)" },
  { code: "US-ME", name: "Maine", kind: "stan", codeName: "Maine Revised Statutes", portal: "https://www.mainelegislature.org/legis/statutes/", reading: "HTML", hosts: hosts("www.mainelegislature.org", "mainelegislature.org", "legislature.maine.gov"), sample: { url: "https://www.mainelegislature.org/legis/statutes/17-A/title17-Asec201.html", unit: "§201" }, note: "Maine Revisor of Statutes", checked: "200" },
  { code: "US-MD", name: "Maryland", kind: "stan", codeName: "Annotated Code of Maryland", portal: "https://mgaleg.maryland.gov/mgawebsite/Laws/Statutes", reading: "HTML", hosts: hosts("mgaleg.maryland.gov"), sample: { url: "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcr&section=2-201", unit: "2-201" }, note: "Maryland General Assembly, StatuteText?article={artykuł}&section={nr}", checked: "200" },
  { code: "US-MA", name: "Massachusetts", kind: "stan", codeName: "General Laws of Massachusetts", portal: "https://malegislature.gov/Laws/GeneralLaws", reading: "HTML", hosts: hosts("malegislature.gov", "www.malegislature.gov"), sample: { url: "https://malegislature.gov/Laws/GeneralLaws/PartIV/TitleI/Chapter265/Section1", unit: "Section 1" }, note: "General Court of Massachusetts", checked: "200" },
  { code: "US-MI", name: "Michigan", kind: "stan", codeName: "Michigan Compiled Laws", portal: "https://www.legislature.mi.gov/", reading: "HTML", hosts: hosts("www.legislature.mi.gov", "legislature.mi.gov"), sample: { url: "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-750-316", unit: "750.316" }, note: "Michigan Legislature, Laws/MCL?objectName=mcl-{nr}", checked: "200" },
  { code: "US-MN", name: "Minnesota", kind: "stan", codeName: "Minnesota Statutes", portal: "https://www.revisor.mn.gov/statutes/", reading: "HTML", hosts: hosts("www.revisor.mn.gov", "revisor.mn.gov"), sample: { url: "https://www.revisor.mn.gov/statutes/cite/609.185", unit: "609.185" }, note: "Office of the Revisor of Statutes; /statutes/{rok}/cite/{nr} = wersja z danego roku", checked: "200" },
  { code: "US-MS", name: "Missisipi", kind: "stan", codeName: "Mississippi Code", portal: "https://www.legislature.ms.gov/", reading: "LEXIS", note: "kodeks publikowany przez LexisNexis — bez czytnika; skany tomów z lat 2013–2021 na archive.org — nieaktualne, tylko trop; Justia za Cloudflare", checked: "200 → advance.lexis.com" },
  { code: "US-MO", name: "Missouri", kind: "stan", codeName: "Missouri Revised Statutes", portal: "https://revisor.mo.gov/", reading: "HTML", hosts: hosts("revisor.mo.gov"), sample: { url: "https://revisor.mo.gov/main/OneSection.aspx?section=565.020", unit: "565.020" }, note: "Missouri Revisor of Statutes", checked: "200" },
  { code: "US-MT", name: "Montana", kind: "stan", codeName: "Montana Code Annotated", portal: "https://mca.legmt.gov/bills/mca/index.html", reading: "HTML", hosts: hosts("mca.legmt.gov", "leg.mt.gov"), sample: { url: "https://mca.legmt.gov/bills/mca/title_0450/chapter_0050/part_0010/section_0020/0450-0050-0010-0020.html", unit: "45-5-102" }, note: "Montana Legislature", checked: "200" },
  { code: "US-NE", name: "Nebraska", kind: "stan", codeName: "Nebraska Revised Statutes", portal: "https://nebraskalegislature.gov/laws/laws.php", reading: "HTML", hosts: hosts("nebraskalegislature.gov"), sample: { url: "https://nebraskalegislature.gov/laws/statutes.php?statute=28-303", unit: "28-303" }, note: "Nebraska Legislature", checked: "200" },
  { code: "US-NV", name: "Nevada", kind: "stan", codeName: "Nevada Revised Statutes", portal: "https://www.leg.state.nv.us/NRS/", reading: "HTML", hosts: hosts("www.leg.state.nv.us", "leg.state.nv.us"), sample: { url: "https://www.leg.state.nv.us/NRS/NRS-200.html", unit: "200.030" }, note: "Nevada Legislature, rozdział w jednym pliku (NRS-{NNN}.html)", checked: "200" },
  { code: "US-NH", name: "New Hampshire", kind: "stan", codeName: "New Hampshire Revised Statutes Annotated", portal: "https://gc.nh.gov/rsa/html/indexes/default.html", reading: "BRAK-POŁĄCZENIA", hosts: hosts("gc.nh.gov", "www.gencourt.state.nh.us"), note: "gc.nh.gov zrywał połączenie z sieci testowej (gencourt.state.nh.us przekierowuje tam) — czytnik ogólny włączony, odczyt niezweryfikowany", checked: "połączenie zamknięte (2 próby)" },
  { code: "US-NJ", name: "New Jersey", kind: "stan", codeName: "New Jersey Statutes", portal: "https://lis.njleg.state.nj.us/nxt/gateway.dll?f=templates&fn=default.htm&vid=Publish:10.1048/Enu", reading: "APLIKACJA-JS", note: "tekst w przeglądarce Folio NXT (ramki, spis treści skryptem) — czytnik przez odnośniki Folio do zrobienia", checked: "200 (aplikacja)" },
  { code: "US-NM", name: "Nowy Meksyk", kind: "stan", codeName: "New Mexico Statutes Annotated", portal: "https://nmonesource.com/nmos/nmsa/en/nav_date.do", reading: "BLOKADA", note: "NMOneSource za ochroną antybotową (DataDome) — bez obchodzenia", checked: "200 (DataDome)" },
  { code: "US-NY", name: "Nowy Jork", kind: "stan", codeName: "Consolidated Laws of New York", portal: "https://www.nysenate.gov/legislation/laws/CONSOLIDATED", reading: "BLOKADA", note: "nysenate.gov za wyzwaniem Cloudflare (403); oficjalne API Open Legislation (legislation.nysenate.gov/api/3/laws) wymaga bezpłatnego klucza (rejestracja na legislation.nysenate.gov) — czytnik po uzyskaniu klucza", checked: "403 Cloudflare; API 401 bez klucza" },
  { code: "US-NC", name: "Karolina Północna", kind: "stan", codeName: "North Carolina General Statutes", portal: "https://www.ncleg.gov/Laws/GeneralStatutesTOC", reading: "HTML", hosts: hosts("www.ncleg.gov", "ncleg.gov"), sample: { url: "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_14/GS_14-17.html", unit: "14-17" }, note: "North Carolina General Assembly", checked: "200" },
  { code: "US-ND", name: "Dakota Północna", kind: "stan", codeName: "North Dakota Century Code", portal: "https://ndlegis.gov/general-information/north-dakota-century-code/index.html", reading: "PDF", hosts: hosts("ndlegis.gov", "www.ndlegis.gov", "www.legis.nd.gov"), sample: { url: "https://ndlegis.gov/cencode/t12-1c16.pdf", unit: "12.1-16-01" }, note: "North Dakota Legislative Branch, rozdział w PDF (/cencode/t{tytuł}c{rozdział}.pdf)", checked: "200 application/pdf" },
  { code: "US-OH", name: "Ohio", kind: "stan", codeName: "Ohio Revised Code", portal: "https://codes.ohio.gov/ohio-revised-code", reading: "HTML", hosts: hosts("codes.ohio.gov"), sample: { url: "https://codes.ohio.gov/ohio-revised-code/section-2903.01", unit: "2903.01" }, note: "Legislative Service Commission", checked: "200" },
  { code: "US-OK", name: "Oklahoma", kind: "stan", codeName: "Oklahoma Statutes", portal: "https://www.oklegislature.gov/osStatuesTitle.html", reading: "PDF", hosts: hosts("www.oklegislature.gov", "oklegislature.gov"), sample: { url: "https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os21.pdf", unit: "§21-701.7" }, note: "Oklahoma Legislature, cały tytuł w PDF (OK_Statutes/CompleteTitles/os{tytuł}.pdf); OSCN za Cloudflare Turnstile", checked: "200 application/pdf" },
  { code: "US-OR", name: "Oregon", kind: "stan", codeName: "Oregon Revised Statutes", portal: "https://www.oregonlegislature.gov/bills_laws/Pages/ORS.aspx", reading: "HTML", hosts: hosts("www.oregonlegislature.gov", "oregonlegislature.gov"), sample: { url: "https://www.oregonlegislature.gov/bills_laws/ors/ors163.html", unit: "163.115" }, note: "Oregon Legislature, rozdział w jednym pliku (ors{NNN}.html, windows-1252)", checked: "200" },
  { code: "US-PA", name: "Pensylwania", kind: "stan", codeName: "Pennsylvania Consolidated Statutes", portal: "https://www.palegis.us/statutes/consolidated", reading: "HTML", hosts: hosts("www.palegis.us", "palegis.us"), sample: { url: "https://www.palegis.us/statutes/consolidated/view-statute?txtType=HTM&ttl=18&div=00.&chpt=025.&sctn=002.&subsctn=000.&iFrame=true", unit: "§ 2502" }, note: "Pennsylvania General Assembly, view-statute z iFrame=true (tekst ramki strony)", checked: "200" },
  { code: "US-RI", name: "Rhode Island", kind: "stan", codeName: "General Laws of Rhode Island", portal: "https://webserver.rilegislature.gov/Statutes/", reading: "HTML", hosts: hosts("webserver.rilegislature.gov"), sample: { url: "https://webserver.rilegislature.gov/Statutes/TITLE11/11-23/11-23-1.htm", unit: "11-23-1" }, note: "Rhode Island General Assembly", checked: "200" },
  { code: "US-SC", name: "Karolina Południowa", kind: "stan", codeName: "South Carolina Code of Laws", portal: "https://www.scstatehouse.gov/code/statmast.php", reading: "HTML", hosts: hosts("www.scstatehouse.gov", "scstatehouse.gov"), sample: { url: "https://www.scstatehouse.gov/code/statmast.php?title=16&chapter=3", unit: "16-3-10" }, note: "South Carolina Legislature, rozdział w HTML (statmast.php?title=&chapter=) lub PDF (/code/pdfs/)", checked: "200" },
  { code: "US-SD", name: "Dakota Południowa", kind: "stan", codeName: "South Dakota Codified Laws", portal: "https://sdlegislature.gov/Statutes", reading: "APLIKACJA-JS", note: "tekst tylko w aplikacji sdlegislature.gov — bez czytnika", checked: "200 (aplikacja JS)" },
  { code: "US-TN", name: "Tennessee", kind: "stan", codeName: "Tennessee Code Annotated", portal: "https://www.capitol.tn.gov/", reading: "LEXIS", note: "kodeks publikowany przez LexisNexis — bez czytnika; Tennessee Code Annotated (Bulk Access) z 2020 r. na archive.org (gov.tn.tca) — nieaktualne, tylko trop; Justia za Cloudflare", checked: "200 → advance.lexis.com" },
  { code: "US-TX", name: "Teksas", kind: "stan", codeName: "Texas Statutes", portal: "https://statutes.capitol.texas.gov/", reading: "HTML", hosts: hosts("tcss.legis.texas.gov"), sample: { url: "https://tcss.legis.texas.gov/resources/PE/htm/PE.19.htm", unit: "19.02" }, note: "Texas Legislative Council: pliki kodeksów na serwerze tcss.legis.texas.gov/resources/{kod}/htm/{kod}.{rozdział}.htm (statutes.capitol.texas.gov to aplikacja)", checked: "200" },
  { code: "US-UT", name: "Utah", kind: "stan", codeName: "Utah Code", portal: "https://le.utah.gov/xcode/code.html", reading: "HTML", hosts: hosts("le.utah.gov"), sample: { url: "https://le.utah.gov/xcode/Title76/Chapter5/76-5-S203.html", unit: "76-5-203" }, note: "Utah Legislature; strona przepisu wskazuje plik z datą wersji (C76-5-S203_RRRRMMDD….html), czytany automatycznie", checked: "200" },
  { code: "US-VT", name: "Vermont", kind: "stan", codeName: "Vermont Statutes", portal: "https://legislature.vermont.gov/statutes/", reading: "HTML", hosts: hosts("legislature.vermont.gov"), sample: { url: "https://legislature.vermont.gov/statutes/section/13/053/02301", unit: "§ 2301" }, note: "Vermont General Assembly", checked: "200" },
  { code: "US-VA", name: "Wirginia", kind: "stan", codeName: "Code of Virginia", portal: "https://law.lis.virginia.gov/vacode/", reading: "HTML", hosts: hosts("law.lis.virginia.gov"), sample: { url: "https://law.lis.virginia.gov/vacode/title18.2/chapter4/section18.2-32/", unit: "18.2-32" }, note: "Virginia Legislative Information System", checked: "200" },
  { code: "US-WA", name: "Waszyngton", kind: "stan", codeName: "Revised Code of Washington", portal: "https://app.leg.wa.gov/rcw/", reading: "HTML", hosts: hosts("app.leg.wa.gov", "apps.leg.wa.gov"), sample: { url: "https://app.leg.wa.gov/RCW/default.aspx?cite=9A.32.030", unit: "9A.32.030" }, note: "Washington State Legislature", checked: "200" },
  { code: "US-WV", name: "Wirginia Zachodnia", kind: "stan", codeName: "West Virginia Code", portal: "https://code.wvlegislature.gov/", reading: "HTML", hosts: hosts("code.wvlegislature.gov"), sample: { url: "https://code.wvlegislature.gov/61-2-1/", unit: "61-2-1" }, note: "West Virginia Legislature", checked: "200" },
  { code: "US-WI", name: "Wisconsin", kind: "stan", codeName: "Wisconsin Statutes", portal: "https://docs.legis.wisconsin.gov/statutes/", reading: "BRAK-POŁĄCZENIA", hosts: hosts("docs.legis.wisconsin.gov"), note: "docs.legis.wisconsin.gov zrywał połączenie z sieci testowej (reset, 2 próby) — czytnik ogólny włączony, odczyt niezweryfikowany", checked: "reset połączenia" },
  { code: "US-WY", name: "Wyoming", kind: "stan", codeName: "Wyoming Statutes", portal: "https://wyoleg.gov/LsoWeb/Statutes", reading: "PDF", hosts: hosts("wyoleg.gov", "www.wyoleg.gov"), sample: { url: "https://wyoleg.gov/statutes/compress/title06.pdf", unit: "6-2-101" }, note: "Wyoming Legislature, tytuł w PDF (statutes/compress/title{NN}.pdf); serwis przepisów kieruje też do LexisNexis", checked: "200 application/pdf" },
  { code: "US-PR", name: "Portoryko", kind: "terytorium", codeName: "Leyes de Puerto Rico", portal: "https://www.bvirtualogp.pr.gov/", reading: "DO-ZBADANIA", note: "urzędowy zbiór (Biblioteca Virtual OGP) nie odpowiedział pod adresem z indeksu — do ustalenia; tekst hiszpański", checked: "404" },
  { code: "US-GU", name: "Guam", kind: "terytorium", codeName: "Guam Code Annotated", portal: "https://col.guamcourts.gov/guam-code-annotated/guam-code-annotated", reading: "PDF", hosts: hosts("col.guamcourts.gov"), sample: { url: "https://col.guamcourts.gov/sites/default/files/09gc019_Q.pdf", unit: "§ 19.20" }, note: "Compiler of Laws (Judiciary of Guam), rozdziały w PDF", checked: "200 application/pdf" },
  { code: "US-VI", name: "Wyspy Dziewicze Stanów Zjednoczonych", kind: "terytorium", codeName: "Virgin Islands Code", portal: "https://legvi.org/", reading: "LEXIS", note: "kodeks publikowany przez LexisNexis — bez czytnika", checked: "—" },
  { code: "US-AS", name: "Samoa Amerykańskie", kind: "terytorium", codeName: "American Samoa Code Annotated", portal: "https://asbar.org/legal-resources/code-annotated/", reading: "HTML", hosts: hosts("asbar.org"), sample: { url: "https://asbar.org/code-annotated/10101-citation/", unit: "1.0101" }, note: "American Samoa Bar Association (publikacja kodeksu, nie wydanie urzędowe), stan wg strony", checked: "200" },
  { code: "US-MP", name: "Mariany Północne", kind: "terytorium", codeName: "Commonwealth Code", portal: "https://cnmilaw.gov/commonwealth-code", reading: "PDF", hosts: hosts("cnmilaw.gov"), sample: { url: "https://cnmilaw.gov/docs/cmc-amended/T00/5321-purpose-and-objectives-20261001-081136.pdf", unit: "§ 5321" }, note: "CNMI Law Revision Commission, sekcje w PDF (/docs/cmc-amended/…pdf)", checked: "200" }
];

export function usJurisdictionOfHost(host: string): UsJurisdiction | undefined {
  const name = host.toLowerCase();
  return US_JURISDICTIONS.find((item) => item.hosts?.test(name));
}

export function usJurisdiction(code: string): UsJurisdiction | undefined {
  const wanted = code.trim().toUpperCase().replace(/^US-?/u, "");
  return US_JURISDICTIONS.find((item) => item.code === `US-${wanted}`);
}

// Lines of the page without navigation, forms and page chrome; a lone "§" / "Sec." joins the next line.
function pageLines(html: string): string[] {
  const body = html
    .replace(/<(script|style|nav|header|footer|noscript|select|button)\b[\s\S]*?<\/\1>/giu, " ")
    .replace(/<\/(?:td|th|section|article|title)>|<(?:div|p|h\d|table|section)\b/giu, (tag) => (tag.startsWith("</") ? `${tag}\n` : `\n${tag}`));
  const raw = plainText(body).split("\n").map((line) => line.replace(/\s+/gu, " ").trim())
    // Remains of a tag cut by ">" inside an attribute value.
    .filter((line) => line && !/^"?\s*(?:[\w-]+="[^"]*"\s*)+\/?>$|^"\s*[\w-]+="/u.test(line));
  const lines: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index]!;
    if (/^(?:§|Sec\.|Section)$/u.test(line) && index + 1 < raw.length) {
      lines.push(`${line} ${raw[index + 1]}`);
      index += 1;
    } else lines.push(line);
  }
  return lines;
}

const DASHES = "[-‐‑‒–—]";

// Editorial apparatus under the section, never the section itself.
const NOT_TEXT = /^\W*(?:Commentary|Notes?|History|Annotations?|Cross[- ]references?|Case Notes|Editor's Note|Source)\b/iu;

// "§ 13-1105" / "Sec. 11.41.100" / "RCW 9A.32.030" → the bare number, as the source prints it.
export function usSectionToken(unit: string): string {
  return unit
    .trim()
    .replace(/^(?:§+|Sec(?:tion)?\.?|Section|[A-Z]{2,5}\.?)\s*/u, "")
    .replace(/\.$/u, "")
    .trim();
}

function tokenPattern(token: string): string {
  return token
    .split("")
    .map((char) => (/[-‐‑‒–—]/u.test(char) ? DASHES : char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
    .join("");
}

// The shape of a section number of the same kind ("13-1105" → digits, dash, digits).
function shapePattern(token: string): string {
  return token
    .replace(/\d+[A-Za-z]{0,2}/gu, "\u0000")
    .split("")
    .map((char) => (char === "\u0000" ? "\\d+[A-Za-z]{0,2}" : /[-‐‑‒–—]/u.test(char) ? DASHES : char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
    .join("");
}

// A heading: a short prefix (§, Sec., RCW, the code's abbreviation), the number, then "." or ":" or a
// space and the catchline (a capital, a bracket, a dash).
const heading = (number: string, prefix = "(?:[A-Za-z.§ ]{0,14}?)"): RegExp =>
  new RegExp(`^(${prefix})\\s*(${number})(?![\\d.]*\\d)(?:\\s+\\2)?\\s*(?:[.:]|$|\\s+[A-Z(\\[${DASHES.slice(1, -1)}])`, "u");

/**
 * The section asked for, cut from a state code page: the page may hold one section or a whole chapter.
 * Of the places where the number opens a line, the one followed by the longest text up to the next heading
 * of the same shape is the section (the table of contents repeats the numbers with no text after them).
 */
export function readUsStateSection(html: string, unit: string | undefined): NationalArticle[] {
  return cutUsSection(pageLines(html), unit);
}

/** The same cut over lines of text (a state's PDF: a section, a chapter or a whole title). */
export function cutUsSection(source: string[], unit: string | undefined): NationalArticle[] {
  const lines = source.map((line) => line.replace(/\s+/gu, " ").trim()).filter(Boolean);
  if (!unit) return [];
  const token = usSectionToken(unit);
  if (!token) return [];
  const own = heading(tokenPattern(token));
  // A bare number alone on a line is a table cell (history, dates), not a heading: it needs a prefix.
  const ownHeading = (line: string): RegExpExecArray | null => {
    const match = own.exec(line);
    if (!match || NOT_TEXT.test(line.slice(match[0].length - 1))) return null;
    return match[1]!.trim() || line.length > match[0].length || /[.:]$/u.test(match[0]) ? match : null;
  };
  // A heading with its catchline on the same line ("18-3-102. Murder in the first degree.") outranks a bare
  // mention of the number (annotations: "C.R.S. 18-3-102"): when the page has such headings, only they open.
  const strong = (line: string): boolean => {
    const match = ownHeading(line);
    return !!match && /^\s*[.:—–-]?\s*["“A-Z]/u.test(line.slice(match[0].length - 1).replace(/^[.:]/u, ""));
  };
  const strongOnly = lines.some(strong);
  const opens = (line: string): boolean => (strongOnly ? strong(line) : !!ownHeading(line));
  let best: { start: number; end: number; size: number } | undefined;
  for (let start = 0; start < lines.length; start += 1) {
    const match = opens(lines[start]!) ? ownHeading(lines[start]!) : null;
    if (!match) continue;
    // The next section: same prefix as this heading ("§", "Sec."), same shape of number.
    const prefix = match[1]!.trim();
    // A number with separators ("163.115") is a heading without its prefix too ("ORS 163.115" cites,
    // "163.118 Manslaughter" opens); a bare one ("201") only with it ("§201", not the point "1.").
    const quoted = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const next = heading(shapePattern(token), !prefix ? "" : /\D/u.test(token) ? `(?:${quoted} ?)?` : `${quoted} ?`);
    let end = start + 1;
    // It ends at the next section, or where the same heading opens again (a copy in a side panel).
    while (end < lines.length && end - start < 400 && !(next.test(lines[end]!) && !ownHeading(lines[end]!) && !own.test(lines[end]!)) && !opens(lines[end]!)) end += 1;
    // Measured in prose: menus, history tables and search help are short lines.
    const size = lines.slice(start, end).reduce((sum, line) => sum + (line.length >= 40 ? line.length : 0), 0);
    if (!best || size > best.size) best = { start, end, size };
  }
  if (!best || best.size < 40) return [];
  // Page title and breadcrumbs repeat the number before the text: start at the last heading inside the
  // block that still has the text after it, when only page chrome (no prose) stands before it.
  for (let index = best.end - 1; index > best.start; index -= 1) {
    const before = lines.slice(best.start + 1, index).reduce((sum, line) => sum + (line.length >= 40 ? line.length : 0), 0);
    if (opens(lines[index]!) && before < 200 && lines.slice(index, best.end).join("\n").length >= 200) {
      best = { ...best, start: index };
      break;
    }
  }
  const block = lines.slice(best.start, best.end);
  return [{ unit: token, heading: block[0]!.slice(0, 300), text: block.join("\n").slice(0, 20_000), amendments: [] }];
}
