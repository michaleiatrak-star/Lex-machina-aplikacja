# Lex Machina 0.1.10 — dziennik zmian (hotfix 4–29)

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
| hotfix 15 | `0c8ab07` | kształt bloków AST (ChatGPT), rozpoznanie „plik doc” |
| hotfix 16 | `c2a7d08` | Google Gemini: klucz API i konto Google (Gemini CLI) |
| hotfix 17 | `a30e2a4` | szkic/gotowy dokument po cyklach pism, edycja w karcie, podgląd źródła w ramce |
| hotfix 18 | `85eba7a` | konto Gemini/ChatGPT/Claude: klient pobierany przy „Połącz konto”, Gemini CLI rozpoznawany po pobraniu |
| hotfix 19 | `eec5a89` | Grok przez konto: klient pobierany przy „Połącz konto”, EPIPE klienta Grok |
| hotfix 20 | `b69d602` | „Połącz konto”: pobieranie klienta w tle z paskiem etapów, potem logowanie |
| hotfix 21 | `c82dc5a` | EUREKA: wyszukiwanie frazy w całości, podgląd dokumentu z API |
| hotfix 22 | `5132bdc` | Gemini/Grok przez konto: Node z pakietu aplikacji dla skryptów npm, błąd npm w UI |
| hotfix 23 | `4eebca9` | Użytkownicy: przegląd i zmiana uprawnień do spraw; bez panelu wsparcia serwisowego |
| hotfix 24 | `2c29a94` | Aktualizacje: stan i aktualizacja przepisów (RAG) |
| hotfix 25 | `5337c41` | Przepisy (RAG): własne akty z ISAP/ELI/Dz.U., sprawdzane w Sejm ELI |
| hotfix 26 | `6fa6eef` | modele widzą akty dodane i stan kopii; codzienne sprawdzanie kopii w działającej aplikacji |
| hotfix 27 | `9b8e46a` | Gemini/Grok przez konto: uruchamianie npm.cmd i klientów .cmd na Windows |
| hotfix 28 | `b44bf03` | Wyszukiwanie: podgląd ELI/EUR-Lex/KRS/NBP/biała lista/CEIDG, KRS po NIP/REGON, NBP kupno/sprzedaż, CBOSA data orzeczenia, SUDOP kolejka |
| hotfix 29 | `01b82e5` | KIO (wyszukiwarka UZP), SAOS bez fałszywej niedostępności, przypisania/archiwum/nazwa spraw, Gemini: odmowa planu Google |
| hotfix 30 | `d87b0ff` | Przepisy (RAG): PDF ELI ponad 600 stron, skany przez lokalny OCR (partiami, oznaczone), kodowanie starych Dz.U., „Artykuł N” |
| hotfix 31 | `ebebb89` | MCP: suma pakietu (CRLF z checkoutu na Windows), RAG: postęp OCR i „Bez tekstu w ELI”, konto: narzędzia w jednej rundzie, sprawy i kalendarz |
| hotfix 32 | `81817b6` | Grok przez konto: kod limitu zapytań (ACP „Rate limited”), ponowienie po 15/45 s |
| hotfix 33 | `ee5fbed` | Router v3 dostarczany z pierwszym odczytem (bez straconej rundy), konta: bez powtórnych wyszukiwań |
| hotfix 34 | `580d663` | AUTO: router v3 i prawo-polskie-v2 z góry dla wszystkich modeli, metodyka doboru narzędzi |
| hotfix 35 | `c15ed5a` | Metodyka doboru skilli i modułów taka sama dla wszystkich hostów (także Claude z korpusem), kilka domen i dalsze skille |
| hotfix 36 | `f916e44` | Błędna ścieżka modułu lub nazwa skilla: jedyny pasujący plik w tej samej rundzie albo lista kandydatów |
| hotfix 37 | `3dcbe0f` | Błędny numer wersji w nazwie skilla lub modułu, moduł z innego skilla |
| hotfix 38 | `9639102` | Dziennik nieprawidłowości w Konserwacji; nieudany natywny Read nie jest odczytem |
| hotfix 39 | `771e608` | Instalator online macOS (.pkg, Apple silicon, macOS 14+) obok instalatora Windows |
| hotfix 41 | `cd1353f` | Faktury: dane kontrahenta po NIP (biała lista VAT, CEIDG), sposób płatności, termin, stawka VAT z listy, domyślne w ustawieniach |

---

## hotfix 41

- `company-lookup.ts`, `CompanyNipField.tsx`: NIP → `wl_sprawdz_nip`, potem `ceidg_szukaj_firmy` przez `/api/mcp-search/query`; suma kontrolna NIP lokalnie, odrzucenie odpowiedzi z innym NIP.
- `invoice-store.ts`: `defaults` (sposób płatności, termin w dniach, stawka VAT), `PUT /api/invoices/settings/defaults` (allowlista desktopu); `GET /api/invoices/legal-basis?topic=vat-rate` szuka „23%” w ustawie o VAT przez ELI.
- Formularz: listy sposobu płatności (przelew, gotówka, zapłacono), terminu (7/14/21/30 dni, inna data) i stawki VAT.

## hotfix 39

- macOS: `build-macos-online.sh` (payload, sidecar, `.app` z `tauri.macos.conf.json`, podpis ad hoc, `.pkg`), `macos/scripts/postinstall` uruchamia `macos-online-bootstrap.sh` jako zalogowany użytkownik: Node 24.21.0 darwin-arm64, CPython 3.13.16 (python-build-standalone 20261001), paczki, modele, `generate-component-lock.py`, autotest.
- `runtime_sidecar.rs`: katalog komponentów `~/Library/Application Support/LexMachina/runtime` (`LEX_COMPONENTS_ROOT`), ścieżki node/python/uvx/npm per system, `LEX_NPM_CLI`; keyring `apple-native`; `build.rs` zapisuje `icon.png`.
- Aktualizacje: na macOS zasób `*macos*.pkg`, `APPLICATION_UPDATE_MANUAL_INSTALL_REQUIRED` zamiast instalacji w aplikacji.
- CI: `macos-installer.yml` (macos-14: budowa, `installer -pkg`, autotest, `/health`, uruchomienie aplikacji); `publish-0.1.10-hotfix39.yml` publikuje `.exe` i `.pkg` w jednym wydaniu.

## hotfix 38

- `anomaly-journal.ts`: `withAnomalyJournal` wokół `SafeSessionExecutor`; `<LEX_DATA_DIR>/diagnostics/anomalies.jsonl`, maks. 5000 wpisów. API (ADMIN): `GET /api/diagnostics/anomalies`, `GET .../export`, `DELETE`.
- `reportNativeReads`: Read nieistniejącego pliku → `onMissing` → `recordNativeMissing` (`LEGAL_RESOURCE_NOT_FOUND`, `native`), nie `onRead`.

## hotfix 37

- `looseSkill`/`looseResource`: porównanie bez `-vN` (wynik 90); brak trafień w skillu → dokładna nazwa w pozostałych skillach (`matchSkill`).

## hotfix 36

- `read_legal_resource`: `looseResource`/`looseSkill` przy braku ścieżki lub skilla; jednoznaczne dopasowanie (wynik ≥ 60, bez remisu) czytane od razu z `requestedPath` i `resolvedFrom` w audycie; w innym razie `NOT_FOUND` z `candidates` (do 12). Dotyczy hostów bez natywnego korpusu.

## hotfix 35

- `executeModelSelectedSkills`: wspólna `methodology` dla natywnego korpusu i `read_legal_resource`; kilka domen DR i skilli wykonawczych, samodzielne dociąganie modułów i dalszych skilli; natywny prompt wskazuje wczytane z góry pliki.

## hotfix 34

- `executeModelSelectedSkills`: SKILL.md `prawny-router-v3` i `prawo-polskie-v2` w prompcie z góry także bez natywnego korpusu (`onCorpusPreloaded` → `LegalCorpusToolRuntime.recordPreloaded`, zdarzenie `ALLOW` `preloaded`); natywny korpus dostaje też `prawo-polskie-v2`.
- Instrukcja AUTO: metodyka doboru (jeden odczyt = jeden plik, moduł z SKILL.md tylko przy znanej nazwie).

## hotfix 33

- `LegalCorpusToolRuntime`: przy `modelSelectsSkills` zamiast `ROUTER_V3_REQUIRED_FIRST` → `requiredRouter` (SKILL.md routera) w wyniku pierwszego odczytu, zdarzenie `ALLOW` z `deliveredWith`; odczyt routera w rundzie wykonywany jako pierwszy (kolejność wyników bez zmian).
- `buildAccountPrompt`: bez powtarzania wyszukiwań/odczytów, weryfikacja tylko cytowanych przepisów.

## hotfix 32

- `codedGrokFailure`: błąd JSON-RPC z `runGrokAcp` → `ACCOUNT_SESSION_CAPACITY:xai:1:…` (wcześniej `PROVIDER_UNCODED_FAILURE`).
- `streamAccountSession`: `isTransientRateLimit` → ponowienie po 15 s i 45 s (z `abortSignal`); bez ponowień przy „usage limit”/quota.
- Web: komunikat `ACCOUNT_SESSION_CAPACITY` z przyczyną i wyjściem.

## hotfix 31

- `.gitattributes`: `Wersja?rozwojowa?rozpakowana/** -text` (i stabilna) — `actions/checkout` na Windows (autocrlf) zmieniał `lex-mcp.mjs` → `MISMATCH`; `build-windows-online.ps1`: `MCP_BUNDLE_CHECKSUM_MISMATCH`.
- `CoreLawIndex`: `status().progress` (`download`/`extract`/`ocr`, done/total), `ocr-cache/<sha256>.json` (wznawianie), `CoreLawPermanentError(noText)` → stan `UNAVAILABLE` + `unavailable`; adnotacja o załączniku po `normalizeForSearch`.
- `buildAccountPrompt`: niezależne wywołania narzędzi w jednej rundzie (każda runda = nowy proces CLI).
- Web: `CaseAccessAdminPanel` (karty `details`, tabela, `ROLE_HELP`, `caseMembersText`); `CalendarPanel` (`dayLabel`, `relativeDayText`, znaczniki rodzajów, agenda 14 dni, data, usuwanie).

## hotfix 30

- `CoreLawIndex`: własne limity PDF (5000 stron, 128 MB, 60 mln znaków), pobranie PDF 10 min; `LocalPdfTextExtractor` zwraca `pageTexts`, opcja `allowEmpty`.
- Skan (≥ połowa stron < 40 znaków po nagłówkach albo brak artykułów): `OcrEngine.recognizePages` partiami po 20 stron, maks. 1000; `textSource: "ocr"`, `ocrPages`; `verifyFromCoreLaw` → `CORE_LAW_OCR_TEXT`; `coreLawEliCaution` z informacją o OCR.
- `CoreLawPermanentError` (brak tekstu w ELI, brak OCR, limit OCR): ponowienie raz na dobę (`retryAt`), nie liczy się do blokady źródła.
- `repairDzuPdfEncoding`, `splitArticles` z „Artykuł N”, `stripPdfPageHeaders` dla „Dziennik Ustaw Nr N — S — Poz. P”.
- Sonda: DU/1965/232 to 1 strona (obraz) z odesłaniem do załącznika numeru; DU/2009/858 to 608 stron, tekst tylko na s. 1 i 608.

## hotfix 29

- Konektor `kio` (`kio-example/kio-mcp-server.js`): `POST /Home/GetResults` (formularz: Phrase/Fle/SCnt/Sign/Dt/Kind/Pg), `/Home/Details/{id}`, `/Home/ContentHtml/{id}`; `kio_szukaj`, `kio_sprawdz_sygnature`, `kio_pobierz`. Rejestracja: `lex-mcp.js`, `.mcp.json`, instalator, MCPB, `LEX_MCP_CATALOG`, federacja, polityka R2A, host podglądu `orzeczenia.uzp.gov.pl`.
- Limity: `callTool` 280 s, proxy desktopu `POST /api/mcp-search/query` 300 s (SAOS 3 × 45 s); licznik oczekiwania w UI.
- `CaseAccessAdminPanel`: szybkie przypisanie (`assignableCases`), `renameCase`, `archiveCase`/`unarchiveCase` (MANAGE).
- `ACCOUNT_SESSION_PLAN_UNSUPPORTED` (IneligibleTierError/UNSUPPORTED_CLIENT) z komunikatem o kluczu API.
- `test_protokol.mjs`: `krs_szukaj` (brak od hotfix 28), KIO; `test_na_zywo.mjs`: przypadki KIO, filtr `LEX_TYLKO`; job `kio-live` w publikacji (bez blokowania).

## hotfix 28

- `source-preview.ts`: ISAP/`api.sejm.gov.pl/eli/acts/…` → `text.html` albo `text.pdf` (ISAP: Imperva); EUR-Lex → Cellar `publications.europa.eu/resource/celex/{CELEX}` (`Accept-Language: pol`, XHTML; EUR-Lex: AWS WAF 202); KRS `OdpisAktualny` i NBP `rates/a` renderowane z API (hosty `api-krs.ms.gov.pl`, `api.nbp.pl`).
- MCP (`lex-mcp.mjs` przebudowany): `url_podgladu`; `krs_szukaj` (NIP/REGON → KRS z wl-api); NBP tabela C; CEIDG 45 s + 1 ponowienie; WL/KRS/NBP: oficjalne strony w `url_zrodlowy`.
- CBOSA (JS i parser referencyjny Pythona): zagnieżdżone `<td>` w wartości („Data orzeczenia” + prawomocność).
- UI: `SearchItem.preview` (URL albo rekord WL/CEIDG), bez `cbosa_pobierz` w „Pokaż treść”, `isap_tekst`; SUDOP `PENDING` → `sudop_odbierz_wynik` (6 prób).
- `callTool` timeout 110 s.

## hotfix 27

- `spawnResolved` (.cmd/.bat na Windows): `cmd.exe /d /s /c "<linia>"` z `windowsVerbatimArguments` (`windowsShimCommandLine`); wcześniej Node cytował linię jako `\"…\"` i cmd.exe zgłaszał `'"…\npm.cmd"' is not recognized`.
- Instalacja klienta: `node npm-cli.js` (`npmCliScript`) zamiast `npm.cmd`.
- Bramka publikacji `validate:windows-account-shim` (windows-latest, katalog „Lex Machina”).

## hotfix 26

- `coreLawEliCaution`; `KnowledgeMapAct.origin/eliCaution`; `list_core_law_acts` zwraca `origin`, `eliCaution`; instrukcja `CoreLawToolRuntime` liczy akty dodane i nieaktualne.
- Mapa wiedzy dla modeli lokalnych: akty `USER` zawsze (do 15) + akty aktywnych dziedzin.
- `shortLegalActName` → etykieta aktu dodanego.
- `CoreLawIndex.startSchedule` (tik 1 h, zwykłe `refresh()`); wcześniej sprawdzanie tylko przy starcie runtime.

## hotfix 25

- `core-law-act-lookup.ts`: `parseLegalActReference` (ISAP `W(DU|MP)RRRRNNNPPPP`, ELI, Dz.U./M.P.), `lookupCoreLawAct` (akt bazowy z „Tekst jednolity dla aktu”, najnowszy t.j. z „Inf. o tekście jednolitym”, odmowa: nieznany / nieobowiązujący / bez tekstu / ELI niedostępne).
- `CoreLawIndex.addUserAct` / `removeUserAct` / `present`; `origin` (`MAP`/`VERIFIED`/`USER`), `addedAt`, `addedBy`; wymuszone pobranie od razu sprawdza relacje. Akt bez t.j.: „Akty zmieniające” = nowelizacje po tekście.
- Trasy `POST /api/core-law/acts/lookup`, `POST /api/core-law/acts`, `POST /api/core-law/acts/remove` (ADMIN); allowlista desktopu.
- UI: „Dodaj akt prawny” i „Dodane przez użytkowników” w `CoreLawUpdatesSection`.

## hotfix 24

- `CoreLawIndex`: sprawdzenie bez stosowania (`pendingConsolidated`, `pendingAmendments`), `applyUpdates`, `autoApply` (domyślnie włączone), dziennik zmian, `status()`. Nowszy t.j. zastępuje tekst; nowelizacja po t.j. trafia do wyszukiwania jako osobny dokument.
- Weryfikacja: niezastosowana aktualizacja → `DENY TEMPORAL_UPDATE_PENDING`; `read_core_law_article` zwraca `pendingUpdate` z ostrzeżeniem.
- Trasy `GET /api/core-law/status`, `POST /api/core-law/check|apply`, `PUT /api/core-law/settings` (zmiany: ADMIN); allowlista desktopu.
- UI: sekcja „Przepisy (RAG)” w panelu utrzymania (`CoreLawUpdatesSection`).

## hotfix 23

- `GET /api/admin/case-access` (ADMIN, `listAccessOverview`): wszystkie sprawy z członkami, rolami i `canManage` (tylko OWNER); tylko metadane.
- UI: `CaseAccessAdminPanel` w Ustawienia → Użytkownicy (filtr po użytkowniku; nadawanie, zmiana roli, deanonimizacja, odbieranie przez istniejące trasy sprawy). `AdminSupportPanel` usunięty z UI; mechanizm SERVICE w runtime bez zmian.
- Desktop: trasa w allowliście.

## hotfix 22

- `npmInstallEnvironment`: katalog Node runtime (i npm) na początku PATH dla `npm install` klienta konta. npm nie dodaje go sam, więc bez systemowego Node padał `postinstall: node …` (Grok Build, zależności Gemini CLI).
- `npmFailureDetail`: do błędu trafiają linie `npm error`, nie linie pobierania; UI (`provisionFailureText`) pokazuje przyczynę i szczegóły.

## hotfix 21

- Konektor EUREKA (`eureka-mcp-server.js`, `dist/lex-mcp.mjs`, `CHECKSUMS.sha256`): `searchInFullPhrase` przy frazie. Pomiar na żywym API: „akcyza alkohol” 3722 → 454 trafień, zgodnie z portalem.
- `source-preview.ts`: `eureka.mf.gov.pl/informacje/podglad/{id}` z `/api/public/v1/informacje/{id}`; pusta powłoka JavaScript → komunikat.

## hotfix 20

- `POST/GET /api/provider-accounts/:provider/provision`: zadanie w tle (`startProvision`/`provisionProgress`): etap, pakiety z `npm --loglevel=http`, MB na dysku, czas; jedna instalacja na dostawcę naraz.
- UI: `AccountConnectProgress` w Ustawieniach i przy „Połącz konto” w czacie (wcześniej czat pokazywał tylko „Logowanie…”).
- Desktop: trasa `provision` (GET/POST) w allowliście; limit proxy logowania 420 s (logowanie 300 s + zapas).

## hotfix 19

- `OPTIONAL_ACCOUNT_CLIENTS.xai`: `@xai-official/grok` 1.0.44 (wydawca xai-security); `runGrokAcp` przez `ensureAccountExecutable`. UI: „Połącz konto” zawsze, bez przycisku instalacji.
- `runGrokAcp`: obsługa błędu `stdin` (EPIPE po wczesnym wyjściu klienta przerywał proces runtime).

## hotfix 18

- UI: „Połącz konto” zamiast odsyłania na GitHub, gdy klienta konta (Codex, Claude Code, Gemini CLI) jeszcze nie ma; runtime pobiera przypiętą wersję.
- `provisionPinnedAccountClient`: po instalacji Gemini CLI zwracał ścieżkę Claude Code (`ACCOUNT_SESSION_CLI_PROVISION_MISSING_BINARY:google`); teraz `optionalAccountClientExecutable("google")`.

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
