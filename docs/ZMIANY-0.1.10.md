# Lex Machina 0.1.10 — dziennik zmian (hotfix 4–17)

Wydania: pre-release w `michaleiatrak-star/Lex-machina-aplikacja` (instalator online, niepodpisany; sumy w `SHA256SUMS.txt`). Szczegóły techniczne: [`DOKUMENTACJA-TECHNICZNA.md`](DOKUMENTACJA-TECHNICZNA.md).

| Wydanie | Źródło (commit) | Najważniejsze |
|---|---|---|
| hotfix 4 | `02d33c0` | długi limit proxy dla generowania pisma |
| hotfix 5 | `39c6df7` | weryfikacja na lokalnej kopii ELI, okno kontekstu modeli lokalnych |
| hotfix 6 | `360ff57` | karta Wyszukiwanie, sprawdzanie i integralność konektorów MCP |
| hotfix 7 | `fec4967` | konektory i Wyszukiwanie na desktopie, `.docx` bez fałszywych blokad |
| hotfix 8 | `6fd11d1` | ELI dla wszystkich aktów, RAG tylko przy awarii ELI, kopia KK/KW |
| hotfix 9 | `8b86baa` | skille z kanału stabilnego/rozwojowego, `.docx` pisma prostego, polskie etykiety, pasek okna modelu na desktopie |
| hotfix 10 | `403c3d7` | `.docx` bez blokady G36, strona wyników w Wyszukiwaniu, CBOSA bez fałszywego błędu transportu |
| hotfix 11 | `a3612c8` | `.docx` bez fałszywego „brakującego załącznika”, przyczyna blokady w czacie, zmiana nazwy sprawy w panelu bocznym |
| hotfix 12 | `1c4c02d` | `.docx` zapisywany w Pobranych na desktopie, `AST_HEADER_INVALID` |
| hotfix 13 | `4c16230` | kontekst rozmowy wg okna modelu (Claude ~100k tokenów) |
| hotfix 14 | `0320028` | świeża sesja konta dla routera i generatora (ChatGPT), karta dokumentu w czacie, parser SN |
| hotfix 15 | 0c8ab07 | kształt bloków AST (ChatGPT), rozpoznanie „plik doc” |
| hotfix 16 | c2a7d08 | Google Gemini: klucz API i konto Google (Gemini CLI) |
| hotfix 17 | a30e2a4 | szkic/gotowy dokument po cyklach pism, edycja w karcie, podgląd źródła w ramce |

---

## hotfix 17

- Pisma: `letterDocumentPlan` — po `SIMPLE_LETTER_V1` (gotowy, gdy finalizacja PASS, Gate I nie BLOCKED i 0 niezweryfikowanych; inaczej szkic) i po etapie `PROCESS_PLEADING_V1` (szkic; gotowy przy `documentStatus = FINAL`) czat sam generuje `.docx` i kartę; `generatedDocument.stage` (`DRAFT`/`FINAL`) w wątku.
- Karta dokumentu: edycja (`DocumentEditor`, zapis przez `workspace/render` jako nowy plik w aktach), pobranie wersji edytowanej.
- Wyszukiwanie: `POST /api/mcp-search/source-preview` (`source-preview.ts`) — tylko HTTPS i domeny źródeł MCP (także po przekierowaniach, maks. 4), limit 8 MB / 20 s, bez skryptów, ramek i atrybutów zdarzeń, `<base>`; web: `SourcePreviewFrame` (ramka `sandbox` z `blob:`, PDF w `PdfPreview`). Trasa w allowliście proxy.

## hotfix 16

- Dostawca `google`: klucz API (`@ai-sdk/google` 4.0.70, `GOOGLE_GENERATIVE_AI_API_KEY`, magazyn kluczy desktopu), lista modeli z `generativelanguage.googleapis.com/v1beta/models` (tylko `generateContent`), rodziny `gemini-pro`/`gemini-flash` (lite pominięte).
- Konto Google przez Gemini CLI (`@google/gemini-cli` 0.62.0, pobierany na żądanie): logowanie — `security.auth.selectedType = "oauth-personal"` w `~/.gemini/settings.json` (bez nadpisywania innych ustawień) i interaktywny `gemini` w widocznym terminalu; status — `~/.gemini/oauth_creds.json`; wywołanie — `gemini -p "" -o json --approval-mode plan --skip-trust`, treść na stdin, bez wznawiania sesji; klucze API usuwane ze środowiska.
- Web: źródła „Gemini · konto Google” i „Google Gemini · API”; budżet rozmowy 300 000 znaków.

## hotfix 15

- `AST_INLINE_ARRAY_INVALID` (ChatGPT): `normalizeAstBlocks` — treść akapitu/nagłówka jako tekst, obiekt lub lista napisów → lista elementów; aliasy typów (`text`, `h2`…), lista i tabela z napisów, tytuł. Treść bez zmian. Każdy błąd `AST_*`: diagnostyka typów i kluczy bloków.
- Czat: `directDocumentRequest` rozpoznaje „doc”, „plik”, „w Wordzie”, „worda” (wcześniej „plik doc” szło do zwykłego czatu).

## hotfix 14

- ChatGPT (konto/Codex): `runText` bez klucza ciągłości wznawiał wspólny wątek, a bez niego `resume --last --all` (ostatnia sesja Codex na komputerze). Router i generator dzieliły wątek; model kopiował JSON routera (`AST_HEADER_INVALID`, `blocks=brak`). Teraz `accountContinuity: "none"` (router, generator): bez wznawiania, przejęcia i zapisu wątku; dotyczy ChatGPT, Claude, Grok. Czat w sprawie bez zmian (`accountSessionKey`).
- Karta dokumentu w czacie (`ChatDocumentCard`): Pobierz, Podgląd, Otwórz w Wordzie, Deanonimizuj (`ArtifactDeanonymize`). Wiadomość w wątku ma `generatedDocument` (walidacja w `case-workspace-store`). Bez automatycznego zapisu.
- SN: parser sn.pl — pojedynczy rekord, lista jako obiekt PHP, kolekcja pod nieznanym kluczem; ślad G22 do głębokości 6.

## hotfix 13

- Historia rozmowy wysyłana z wiadomością: było 28 000 znaków dla każdego modelu. Teraz `conversationBudgetChars`: Claude 300 000, OpenAI/xAI 150 000, lokalne 28 000. Pomijane są całe najstarsze wiadomości z informacją, bez ucinania w połowie.
- Runtime: zapytanie do 320 000 znaków (`MAX_SESSION_QUERY_CHARS`), JSON 2 MB; `orchestrateDocumentContext` rezerwuje całe zapytanie (bez limitu 48k), więc długa rozmowa zmniejsza budżet dokumentów zamiast przepełniać okno.

## hotfix 12

- Desktop: WebView ignoruje `<a download>` dla blob URL — czat pisał „pobrany jako DOCX”, a pliku nie było (także finalne pismo po reautoryzacji, wersja tokenizowana, deanonimizacja w aktach, eksport `.txt`). Teraz `POST /api/downloads/save` zapisuje w folderze Pobrane (bez nadpisywania, tylko `.docx/.odt/.pdf/.txt`), czat podaje ścieżkę. Web: `download-file.ts`.
- `AST_HEADER_INVALID` (ChatGPT): runtime uzupełnia nagłówek AST wartościami z żądania (`schemaVersion`, `locale`, `documentType`, `styleProfile`; opakowanie `document`/`ast`, `content` → `blocks`). Bloki bez zmian. Przy odrzuceniu: etap `DOCUMENT_AST_VALIDATION`, pola nagłówka i klucze odpowiedzi.

## hotfix 11

- `.docx` (`G39I_INPUT_COMPLETENESS — ATTACHMENT_ASSERTED_BUT_MISSING`): bramka kompletności wejścia czytała całą historię rozmowy wysyłaną do modelu (także odpowiedzi asystenta), więc „w załączniku”/„w pliku”/„te dokumenty” z wcześniejszej wiadomości blokowało każde pismo bez załącznika. Teraz tylko bieżąca wiadomość użytkownika (`latestUserTurn`); „w pliku docx/Word/PDF/ODT” to format wyjścia.
- Czat: odpowiedź `BLOCKED` podaje przyczynę (stan, `audit.violations`, brakujące zasoby, `audit.blockedEvents`).
- Panel boczny: ikonka zmiany nazwy sprawy (właściciel; `PATCH /api/cases/:caseId`, uprawnienie MANAGE).

## hotfix 10

- `.docx` (`blocked_event_present`, ChatGPT i Claude): sesja generatora jest prowadzona przez runtime (`allowModelSelection: false`), a G36 uznawał odmowę odczytu skilla za poprawialną tylko przy wyborze skilli przez model. Odczyt nieistniejącego pliku skilla dawał `BLOCKED` G36 → G39I → G39H → G15 i odrzucenie każdego pisma. Teraz `DEGRADED`; `INVALID_RESOURCE_PREFIX`/`PATH_ESCAPE` i `CRIMINAL_QUALIFIER_MISSING` nadal blokują. `DOCUMENT_AST_SESSION_BLOCKED` wymienia zdarzenia `BLOCKED` (typ, cel, kod).
- Wyszukiwanie: lista pozycji zamiast JSON, „Pokaż treść” (CBOSA/EUREKA/UODO, z doczytywaniem części), „Wczytaj kolejne wyniki”, pola rejestrów; surowa odpowiedź w „Danych technicznych”.
- CBOSA: „Niekompletny transport HTTP (x/y B)” przy każdym wyszukiwaniu — porównanie długości rozpakowanego gzip z `Content-Length` skompresowanej odpowiedzi. Kontrola tylko bez `Content-Encoding`. Zmiana w skillu `audyt-systemu-v4` (źródło, `dist/lex-mcp.mjs`, `CHECKSUMS.sha256`) — musi trafić też do repozytorium Lex Machina, inaczej „Odśwież skille” przywróci błąd.

## hotfix 9

**Skille z repozytorium Lex Machina (kanały)**
- Ustawienia → Konserwacja → Skille: wybór kanału (stabilna / rozwojowa), stan zainstalowanych i najnowszych skilli, „Odśwież skille”.
- Kanał stabilny = najnowszy `Wersja stabilna rozpakowana <data>`: awans wersji rozwojowej nie wymaga zmian w aplikacji.
- Pobranie przypięte do commita `main`; każdy plik sprawdzany sumą git; walidacja strukturalna; nakładka z kopią poprzedniej wersji i wycofaniem przy nieudanym starcie.
- Nowe trasy: `GET /api/skills/channel/status`, `POST /api/skills/channel/refresh` (ADMIN, w allowliście proxy, limit 7200 s).

**Wyszukiwanie**
- Polskie nazwy narzędzi i pól, pełne słowa w listach (np. „częściowo prawomocna”), daty z kalendarzem; wyszukiwarki po słowie kluczowym lub fragmencie tekstu (SAOS, CBOSA, EUREKA, UODO, TSUE, ISAP) na początku listy.

**Poprawki**
- Generowanie `.docx` pisma prostego (`DOCUMENT_AST_SESSION_BLOCKED`, `workflow=SIMPLE_LETTER_V1:BLOCKED`): workflow pisma prostego wymagał sekcji tekstowych (TREŚĆ PISMA → … → HYBRID-VALIDATION), a generator `.docx` każe zwrócić wyłącznie JSON AST i te sekcje zabrania — każda taka próba była blokowana, niezależnie od modelu. Sesja generatora ma teraz flagę `documentAstOutput`: pismo trafia do bloków AST, a HYBRID-VAL i bramka eksportu sprawdzają wygenerowany dokument przed utworzeniem pliku. W czacie kontrakt sekcji bez zmian.
- Desktop: `POST /api/sessions/document-fit` dopuszczone w proxy — wcześniej pasek „Okno modelu” i blokada zbyt dużych plików przed wysłaniem nie działały w aplikacji desktopowej (błąd połykany).
- Wersja aplikacji w runtime 0.1.10 (było zaszyte 0.1.3 — błędne porównania w aktualizacjach).
- Stan aktualizacji z przyczyną zamiast samego `UNAVAILABLE` (brak wydania, limit GitHub, brak połączenia).
- Nowe narzędzie: `app/lex-desktop/scripts/check-route-allowlist.py` — każda trasa runtime wobec allowlisty proxy.

## hotfix 8

**Weryfikacja przepisów**
- Modele w chmurze (ChatGPT, Claude): każdy akt, także KC/KPC/KK/KPK, weryfikowany w Sejm ELI z kontrolą aktualności. Lokalna kopia (RAG) wyłącznie przy awarii ELI, z informacją `sourceNotice` (przyczyna, data kopii), którą model przekazuje przy przepisie. Odmowy merytoryczne (np. nowelizacje po t.j.) nie przechodzą na kopię.
- Modele lokalne (Bielik, Mistral): najpierw lokalna kopia; gdy nie może odpowiedzieć — ELI i dołączenie aktu do kopii.
- Akty spoza map DR: ustalane po Dz.U. albo jednoznacznym tytule w wyszukiwarce ELI, po weryfikacji dołączane do kopii i RAG; nowszy t.j. w źródle odświeża kopię.

**Lokalna kopia ELI**
- Pusty `text.html` obwieszczenia t.j. (np. Kodeks karny) → PDF; PDF (np. Kodeks wykroczeń) czytany z podziałem na wiersze, bez stopek. Wcześniej obie kopie nie miały artykułów (`CORE_LAW_TEXT_UNAVAILABLE`). Kopie bez artykułów pobierane ponownie.

**Znaczniki**
- „art. N” z `✅ [VER]` zweryfikowanej jednostki tego artykułu w tym samym wierszu nie dostaje już `⚠️ [NIEWERYFIKOWANE]` (przypadek art. 46 ust. 2 ustawy o wychowaniu w trzeźwości).

## hotfix 7

- Desktop: trasy konektorów MCP i karty Wyszukiwanie w allowliście proxy (wcześniej `DESKTOP_ROUTE_NOT_ALLOWED`; panel konektorów nie działał na desktopie od hotfix 5).
- Generowanie `.docx` (`READY_DOCUMENT_HYBRID_BLOCKED:SOURCE_SESSION_BLOCKED_EVENT`): zdarzenia federacji MCP trafiały do audytu wszystkich kolejnych rozmów do restartu; teraz każda sesja audytuje tylko własne wywołania. Niedostępne źródło i poprawialna odmowa odczytu skilla = `DEGRADED` (jak bramki G40/G36); odmowy polityki nadal blokują.
- Panel konektorów: usunięty dopisek o @matematicsolutions.

## hotfix 6

- Karta **Wyszukiwanie**: źródło → narzędzie → formularz ze schematu → wynik z API, bez modelu; te same bramki co w czacie; CBOSA jako snapshot, brak trafień = `OUT_OF_SCOPE`.
- Konektory MCP: przycisk „Sprawdź” (handshake z zapisem wyniku), integralność `lex-mcp.mjs` wobec `CHECKSUMS.sha256` skilla, wersja pakietu i skilla.
- Proces wydania: tag na commicie-punkcie (403 `GITHUB_TOKEN` przy tagu commita zmieniającego workflow).

## hotfix 5 i 4 (poprzednia sesja, dla porządku)

- hotfix 5: weryfikacja przepisu na lokalnej kopii ELI (akty spoza KC/KPC/KPK/KK, tryb offline), okno kontekstu 32k modeli lokalnych bez przepełnienia, przyczyna `DOCUMENT_AST_SESSION_BLOCKED` w odpowiedzi 422, najnowsze skille (router 3.58, audyt 6.153), konektory MCP Lex Machina zamiast @matematicsolutions.
- hotfix 4: długi limit proxy desktopu dla generowania pisma; G14 dopuszcza `localStorage` tylko dla ostatnio użytego modelu.

---

## Znane ograniczenia po hotfix 17

- Podgląd źródła: obrazy i style z domeny źródła nie są wczytywane (CSP aplikacji), widoczny jest tekst strony.
- Automatyczny plik pisma to dodatkowe wywołanie modelu po odpowiedzi.

- Gemini przez konto: przetestowane z podstawionym CLI (argumenty, stdin, JSON); logowanie kontem Google w prawdziwym Gemini CLI do potwierdzenia po instalacji.

- Odświeżanie skilli z GitHub sprawdzone na prawdziwym repozytorium lokalnie (`git archive`, 1433/1262 plików), nie przez API GitHub z aplikacji — do potwierdzenia po instalacji.
- Status kanału skilli zużywa 2 zapytania API GitHub; bez logowania limit to 60/h.
- Stara ścieżka aktualizacji skilli z podpisanych wydań (`/api/skills/update/*`) pozostaje w kodzie, nieużywana przez interfejs.
- Aktualizacja aplikacji nadal sprawdza wydania `michaleiatrak-star/Lex-Machina` (tag `v0.1.11` tam istnieje); do decyzji, czy źródłem instalatora ma być `Lex-machina-aplikacja`.
