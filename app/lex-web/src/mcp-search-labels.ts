// Polskie nazwy narzędzi i pól karty Wyszukiwanie. Serwery MCP (lex-mcp) mają nazwy
// techniczne i opisy pisane dla modelu; tu to, co widzi użytkownik.

export type McpToolLabel = {
  label: string;
  help: string;
  // Wyszukiwanie po słowie kluczowym albo fragmencie tekstu: na górze listy.
  fullText?: boolean;
  // Obsługa dostępu do źródła (sesja, weryfikacja), nie wyszukiwanie: na dole listy.
  maintenance?: boolean;
};

export const MCP_TOOL_LABELS: Record<string, McpToolLabel> = {
  isap_lookup: { label: "Znajdź akt prawny (tytuł lub ELI)", help: "Status obowiązywania aktu i jego aktualny tekst jednolity." },
  isap_tekst: { label: "Przepis lub fragment w treści aktu", help: "Cały artykuł albo miejsca, w których występuje szukany fragment tekstu jednolitego.", fullText: true },
  eurlex_lookup: { label: "Akt UE po numerze CELEX", help: "Tytuł, data i status obowiązywania aktu prawa UE." },
  eurlex_tsue: { label: "Wyroki TSUE", help: "Po sygnaturze, ECLI, CELEX albo słowie kluczowym w tytule wyroku.", fullText: true },
  saos_search: { label: "Orzeczenia sądów powszechnych, SN i KIO (agregator SAOS)", help: "Słowo kluczowe lub fragment treści, tezy albo uzasadnienia; albo kontrola sygnatury.", fullText: true },
  saos_cytator: { label: "Orzeczenia powołujące wskazaną sygnaturę", help: "Późniejsze orzeczenia, które przywołują dane orzeczenie." },
  cbosa_szukaj: { label: "Orzeczenia NSA i WSA", help: "Słowo kluczowe lub fragment tekstu orzeczenia; wynik to lista dokumentów do pobrania.", fullText: true },
  cbosa_sprawdz_sygnature: { label: "Sprawdź sygnaturę NSA/WSA", help: "Czy orzeczenie o tej sygnaturze jest w CBOSA." },
  cbosa_pobierz: { label: "Pobierz orzeczenie NSA/WSA", help: "Sentencja i uzasadnienie po identyfikatorze dokumentu z wyszukiwania." },
  sn_szukaj: { label: "Orzeczenia Sądu Najwyższego (fraza i filtry)", help: "Słowo kluczowe lub fragment treści orzeczenia i uzasadnienia; do tego sygnatura, izba, forma, data albo sędzia. Wynik to karty orzeczeń sn.pl.", fullText: true },
  sn_sesja_status: { label: "Dostęp do sn.pl: stan weryfikacji", help: "Czy aplikacja ma aktywną sesję po weryfikacji przeglądarki sn.pl (potrzebna, gdy sn.pl blokuje wyszukiwanie).", maintenance: true },
  sn_captcha_auto: { label: "Dostęp do sn.pl: przejdź weryfikację", help: "Otwiera weryfikację sn.pl; gdy wymaga Twojego działania, pojawi się okno przeglądarki.", maintenance: true },
  sn_sesja_ustaw: { label: "Dostęp do sn.pl: wklej sesję z przeglądarki (zaawansowane)", help: "Gdy weryfikacja automatyczna nie działa: nagłówek Cookie z przeglądarki po wejściu na sn.pl. Wartość nie jest zapisywana w dziennikach.", maintenance: true },
  sn_sprawdz_sygnature: { label: "Sprawdź sygnaturę SN", help: "Czy w bazie sn.pl jest orzeczenie o tej sygnaturze; źródłem jest karta orzeczenia." },
  sn_pobierz: { label: "Pobierz orzeczenie SN", help: "Treść orzeczenia z karty sn.pl (link karty albo jej numer)." },
  sp_sprawdz_sygnature: { label: "Sprawdź sygnaturę sądu powszechnego", help: "Portal Orzeczeń szuka po sygnaturze; ta sama sygnatura bywa w kilku sądach — wtedy podaj portal sądu (np. tychy.sr)." },
  sp_szukaj: { label: "Orzeczenia sądów powszechnych (fraza)", help: "Portal Orzeczeń szuka tylko po frazie albo sygnaturze; wynik to stałe linki do orzeczeń.", fullText: true },
  sp_pobierz: { label: "Pobierz orzeczenie sądu powszechnego", help: "Treść spod stałego linku Portalu Orzeczeń." },
  tk_sprawdz_sygnature: { label: "Sprawdź sygnaturę TK", help: "Karta sprawy IPO i OTK ZU (źródła urzędowe TK; bez SAOS)." },
  tk_pobierz: { label: "Pobierz orzeczenie TK", help: "Treść spod linku IPO albo OTK ZU, z kontrolą sygnatury." },
  etpcz_szukaj: { label: "Orzeczenia ETPCz (baza MS)", help: "Po numerze skargi (np. 43447/19) albo frazie; baza Ministerstwa Sprawiedliwości z polskimi tłumaczeniami — wybrane orzeczenia, pełny zbiór: HUDOC.", fullText: true },
  etpcz_pobierz: { label: "Pobierz orzeczenie ETPCz", help: "Treść spod stałego linku etpcz.ms.gov.pl." },
  kio_szukaj: { label: "Orzeczenia KIO i sądów zamówień", help: "Słowo kluczowe lub fragment treści (z odmianą), sygnatura albo zakres dat; wyszukiwarka Urzędu Zamówień Publicznych.", fullText: true },
  kio_sprawdz_sygnature: { label: "Sprawdź sygnaturę KIO", help: "Czy orzeczenie o tej sygnaturze jest w wyszukiwarce UZP (np. KIO 827/18)." },
  kio_kontrola_sadowa: { label: "Czy orzeczenie KIO zaskarżono do sądu", help: "Wyrok lub postanowienie sądu zamówień publicznych (SO, SA, SN) na skargę na orzeczenie KIO o tej sygnaturze i jak je rozstrzygnięto." },
  kio_pobierz: { label: "Pobierz orzeczenie KIO", help: "Metryka (rozstrzygnięcie, zamawiający, przepisy Pzp) i treść po identyfikatorze z wyszukiwania." },
  krs_lookup: { label: "Podmiot w KRS", help: "Odpis aktualny: czy podmiot istnieje i nie jest wykreślony." },
  krs_szukaj: { label: "Podmiot w KRS po NIP albo REGON", help: "Numer KRS z wykazu podatników VAT, potem odpis aktualny. Podmiot spoza wykazu VAT znajdziesz po numerze KRS." },
  krs_reprezentacja: { label: "Reprezentacja podmiotu w KRS", help: "Zarząd, sposób reprezentacji, prokurenci." },
  ceidg_szukaj_firmy: { label: "Przedsiębiorca w CEIDG po NIP", help: "Wpis przedsiębiorcy-osoby fizycznej: nazwa, właściciel, REGON, status (wymaga klucza CEIDG)." },
  wl_sprawdz_nip: { label: "Status VAT (biała lista)", help: "Status podatnika VAT i rachunki z wykazu na wskazany dzień." },
  wl_sprawdz_rachunek: { label: "Czy rachunek jest na białej liście", help: "Sprawdzenie rachunku kontrahenta na wskazany dzień." },
  nbp_kurs_waluty: { label: "Kurs waluty NBP", help: "Kurs średni (tabela A) oraz kupna i sprzedaży (tabela C, wybrane waluty) na wskazany dzień." },
  eureka_szukaj: { label: "Interpretacje i objaśnienia podatkowe", help: "Słowo kluczowe lub fragment tekstu interpretacji; każdy wynik z informacją o aktualności.", fullText: true },
  eureka_sprawdz_sygnature: { label: "Sprawdź sygnaturę interpretacji", help: "Czy interpretacja o dokładnie tej sygnaturze istnieje i jest aktualna." },
  eureka_pobierz: { label: "Pobierz interpretację", help: "Treść i status aktualności po identyfikatorze z wyszukiwania." },
  sudop_szukaj_pomocy: { label: "Pomoc publiczna dla NIP (SUDOP)", help: "Otrzymana pomoc publiczna i de minimis." },
  sudop_odbierz_wynik: { label: "Odbierz wynik z SUDOP", help: "Wynik wcześniejszego wyszukiwania pomocy publicznej." },
  uodo_szukaj: { label: "Decyzje Prezesa UODO", help: "Słowo kluczowe lub fragment tekstu decyzji; filtr prawomocności i dat ogłoszenia.", fullText: true },
  uodo_sprawdz_sygnature: { label: "Sprawdź sygnaturę decyzji UODO", help: "Czy decyzja o tej sygnaturze istnieje i jaka jest jej prawomocność." },
  uodo_pobierz: { label: "Pobierz decyzję UODO", help: "Pełna treść decyzji z informacją o prawomocności." }
};

export type McpFieldLabel = {
  label: string;
  help?: string;
  placeholder?: string;
  date?: boolean;
  options?: Record<string, string>;
};

const KEYWORD: McpFieldLabel = {
  label: "Słowo kluczowe lub fragment tekstu",
  placeholder: "np. zadośćuczynienie za krzywdę"
};

export const MCP_FIELD_LABELS: Record<string, McpFieldLabel> = {
  fraza: KEYWORD,
  tresc: { label: "Słowo kluczowe lub fragment treści orzeczenia", placeholder: "np. zadośćuczynienie za krzywdę" },
  forma: { label: "Forma orzeczenia" },
  dataWDniu: { label: "Data wydania", date: true },
  izba: { label: "Izba" },
  sklad: { label: "Skład" },
  sedzia: { label: "Sędzia (w składzie)" },
  przewodniczacy: { label: "Przewodniczący" },
  sprawozdawca: { label: "Sprawozdawca" },
  wspolsprawozdawca: { label: "Współsprawozdawca" },
  autorUzasadnienia: { label: "Autor uzasadnienia" },
  naStrone: { label: "Wyników na stronie", options: { "10": "10", "25": "25", "50": "50", "100": "100" } },
  cookie: { label: "Nagłówek Cookie z przeglądarki", help: "po wejściu na sn.pl i przejściu weryfikacji" },
  userAgent: { label: "Przeglądarka (User-Agent)", help: "opcjonalnie, ta sama co przy weryfikacji" },
  headless: { label: "Bez widocznego okna przeglądarki" },
  szukaj: { label: "Fragment tekstu w akcie", placeholder: "np. stan nietrzeźwości" },
  query: { label: "Tytuł aktu", placeholder: "np. Kodeks wykroczeń" },
  eli: { label: "Identyfikator ELI", placeholder: "np. DU/1964/93" },
  artykul: { label: "Artykuł", placeholder: "np. 178a albo 385^1" },
  offset: { label: "Od znaku (dalsza część tekstu)" },
  wersja: { label: "Wersja tekstu", options: { aktualna: "aktualna (tekst jednolity)", ogloszona: "ogłoszona (pierwotna)" } },
  celex: { label: "Numer CELEX", placeholder: "np. 32016R0679" },
  sygnatura: { label: "Sygnatura", placeholder: "np. II PK 291/09" },
  ecli: { label: "ECLI" },
  courtType: {
    label: "Rodzaj sądu",
    options: {
      COMMON: "sądy powszechne",
      SUPREME: "Sąd Najwyższy",
      CONSTITUTIONAL_TRIBUNAL: "Trybunał Konstytucyjny",
      NATIONAL_APPEAL_CHAMBER: "Krajowa Izba Odwoławcza",
      ADMINISTRATIVE: "sądy administracyjne (brak w SAOS, użyj CBOSA)"
    }
  },
  dataOd: { label: "Data od", date: true },
  dataDo: { label: "Data do", date: true },
  odDaty: { label: "Data od", date: true },
  doDaty: { label: "Data do", date: true },
  data: { label: "Na dzień", date: true },
  pageSize: { label: "Liczba wyników" },
  limit: { label: "Liczba wyników" },
  rozmiar: { label: "Liczba wyników" },
  strona: { label: "Strona wyników" },
  sad: { label: "Portal sądu", placeholder: "np. tychy.sr, katowice.so, katowice.sa", help: "pusty = wszystkie sądy (orzeczenia.ms.gov.pl)" },
  url_lub_id: { label: "Link do orzeczenia albo identyfikator", help: "z wyników wyszukiwania" },
  karta: { label: "Karta orzeczenia SN", placeholder: "https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=…" },
  url: { label: "Link do dokumentu" },
  numer_skargi: { label: "Numer skargi", placeholder: "np. 43447/19" },
  doc_id: { label: "Identyfikator dokumentu", help: "10 znaków, z wyników wyszukiwania NSA/WSA" },
  id: { label: "Identyfikator dokumentu", help: "z wyników wyszukiwania" },
  numerKrs: { label: "Numer KRS" },
  nip: { label: "NIP" },
  regon: { label: "REGON" },
  rachunek: { label: "Numer rachunku" },
  kodWaluty: { label: "Waluta", placeholder: "np. EUR" },
  kolejka_id: { label: "Numer zlecenia", help: "z odpowiedzi PENDING" },
  urn_lub_sygnatura: { label: "Sygnatura lub URN decyzji" },
  tylkoAktualne: { label: "Tylko aktualne" },
  rodzaj: {
    label: "Organ",
    options: { KIO: "Krajowa Izba Odwoławcza", SO: "sądy okręgowe (skargi na orzeczenia KIO)", SA: "sądy apelacyjne", SN: "Sąd Najwyższy", wszystkie: "wszystkie" }
  },
  kategoria: {
    label: "Rodzaj dokumentu",
    options: { "1": "interpretacja indywidualna", "3": "interpretacja ogólna", "11": "objaśnienia podatkowe" }
  },
  prawomocnosc: {
    label: "Prawomocność",
    options: {
      prawomocna: "prawomocna",
      nieprawomocna: "nieprawomocna",
      czesciowo: "częściowo prawomocna",
      uchylona: "uchylona"
    }
  }
};

// Nieznane pole: "dataOd" -> "Data od", "kolejka_id" -> "Kolejka id".
export function fieldLabel(name: string): McpFieldLabel {
  const known = MCP_FIELD_LABELS[name];
  if (known) return known;
  const words = name
    .replace(/_/g, " ")
    .replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ])/g, "$1 $2")
    .toLocaleLowerCase("pl");
  return { label: words.charAt(0).toLocaleUpperCase("pl") + words.slice(1) };
}

export function toolLabel(name: string, description?: string): McpToolLabel {
  return MCP_TOOL_LABELS[name] ?? { label: name, help: description ?? "" };
}

// Kolejność narzędzi w karcie Wyszukiwanie: najpierw szukanie po frazie (podstawowa
// forma), potem kontrola sygnatury, odczyty i pobieranie, na końcu obsługa dostępu.
function toolRank(name: string): number {
  const label = MCP_TOOL_LABELS[name];
  if (label?.fullText) return 0;
  if (label?.maintenance) return 4;
  if (/_sprawdz_|_lookup$|_szukaj/.test(name)) return 1;
  if (/_pobierz$|_odbierz_/.test(name)) return 3;
  return 2;
}

export function orderTools<T extends { name: string }>(tools: T[]): T[] {
  return tools
    .map((tool, index) => ({ tool, index }))
    .sort((a, b) => toolRank(a.tool.name) - toolRank(b.tool.name) || a.index - b.index)
    .map((item) => item.tool);
}

const PHRASE_FIELDS = new Set(["fraza", "tresc", "szukaj"]);

// Pola formularza: wymagane wskazanie (np. akt w ISAP), potem fraza, potem reszta.
export function orderFields<T>(fields: Array<[string, T]>, required: Set<string>): Array<[string, T]> {
  const rank = ([name]: [string, T]) => (required.has(name) && !PHRASE_FIELDS.has(name) ? 0 : PHRASE_FIELDS.has(name) ? 1 : 2);
  return fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => rank(a.field) - rank(b.field) || a.index - b.index)
    .map((item) => item.field);
}

/** Źródło z wyszukiwaniem po frazie (jego narzędzie z tą możliwością jest pierwsze). */
export function sourceHasPhraseSearch(sourceId: string): boolean {
  return Object.entries(MCP_TOOL_LABELS).some(([name, label]) => label.fullText && name.startsWith(`${sourceId}_`));
}
