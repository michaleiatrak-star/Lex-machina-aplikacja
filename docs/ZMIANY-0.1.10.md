# Lex Machina 0.1.10 — dziennik zmian (hotfix 4–9)

Wydania: pre-release w `michaleiatrak-star/Lex-machina-aplikacja` (instalator online, niepodpisany; sumy w `SHA256SUMS.txt`). Szczegóły techniczne: [`DOKUMENTACJA-TECHNICZNA.md`](DOKUMENTACJA-TECHNICZNA.md).

| Wydanie | Źródło (commit) | Najważniejsze |
|---|---|---|
| hotfix 4 | `02d33c0` | długi limit proxy dla generowania pisma |
| hotfix 5 | `39c6df7` | weryfikacja na lokalnej kopii ELI, okno kontekstu modeli lokalnych |
| hotfix 6 | `360ff57` | karta Wyszukiwanie, sprawdzanie i integralność konektorów MCP |
| hotfix 7 | `fec4967` | konektory i Wyszukiwanie na desktopie, `.docx` bez fałszywych blokad |
| hotfix 8 | `6fd11d1` | ELI dla wszystkich aktów, RAG tylko przy awarii ELI, kopia KK/KW |
| hotfix 9 | budowany | skille z kanału stabilnego/rozwojowego, `.docx` pisma prostego, polskie etykiety, pasek okna modelu na desktopie |

---

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

## Znane ograniczenia po hotfix 9

- Odświeżanie skilli z GitHub sprawdzone na prawdziwym repozytorium lokalnie (`git archive`, 1433/1262 plików), nie przez API GitHub z aplikacji — do potwierdzenia po instalacji.
- Status kanału skilli zużywa 2 zapytania API GitHub; bez logowania limit to 60/h.
- Stara ścieżka aktualizacji skilli z podpisanych wydań (`/api/skills/update/*`) pozostaje w kodzie, nieużywana przez interfejs.
- Aktualizacja aplikacji nadal sprawdza wydania `michaleiatrak-star/Lex-Machina` (tag `v0.1.11` tam istnieje); do decyzji, czy źródłem instalatora ma być `Lex-machina-aplikacja`.
