// Scenarios for the check of cited legal texts against the question and the answer's claim.
// Sources are in the shape the federation runtime returns them: JSON with the document text
// nested as a string (escaped line breaks and quotes), sometimes with \u escapes, sometimes a
// hit list. Expected labels are what a careful lawyer reading the full text would conclude.

export type SemanticScenario = {
  id: string;
  what: string;
  question: string;
  answer: string;
  sources: string[];
  signature: string;
  expected: { topic: "MATCH" | "PARTIAL" | "NO_MATCH"; claim: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" };
  // The passage a reader needs to decide; it must reach the judge.
  decisive: string;
  // What the lexical check (topic words of the question) should report for this signature.
  lexical: "flag" | "pass";
  // Text that must not reach the judge for this document (another hit of a list).
  excluded?: string;
  // Gray zone: another claim label a careful reader could also give.
  alsoAcceptable?: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED";
};

const wrap = (source: string, result: Record<string, unknown>): string => JSON.stringify({ source, status: "OK", result });
// A Python MCP server (json.dumps, ensure_ascii=True): Polish letters as \u escapes.
const asciiJson = (value: unknown): string => JSON.stringify(value).replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);

// Long reasoning made of distinct procedural sentences (no topic words of the questions).
function reasoning(seed: string, sentences: number): string {
  const parts = [
    "Sąd rozpoznał sprawę na posiedzeniu niejawnym w trybie uproszczonym.",
    "Skarga została wniesiona w terminie i spełnia wymogi formalne.",
    "Organ w odpowiedzi na skargę wniósł o jej oddalenie, podtrzymując dotychczasowe stanowisko.",
    "Zgodnie z utrwalonym orzecznictwem kontrola sądowa obejmuje zgodność z prawem materialnym i procesowym.",
    "Sąd nie jest związany granicami skargi, zarzutami ani powołaną podstawą prawną.",
    "Uzasadnienie decyzji powinno zawierać wskazanie faktów uznanych za udowodnione.",
    "Doręczenie pisma nastąpiło za pośrednictwem operatora pocztowego.",
    "Pełnomocnictwo zostało złożone wraz z pierwszym pismem w sprawie.",
    "Akta administracyjne przekazano sądowi w wymaganym terminie.",
    "W toku postępowania nie przeprowadzono dowodu z przesłuchania stron."
  ];
  return Array.from({ length: sentences }, (_, index) => `${parts[index % parts.length]} [${seed}-${index}]`).join("\n");
}

export const SCENARIOS: SemanticScenario[] = [
  {
    id: "S1",
    what: "0.1.27: prawdziwa sygnatura WSA, treść o AI dopisana z pytania",
    question: "Znajdź polski wyrok innego sądu niż SN dotyczący użycia AI i jego halucynacji przez prawnika",
    answer: "WSA w Poznaniu, wyrok z 16 września 2026 r., sygn. II SAB/Po 175/26.\n\nSąd uznał, że pisma pełnomocnika przygotowano z pomocą AI, a powołane orzeczenia były halucynacjami.",
    sources: [wrap("cbosa", { sygnatura: "II SAB/Po 175/26", sad: "Wojewódzki Sąd Administracyjny w Poznaniu", data: "2026-09-16", hasla: "Informacja publiczna; Bezczynność organu", tresc: "Sentencja\nWojewódzki Sąd Administracyjny w Poznaniu po rozpoznaniu sprawy ze skargi na bezczynność Burmistrza Miasta i Gminy w przedmiocie udostępnienia informacji publicznej zobowiązuje organ do rozpoznania wniosku z dnia 3 marca 2026 r. w terminie 14 dni.\nUzasadnienie\n" + reasoning("s1", 12) })],
    signature: "II SAB/Po 175/26",
    expected: { topic: "NO_MATCH", claim: "UNSUPPORTED" },
    decisive: "bezczynność Burmistrza Miasta i Gminy w przedmiocie udostępnienia informacji publicznej",
    lexical: "flag"
  },
  {
    id: "S2",
    what: "uchwała SN, trafna parafraza",
    question: "Na SN wyszukaj orzeczenia dotyczącego neosędziów i skutków ich udziału w składzie",
    answer: "Uchwała SN I KZP 3/24 (siedmiu sędziów): udział neosędziego w składzie nie oznacza automatycznie nieważności wyroku; trzeba zbadać okoliczności konkretnej sprawy.",
    sources: [wrap("sn", { sygnatura: "I KZP 3/24", forma: "uchwała składu siedmiu sędziów", tresc: "Teza\nUdział w składzie sądu osoby powołanej na urząd sędziego na wniosek Krajowej Rady Sądownictwa ukształtowanej w trybie ustawy z 8 grudnia 2017 r. (tzw. neosędziów) nie powoduje automatycznie nieważności orzeczenia; konieczna jest ocena okoliczności konkretnej sprawy, w tym przebiegu procedury nominacyjnej.\nUzasadnienie\n" + reasoning("s2", 10) })],
    signature: "I KZP 3/24",
    expected: { topic: "MATCH", claim: "SUPPORTED" },
    decisive: "nie powoduje automatycznie nieważności orzeczenia",
    lexical: "pass"
  },
  {
    id: "S3",
    what: "uchwała SN, teza odwrócona (słowa się zgadzają)",
    question: "Na SN wyszukaj orzeczenia dotyczącego neosędziów i skutków ich udziału w składzie",
    answer: "Uchwała SN I KZP 3/24 (siedmiu sędziów): każde orzeczenie wydane z udziałem neosędziów jest nieważne z mocy prawa.",
    sources: [wrap("sn", { sygnatura: "I KZP 3/24", forma: "uchwała składu siedmiu sędziów", tresc: "Teza\nUdział w składzie sądu osoby powołanej na urząd sędziego na wniosek Krajowej Rady Sądownictwa ukształtowanej w trybie ustawy z 8 grudnia 2017 r. (tzw. neosędziów) nie powoduje automatycznie nieważności orzeczenia; konieczna jest ocena okoliczności konkretnej sprawy, w tym przebiegu procedury nominacyjnej.\nUzasadnienie\n" + reasoning("s3", 10) })],
    signature: "I KZP 3/24",
    expected: { topic: "MATCH", claim: "UNSUPPORTED" },
    decisive: "nie powoduje automatycznie nieważności orzeczenia",
    lexical: "pass"
  },
  {
    id: "S4",
    what: "długi wyrok WSA, właściwy fragment głęboko w uzasadnieniu (ensure_ascii)",
    question: "Szukam wyroku sądu administracyjnego o pełnomocniku, który powołał orzeczenia wygenerowane przez sztuczną inteligencję",
    answer: "WSA w Warszawie, sygn. III SA/Wa 812/26: sąd wskazał, że pełnomocnik powołał nieistniejące wyroki NSA wygenerowane przez narzędzie sztucznej inteligencji, i zawiadomił o tym samorząd zawodowy.",
    sources: [asciiJson({ source: "cbosa", status: "OK", result: { sygnatura: "III SA/Wa 812/26", sad: "Wojewódzki Sąd Administracyjny w Warszawie", hasla: "Podatek od towarów i usług", tresc: "Sentencja\nOddala skargę.\nUzasadnienie\n" + reasoning("s4a", 120) + "\nNa marginesie Sąd zauważa, że pełnomocnik skarżącej powołał w skardze cztery wyroki Naczelnego Sądu Administracyjnego, których nie ma w Centralnej Bazie Orzeczeń Sądów Administracyjnych. Pełnomocnik przyznał na rozprawie, że treść skargi przygotował przy użyciu narzędzia sztucznej inteligencji i nie zweryfikował sygnatur. Sąd postanowił zawiadomić o tym właściwą okręgową izbę radców prawnych.\n" + reasoning("s4b", 80) } })],
    signature: "III SA/Wa 812/26",
    expected: { topic: "MATCH", claim: "SUPPORTED" },
    decisive: "przygotował przy użyciu narzędzia sztucznej inteligencji i nie zweryfikował sygnatur",
    // "Nieistniejące" vs "nie ma w CBOSA": absence from one base is not proof of nonexistence.
    alsoAcceptable: "PARTIAL",
    // A correct paraphrase ("wygenerowane" vs "przygotował przy użyciu"): the lexical check alone
    // flags it, so it only decides where the semantic verdict is missing.
    lexical: "flag"
  },
  {
    id: "S5",
    what: "teza z zarzutów strony, którą sąd odrzucił",
    question: "Czy jest orzeczenie NSA, że doręczenie przez awizo nie jest skuteczne, gdy adresat przebywał za granicą?",
    answer: "NSA w wyroku II FSK 1450/25 przyjął, że doręczenie zastępcze (awizo) jest bezskuteczne, gdy adresat przebywał za granicą.",
    sources: [wrap("cbosa", { sygnatura: "II FSK 1450/25", sad: "Naczelny Sąd Administracyjny", tresc: "Sentencja\nOddala skargę kasacyjną.\nUzasadnienie\n" + reasoning("s5a", 60) + "\nW skardze kasacyjnej strona podniosła, że doręczenie zastępcze (awizo) jest bezskuteczne, gdy adresat przebywał za granicą i nie mógł odebrać przesyłki.\n" + reasoning("s5b", 30) + "\nZarzut ten nie jest zasadny. Pobyt adresata za granicą nie wyłącza skuteczności doręczenia zastępczego dokonanego pod adresem wskazanym przez stronę; strona ma obowiązek zapewnić odbiór korespondencji albo wskazać pełnomocnika do doręczeń.\n" + reasoning("s5c", 40) })],
    signature: "II FSK 1450/25",
    expected: { topic: "MATCH", claim: "UNSUPPORTED" },
    decisive: "Pobyt adresata za granicą nie wyłącza skuteczności doręczenia zastępczego",
    lexical: "pass"
  },
  {
    id: "S6",
    what: "interpretacja podatkowa: stanowisko nieprawidłowe podane jako potwierdzenie",
    question: "Czy przysługuje pełne odliczenie VAT od samochodu osobowego używanego też prywatnie?",
    answer: "Interpretacja 0114-KDIP1-3.4012.455.2025.2.KP potwierdziła prawo do pełnego odliczenia VAT od samochodu używanego także prywatnie.",
    sources: [wrap("eureka", { sygnatura: "0114-KDIP1-3.4012.455.2025.2.KP", typ: "interpretacja indywidualna", tresc: "INTERPRETACJA INDYWIDUALNA\nStanowisko, które przedstawił Pan we wniosku dotyczącym podatku od towarów i usług, jest nieprawidłowe.\nUzasadnienie\nSamochód jest wykorzystywany zarówno do działalności gospodarczej, jak i do celów prywatnych, a Wnioskodawca nie prowadzi ewidencji przebiegu pojazdu. W takim przypadku przysługuje prawo do odliczenia 50% kwoty podatku naliczonego, zgodnie z art. 86a ust. 1 ustawy o VAT." })],
    signature: "0114-KDIP1-3.4012.455.2025.2.KP",
    expected: { topic: "MATCH", claim: "UNSUPPORTED" },
    decisive: "przysługuje prawo do odliczenia 50% kwoty podatku naliczonego",
    lexical: "pass"
  },
  {
    id: "S7",
    what: "interpretacja o innej uldze niż pytana (IP Box zamiast B+R)",
    question: "Szukam interpretacji o uldze badawczo-rozwojowej dla programisty na B2B",
    answer: "Interpretacja 0111-KDIB1-3.4010.77.2025.1.JKU dotyczy ulgi badawczo-rozwojowej programisty i potwierdza możliwość jej zastosowania.",
    sources: [wrap("eureka", { sygnatura: "0111-KDIB1-3.4010.77.2025.1.JKU", tresc: "INTERPRETACJA INDYWIDUALNA\nStanowisko Wnioskodawcy w zakresie stosowania preferencyjnej stawki 5% do dochodu z kwalifikowanego prawa własności intelektualnej (IP Box) z tytułu tworzenia oprogramowania jest prawidłowe.\nPrzedmiotem interpretacji nie jest ulga badawczo-rozwojowa." })],
    signature: "0111-KDIB1-3.4010.77.2025.1.JKU",
    expected: { topic: "NO_MATCH", claim: "UNSUPPORTED" },
    decisive: "Przedmiotem interpretacji nie jest ulga badawczo-rozwojowa",
    lexical: "pass"
  },
  {
    id: "S8",
    what: "wyrok TK, trafny opis",
    question: "Jakie orzeczenie TK dotyczy stosowania przez sądy art. 6 EKPC wobec sędziów powołanych po 2018 r.?",
    answer: "Wyrok TK K 7/21 uznał, że art. 6 ust. 1 EKPC w zakresie, w jakim pozwala sądom oceniać zgodność z prawem powołania sędziów, jest niezgodny z Konstytucją.",
    sources: [wrap("tk", { sygnatura: "K 7/21", tresc: "Wyrok z dnia 10 marca 2022 r.\nTrybunał Konstytucyjny orzeka: Art. 6 ust. 1 zdanie pierwsze Konwencji o ochronie praw człowieka i podstawowych wolności w zakresie, w jakim pozwala krajowym lub międzynarodowym sądom na dokonywanie oceny zgodności z Konstytucją i z ustawami przepisów dotyczących ustroju sądownictwa, właściwości sądów oraz ustawy określającej ustrój, zakres działania, sposób pracy i sposób wyboru członków Krajowej Rady Sądownictwa, jest niezgodny z art. 179 w związku z art. 187 Konstytucji." })],
    signature: "K 7/21",
    expected: { topic: "MATCH", claim: "PARTIAL" },
    decisive: "w zakresie, w jakim pozwala krajowym lub międzynarodowym sądom na dokonywanie oceny zgodności z Konstytucją",
    // The answer narrows "przepisy o ustroju sądownictwa i KRS" to "powołanie sędziów".
    alsoAcceptable: "SUPPORTED",
    lexical: "pass"
  },
  {
    id: "S9",
    what: "przepis z ELI: błędna zasada odpowiedzialności",
    question: "Na jakiej zasadzie odpowiada sprawca szkody z art. 415 KC?",
    answer: "Art. 415 KC przewiduje odpowiedzialność na zasadzie ryzyka, niezależnie od winy sprawcy.",
    sources: [JSON.stringify({ claim: "art. 415 KC", status: "VERIFIED", evidence: "Kto z winy swej wyrządził drugiemu szkodę, obowiązany jest do jej naprawienia." })],
    signature: "Art. 415 KC",
    expected: { topic: "MATCH", claim: "UNSUPPORTED" },
    decisive: "Kto z winy swej wyrządził drugiemu szkodę",
    lexical: "pass"
  },
  {
    id: "S10",
    what: "KIO: inny problem niż pytany",
    question: "Szukam orzeczenia KIO o rażąco niskiej cenie w przetargu na roboty budowlane",
    answer: "Wyrok KIO 2210/25 dotyczy rażąco niskiej ceny i nakazał odrzucenie oferty.",
    sources: [wrap("kio", { sygnatura: "KIO 2210/25", tresc: "Izba uwzględnia odwołanie i nakazuje zamawiającemu wykluczenie wykonawcy, który w wyniku zamierzonego działania wprowadził zamawiającego w błąd przy przedstawianiu informacji o spełnianiu warunków udziału w postępowaniu (art. 109 ust. 1 pkt 8 Pzp). Zarzut dotyczący ceny oferty nie był przedmiotem odwołania." })],
    signature: "KIO 2210/25",
    expected: { topic: "NO_MATCH", claim: "UNSUPPORTED" },
    decisive: "Zarzut dotyczący ceny oferty nie był przedmiotem odwołania",
    lexical: "pass"
  },
  {
    id: "S11",
    what: "lista trafień CBOSA: opis zgodny z hasłami i tytułem",
    question: "Szukam wyroków WSA o bezczynności w udostępnieniu informacji publicznej",
    answer: "Wyrok WSA w Gdańsku II SAB/Gd 40/26 dotyczy bezczynności organu w udostępnieniu informacji publicznej.",
    sources: [wrap("cbosa", { wyniki: [
      { sygnatura: "II SA/Gd 12/26", hasla: "Planowanie przestrzenne", tytul: "Skarga na uchwałę w przedmiocie miejscowego planu" },
      { sygnatura: "II SAB/Gd 40/26", naglowek: "II SAB/Gd 40/26 - Wyrok WSA w Gdańsku z 2026-05-12", hasla: "Informacja publiczna; Bezczynność organu", tytul: "Skarga na bezczynność Wójta Gminy w przedmiocie udostępnienia informacji publicznej" },
      { sygnatura: "III SA/Gd 7/26", hasla: "Podatek od nieruchomości", tytul: "Skarga na decyzję SKO" }
    ] })],
    signature: "II SAB/Gd 40/26",
    expected: { topic: "MATCH", claim: "SUPPORTED" },
    decisive: "Skarga na bezczynność Wójta Gminy w przedmiocie udostępnienia informacji publicznej",
    lexical: "pass",
    excluded: "II SA/Gd 12/26"
  },
  {
    id: "S12",
    what: "AI użyła strona, nie pełnomocnik (kryterium pytania częściowo)",
    question: "Znajdź wyrok, w którym sąd ocenił użycie AI przez profesjonalnego pełnomocnika",
    answer: "Sąd Okręgowy w Krakowie, II Ca 990/26: sąd skrytykował profesjonalnego pełnomocnika za pismo przygotowane przez AI z nieistniejącymi orzeczeniami.",
    sources: [wrap("sp", { sygnatura: "II Ca 990/26", sad: "Sąd Okręgowy w Krakowie", tresc: "Uzasadnienie\nPowódka, działająca bez profesjonalnego pełnomocnika, wniosła apelację, w której powołała orzeczenia Sądu Najwyższego, których nie udało się odnaleźć. Sąd zwraca uwagę, że pismo nosi cechy tekstu wygenerowanego przez narzędzie sztucznej inteligencji (AI), co nie zwalnia strony z odpowiedzialności za treść pisma." })],
    signature: "II Ca 990/26",
    expected: { topic: "PARTIAL", claim: "UNSUPPORTED" },
    decisive: "działająca bez profesjonalnego pełnomocnika",
    lexical: "pass"
  },
  {
    id: "S13",
    what: "pytanie o NSA, dokument WSA (opis uczciwy)",
    question: "Szukam wyroku NSA o zwrocie kosztów postępowania przy umorzeniu sprawy",
    answer: "Znalazłem wyrok WSA (nie NSA): I SA/Kr 301/25 — sąd zasądził zwrot kosztów postępowania mimo umorzenia, bo organ uwzględnił skargę w trybie autokontroli.",
    sources: [wrap("cbosa", { sygnatura: "I SA/Kr 301/25", sad: "Wojewódzki Sąd Administracyjny w Krakowie", tresc: "Postanowienie\nUmarza postępowanie sądowe i zasądza od organu na rzecz skarżącego zwrot kosztów postępowania.\nUzasadnienie\nOrgan w trybie art. 54 § 3 p.p.s.a. uwzględnił skargę w całości, co czyni postępowanie bezprzedmiotowym. Skoro organ uwzględnił skargę, skarżącemu przysługuje zwrot kosztów (art. 201 § 1 p.p.s.a.)." })],
    signature: "I SA/Kr 301/25",
    expected: { topic: "PARTIAL", claim: "SUPPORTED" },
    decisive: "Skoro organ uwzględnił skargę, skarżącemu przysługuje zwrot kosztów",
    lexical: "pass"
  },
  {
    id: "S14",
    what: "przepis z ELI: poprawna parafraza",
    question: "Ile wynosi ogólny termin przedawnienia roszczeń majątkowych?",
    answer: "Art. 118 KC: co do zasady roszczenia przedawniają się po sześciu latach, a świadczenia okresowe i roszczenia związane z działalnością gospodarczą po trzech; koniec terminu przypada na ostatni dzień roku kalendarzowego, chyba że termin jest krótszy niż dwa lata.",
    sources: [JSON.stringify({ claim: "art. 118 KC", status: "VERIFIED", evidence: "Jeżeli przepis szczególny nie stanowi inaczej, termin przedawnienia wynosi sześć lat, a dla roszczeń o świadczenia okresowe oraz roszczeń związanych z prowadzeniem działalności gospodarczej - trzy lata. Jednakże koniec terminu przedawnienia przypada na ostatni dzień roku kalendarzowego, chyba że termin przedawnienia jest krótszy niż dwa lata." })],
    signature: "Art. 118 KC",
    expected: { topic: "MATCH", claim: "SUPPORTED" },
    decisive: "termin przedawnienia wynosi sześć lat",
    lexical: "pass"
  },
  {
    id: "S15",
    what: "zdanie odrębne podane jako stanowisko SN",
    question: "Czy SN uznał, że zachowek można rozłożyć na raty bez zgody uprawnionego?",
    answer: "SN w wyroku II CSKP 512/24 uznał, że sąd może rozłożyć zachowek na raty nawet bez zgody uprawnionego.",
    sources: [wrap("sn", { sygnatura: "II CSKP 512/24", tresc: "Wyrok\nOddala skargę kasacyjną.\nUzasadnienie\n" + reasoning("s15a", 70) + "\nSąd Najwyższy w tym składzie nie podziela poglądu, że art. 320 k.p.c. pozwala na rozłożenie na raty świadczenia z tytułu zachowku w każdej sytuacji; przepis ten ma zastosowanie wyjątkowo i wymaga wykazania szczególnie uzasadnionego wypadku, którego w sprawie nie wykazano.\n" + reasoning("s15b", 40) + "\nZdanie odrębne\nSędzia SN nie zgadza się z większością: jego zdaniem sąd może rozłożyć zachowek na raty także bez zgody uprawnionego, gdy natychmiastowa zapłata prowadziłaby do sprzedaży mieszkania zobowiązanego." })],
    signature: "II CSKP 512/24",
    expected: { topic: "MATCH", claim: "UNSUPPORTED" },
    decisive: "nie podziela poglądu, że art. 320 k.p.c. pozwala na rozłożenie na raty",
    lexical: "pass"
  },
  {
    id: "S16",
    what: "ETPC: trafny opis",
    question: "Czy ETPC orzekał o sądzie z udziałem sędziów powołanych przez nową KRS?",
    answer: "ETPC w sprawie ze skargi nr 43447/19 stwierdził naruszenie prawa do sądu ustanowionego ustawą (art. 6 ust. 1 Konwencji) z powodu udziału sędziów powołanych w wadliwej procedurze przed nową KRS.",
    sources: [wrap("etpcz", { numer_skargi: "43447/19", tresc: "Trybunał stwierdza naruszenie art. 6 ust. 1 Konwencji w zakresie prawa do sądu ustanowionego ustawą. Powołanie sędziów Izby, która rozpoznała sprawę skarżącego, nastąpiło na wniosek Krajowej Rady Sądownictwa ukształtowanej w sposób niezapewniający jej niezależności, co stanowiło rażące naruszenie prawa krajowego." })],
    signature: "43447/19",
    expected: { topic: "MATCH", claim: "SUPPORTED" },
    decisive: "Trybunał stwierdza naruszenie art. 6 ust. 1 Konwencji w zakresie prawa do sądu ustanowionego ustawą",
    lexical: "pass"
  }
];
