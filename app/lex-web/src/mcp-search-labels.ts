// Polskie nazwy narzędzi i pól karty Wyszukiwanie. Serwery MCP (lex-mcp) mają nazwy
// techniczne i opisy pisane dla modelu; tu to, co widzi użytkownik.

export type McpToolLabel = {
  label: string;
  help: string;
  // Wyszukiwanie po słowie kluczowym albo fragmencie tekstu: na górze listy.
  fullText?: boolean;
};

export const MCP_TOOL_LABELS: Record<string, McpToolLabel> = {
  isap_lookup: { label: "Znajdź akt prawny (tytuł lub ELI)", help: "Status obowiązywania aktu i jego aktualny tekst jednolity." },
  isap_tekst: { label: "Przepis lub fragment w treści aktu", help: "Cały artykuł albo miejsca, w których występuje szukany fragment tekstu jednolitego.", fullText: true },
  eurlex_lookup: { label: "Akt UE po numerze CELEX", help: "Tytuł, data i status obowiązywania aktu prawa UE." },
  eurlex_tsue: { label: "Wyroki TSUE", help: "Po sygnaturze, ECLI, CELEX albo słowie kluczowym w tytule wyroku.", fullText: true },
  saos_search: { label: "Orzeczenia sądów powszechnych, SN, TK i KIO", help: "Słowo kluczowe lub fragment treści, tezy albo uzasadnienia; albo kontrola sygnatury.", fullText: true },
  saos_cytator: { label: "Orzeczenia powołujące wskazaną sygnaturę", help: "Późniejsze orzeczenia, które przywołują dane orzeczenie." },
  cbosa_szukaj: { label: "Orzeczenia NSA i WSA", help: "Słowo kluczowe lub fragment tekstu orzeczenia; wynik to lista dokumentów do pobrania.", fullText: true },
  cbosa_sprawdz_sygnature: { label: "Sprawdź sygnaturę NSA/WSA", help: "Czy orzeczenie o tej sygnaturze jest w CBOSA." },
  cbosa_pobierz: { label: "Pobierz orzeczenie NSA/WSA", help: "Sentencja i uzasadnienie po identyfikatorze dokumentu z wyszukiwania." },
  krs_lookup: { label: "Podmiot w KRS", help: "Odpis aktualny: czy podmiot istnieje i nie jest wykreślony." },
  krs_reprezentacja: { label: "Reprezentacja podmiotu w KRS", help: "Zarząd, sposób reprezentacji, prokurenci." },
  wl_sprawdz_nip: { label: "Status VAT (biała lista)", help: "Status podatnika VAT i rachunki z wykazu na wskazany dzień." },
  wl_sprawdz_rachunek: { label: "Czy rachunek jest na białej liście", help: "Sprawdzenie rachunku kontrahenta na wskazany dzień." },
  nbp_kurs_waluty: { label: "Kurs waluty NBP", help: "Średni kurs z tabeli A na wskazany dzień." },
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
  doc_id: { label: "Identyfikator dokumentu", help: "10 znaków, z wyników wyszukiwania NSA/WSA" },
  id: { label: "Identyfikator dokumentu", help: "z wyników wyszukiwania" },
  numerKrs: { label: "Numer KRS" },
  nip: { label: "NIP" },
  rachunek: { label: "Numer rachunku" },
  kodWaluty: { label: "Waluta", placeholder: "np. EUR" },
  kolejka_id: { label: "Numer zlecenia", help: "z odpowiedzi PENDING" },
  urn_lub_sygnatura: { label: "Sygnatura lub URN decyzji" },
  tylkoAktualne: { label: "Tylko aktualne" },
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
