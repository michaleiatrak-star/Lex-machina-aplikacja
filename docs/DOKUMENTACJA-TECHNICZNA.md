# Lex Machina — dokumentacja techniczna aplikacji

Stan: 2026-09-29 · wersja 0.1.10 (hotfix 9) · gałąź `claude/modest-knuth-re40mu`

**Zasady, których kod pilnuje (nie łamać przy zmianach):**
- przepisy tylko po weryfikacji w źródle (Sejm ELI); modele w chmurze nigdy z lokalnej kopii poza awarią ELI, i wtedy z jawną informacją (`sourceNotice`);
- `.docx` tylko po HYBRID-VAL (`validateLocalHybridDocument`) i bramce eksportu;
- NSA/WSA (CBOSA): snapshot bez awansu do VERIFIED, brak trafień = `OUT_OF_SCOPE`;
- dane sprawy nie trafiają do zewnętrznych źródeł (`guardOutboundPayload`, `*_CASE_DATA_FORBIDDEN`);
- każda nowa trasa HTTP wymaga wpisu w allowliście proxy desktopu (`route_allowed`), inaczej `DESKTOP_ROUTE_NOT_ALLOWED`.

Dokumentacja użytkowa: [`APLIKACJA-DOKUMENTACJA.md`](APLIKACJA-DOKUMENTACJA.md). Zmiany wersji: [`ZMIANY-0.1.10.md`](ZMIANY-0.1.10.md).

---

## 1. Repozytoria i źródła

| Repozytorium | Zawartość | Rola dla aplikacji |
|---|---|---|
| `michaleiatrak-star/Lex-machina-aplikacja` | aplikacja (`app/`), kopia korpusu do instalatora, workflow wydań | kod, instalatory, wydania `v0.1.10-hotfixN` |
| `michaleiatrak-star/Lex-Machina` | skille: `Wersja rozwojowa rozpakowana`, `Wersja stabilna rozpakowana <data>` (+ ZIP-y) | źródło odświeżania skilli (kanały), pakiet serwerów MCP |

Korpus w instalatorze: `Wersja rozwojowa rozpakowana/` z tego repozytorium (`app/lex-version.yaml`: `source_root`). Po odświeżeniu z kanału runtime używa nakładki `%LOCALAPPDATA%\LexMachina\skills\current`.

## 2. Architektura

```
lex-desktop (Tauri/Rust)  ── okno, uruchamia runtime, proxy z allowlistą tras (trust_boundary.rs)
   │ HTTP 127.0.0.1
lex-runtime (Node 24, TS) ── API, sesje, weryfikacja, sprawy, szyfrowanie, MCP, konserwacja
   │ stdio / named pipe
workery Python (privacy, ocr, storage) · lex-mcp.mjs (serwery MCP) · llama.cpp (modele lokalne)
lex-web (React)           ── interfejs, ładowany przez desktop
```

`app/lex-runtime/dist` jest budowany i wersjonowany w repozytorium: instalator kopiuje `dist`. Po każdej zmianie `src/` uruchom `npm run build` i dołącz zmienione pliki `dist/` (bez nowych `dist/*.test.js`, których nie ma w repozytorium).

## 3. Mapa modułów runtime (`app/lex-runtime/src`)

| Obszar | Moduły |
|---|---|
| HTTP | `http/server.ts` (składanie zależności), `http/app.ts` (sesje, sprawy, pisma), `http/mcp-connector-routes.ts`, `http/maintenance-routes.ts`, `http/workspace-routes.ts`, `http/legacy-migration-routes.ts` |
| Sesja i bramki | `session-executor.ts`, `audit-trail.ts`, `finalization-gate.ts`, `export-gate.ts`, `gate-i-*.ts`, `matter-complexity.ts`, `quick-legal-question.ts` |
| Weryfikacja przepisów | `verification-tool-runtime.ts`, `legal-act-resolver.ts` (KC/KPC/KK/KPK), `eli-act-descriptor.ts` (akty spoza rejestru), `temporal-source-freshness.ts`, `legal-source-verifier.ts`, `verification-ledger.ts`, `gate-i-auto-verification.ts` |
| Lokalna kopia ELI (RAG) | `core-law-index.ts`, `core-law-verification.ts`, `core-law-search.ts`, `core-law-tool-runtime.ts`, `pdf-text-extractor.ts` |
| Orzecznictwo | `case-law-verifier.ts`, `case-law-search.ts` |
| Federacja MCP | `lex-mcp-connectors.ts` (instalacja, stan, integralność), `legal-federation-tool-runtime.ts` (narzędzia modelu + `direct()` dla karty), `legal-source-policy.ts`, `auxiliary-source-fetcher.ts`, `web-search.ts` |
| Pisma | `legal-document-ast-generator.ts`, `legal-document-ast.ts`, `legal-document-renderer.ts`, `document-authoring-service.ts`, `document-generation-validation.ts` (HYBRID-VAL) |
| Sprawy i dokumenty | `case-*.ts`, `document-*.ts`, `office-*.ts`, `image-ingestion.ts`, `privacy/*`, `ocr/*` |
| Konta i klucze | `auth/*`, `case-access.ts`, `case-crypto.ts` |
| Skille | `registry.ts`, `skill-selection.ts`, `skill-channel.ts` (kanały z Lex-Machina), `account-skills.ts` |
| Konserwacja | `maintenance-service.ts` (aktualizacja aplikacji, skille, paczki modeli), `update-discovery.ts`, `*-verifier.ts` |
| Modele | `local-model-runtime.ts`, `model-auto-routing.ts`, `providers/*` |

## 4. Weryfikacja przepisów (`verify_legal_reference`)

Decyzja zależy od modelu sesji (`LegalVerificationToolFactory(ledger, { localModel })`; `localModel` = model `local/*`: Bielik, Mistral).

```
model w chmurze                                model lokalny
───────────────                                ─────────────
akt → rejestr KC/KPC/KK/KPK                     lokalna kopia ELI (verifyFromCoreLaw)
    └ brak → describeEliAct:                        ├ RECORD → wynik (bez sieci)
        mapy DR → "Dz.U. R poz. N" → wyszukiwarka   └ DENY → ścieżka jak w chmurze,
        ELI (tylko jednoznaczny tytuł)                       po sukcesie adopt() do kopii
kontrola aktualności (TemporalSourceFreshnessChecker, akt bazowy → bieżący t.j. + nowelizacje)
pobranie tekstu i dopasowanie (OfficialLegalSourceVerifier)
    ├ VERIFIED → rekord w ledgerze; akt spoza map → adopt() (kopia + RAG)
    ├ odmowa merytoryczna (np. TEMPORAL_POST_TJ_AMENDMENTS) → DENIED, bez kopii
    └ awaria ELI → eliOutageFallback: lokalna kopia + sourceNotice.eliUnavailable
```

**Awaria ELI** (jedyny przypadek kopii dla modeli w chmurze): `SOURCE_METADATA_UNAVAILABLE`; wyjątek przy ustalaniu aktu (sieć, HTTP ≠ 404); błąd pobrania tekstu (`could not be fetched`, `returned HTTP` ≠ 404, `ECONN*`, timeout). Wynik z kopii ma `sourceNotice { eliUnavailable, cause, localCopyDate }` i instrukcję, by model napisał to przy przepisie.

**Znaczniki (bramka finalizacji G8):** `✅ [VER: <url>, <data>]` musi odpowiadać rekordowi w ledgerze. Wzmianka „art. N” jest objęta jednym zweryfikowanym rekordem węższej jednostki tego artykułu (np. „art. N ust. 2 …”), gdy jego znacznik stoi w tym samym wierszu (`coveringVerifiedRecord`). Brak rekordu → runtime wstawia `⚠️ [NIEWERYFIKOWANE]`.

### Lokalna kopia ELI (`CoreLawIndex`)
- akty z map DR (`MAPA-AKTOW.md`, `ROUTING-MAP.md`) i akty dołączone (`index.json: adopted`); katalog `%LOCALAPPDATA%\LexMachina\core-law`;
- tekst: `text.html`; gdy nie ma artykułów (pusty HTML obwieszczenia t.j.) → `text.pdf` z podziałem na wiersze (`LocalPdfTextExtractor(…, { lines: true })`), bez stopek stron (`stripPdfPageHeaders`), z łączeniem przeniesień;
- rekord `extraction: 2`; kopia bez artykułów sprzed wersji 2 jest traktowana jak niepobrana i pobierana ponownie;
- odświeżanie w tle, przerwa po 5 odmowach ELI; nowszy t.j. w źródle wymusza sprawdzenie relacji (`adopt`).

## 5. Federacja MCP i karta Wyszukiwanie

- **Serwery:** `audyt-systemu-v4/mcp-servers/dist/lex-mcp.mjs` (`isap, eurlex, saos, cbosa, krs, wl, ceidg, nbp, eureka, sudop, uodo`); jeden proces stdio dla wszystkich gotowych serwerów.
- **Stan** (`LexMcpConnectorStore.status()`): `installed`, `ready` (CEIDG wymaga klucza), `lastCheck` (handshake z `check()`), `package.integrity` = SHA-256 `lex-mcp.mjs` wobec `CHECKSUMS.sha256` skilla (`MATCH | MISMATCH | UNVERIFIED | MISSING`).
- **Audyt sesji:** instancja federacji jest wspólna; każda sesja przekazuje własny dziennik (`runTools(calls, events)`). Zdarzenie `BLOCK` ma `outcome`: `SOURCE_UNAVAILABLE` → audyt `DEGRADED` (jak G40), `POLICY_BLOCKED` i `*_CASE_DATA_FORBIDDEN` → `BLOCKED`. Poprawialna odmowa odczytu skilla (`LEGAL_RESOURCE_NOT_FOUND`, `ROUTER_V3_REQUIRED_FIRST` itp.) → `DEGRADED` także w sesji prowadzonej przez runtime (generowanie `.docx`); wyjście poza korpus i brak kwalifikatora karnego → `BLOCKED`. G39I (kompletność wejścia) sprawdza tylko bieżącą wiadomość użytkownika; „w pliku docx/Word/PDF/ODT” to format wyjścia. Odpowiedź sesji ma `audit.blockedEvents` (typ, cel, kod) — czat i `DOCUMENT_AST_SESSION_BLOCKED` pokazują przyczynę. HYBRID-VAL odrzuca tylko `BLOCKED`.
- **Karta Wyszukiwanie:** osobna instancja `LegalFederationToolRuntime`, `direct()` = te same bramki co narzędzia modelu, zdarzenia nie trafiają do audytu sesji. Etykiety po polsku: `lex-web/src/mcp-search-labels.ts` (nowe narzędzie/pole bez wpisu → nazwa techniczna z automatycznym podziałem).
- **Strona wyników:** `lex-web/src/mcp-search-results.ts` — `readSearchResult` (kandydaci/result → pozycje, dokument z sekcjami, pola rejestrów), `nextPageArgs` (parametr `strona`), `appendDocument` (treść porcjowana: `tresc_offset`/`tresc_kompletna`/`tresc_dlugosc` → `offset`). Pełna treść pozycji: `cbosa_pobierz`, `eureka_pobierz`, `uodo_pobierz`. Surowy JSON tylko w „Danych technicznych”.

## 6. Generowanie pisma (.docx / .odt)

`LegalDocumentAstGenerator.generate` → sesja z `documentAstOutput: true` → JSON AST (nagłówek uzupełniany przez `normalizeAstHeader`) (`validateLegalDocumentAst`) → render → `validateLocalHybridDocument` (HYBRID-VAL: puste pismo, `⬛`/`[UZUPEŁNIJ]`, `DRAFT — NIEWERYFIKOWANY`, token PII, znaki sterujące, zdarzenie `BLOCKED` sesji źródłowej, brak odczytu dokumentu) → bramka eksportu → plik w sprawie.

W sesji z `documentAstOutput` workflow `SIMPLE_LETTER_V1` nie wymaga sekcji tekstowych (tryb `DOCUMENT_AST`) — struktura pisma jest w blokach AST, a HYBRID-VAL działa na wygenerowanym dokumencie. Bez tej flagi (czat) obowiązuje kontrakt sekcji `TREŚĆ PISMA → UWAGI PRAKTYCZNE → CO DALEJ → HYBRID-VALIDATION`.

## 7. Skille: kanały z repozytorium Lex Machina

`skill-channel.ts` + `MaintenanceService.skillChannelStatus / refreshSkillsFromChannel`:
1. `GET api.github.com/repos/michaleiatrak-star/Lex-Machina/commits/main` → commit;
2. `GET …/git/trees/<commit>?recursive=1` → katalog kanału: `Wersja rozwojowa rozpakowana` albo najnowsza data `Wersja stabilna rozpakowana DD.MM.RRRR`; `treeSha` katalogu = tożsamość wersji kanału;
3. `codeload.github.com/…/zip/<commit>` (≤ 200 MB), rozpakowanie (`extractZip`: PowerShell `Expand-Archive` / `unzip`);
4. każdy plik kanału = git blob SHA-1 z drzewa; brak, nadmiar, zmiana, symlink → odmowa;
5. `LexSkillRegistry` scan + `validateDeclarations`; nakładka `skills/current`, poprzednia w `skills/previous`, znacznik `.lex-skills-version.json` (`channel, commit, directory, treeSha`, stan `PENDING_RESTART_VALIDATION`); start z nieudaną walidacją wraca do poprzedniej albo wbudowanej (`recoverSkillOverlayForStartup`).

Status: `UP_TO_DATE` gdy zainstalowany kanał i `treeSha` są równe najnowszym. Dwa zapytania API na sprawdzenie (limit GitHub bez logowania: 60/h). Stara ścieżka (podpisane indeksy w GitHub Releases, `/api/skills/update/*`) pozostaje w kodzie, panel jej nie używa.

## 8. Granica zaufania desktopu (`lex-desktop/src-tauri/src/trust_boundary.rs`)

- `route_allowed(method, path)`: dokładne trasy i metody; MCP w `is_mcp_route` (identyfikator serwera = małe litery, bez `..`).
- Limity odczytu proxy: domyślnie 120 s; sesja i generowanie pisma 1200 s; przetwarzanie dokumentów 1200 s; start modelu lokalnego i logowanie kont 300 s; konserwacja modeli i odświeżanie skilli 7200 s.
- Kontrola kompletności: `python3 app/lex-desktop/scripts/check-route-allowlist.py` — każda trasa runtime wobec allowlisty (jedyny wyjątek celowy: `POST /api/auth/bootstrap-managed`). Uruchamiać po dodaniu trasy.

## 9. API HTTP (runtime, 127.0.0.1)

Wszystkie trasy poza `/health`, `/api/auth/status|bootstrap|login|recover` wymagają sesji (`Authorization`). `A` = tylko ADMIN.

| Obszar | Trasy |
|---|---|
| Uwierzytelnianie | `GET /api/auth/status`, `GET /api/auth/me`, `POST /api/auth/{bootstrap, bootstrap-managed, login, logout, lock, activity, password, recover, recovery-code}` |
| Administracja (A) | `GET/POST /api/admin/users`, `DELETE /api/admin/users/:userId`, `PATCH /api/admin/users/:userId/status`, `PUT/DELETE /api/admin/providers/:provider/credential`, `PUT/DELETE /api/admin/provider-accounts/anthropic/oauth-token`, `GET /api/admin/support/status`, `POST /api/admin/support/{challenge, activate}` |
| Konektory MCP (A) | `GET /api/admin/mcp-connectors`, `POST /api/admin/mcp-connectors/:server/{install, uninstall, check}`, `PUT/DELETE /api/admin/mcp-connectors/ceidg/key` |
| Zapis pliku (desktop) | `POST /api/downloads/save` (surowe bajty, `X-Lex-Filename`; folder Pobrane, bez nadpisywania) |
| Wyszukiwanie MCP | `GET /api/mcp-search/sources`, `GET /api/mcp-search/sources/:server/tools`, `POST /api/mcp-search/query` |
| Sesje | `POST /api/sessions/execute`, `POST /api/sessions/document-fit`, `GET /api/sessions/progress/:executionId`, `GET /api/routes`, `POST /api/routes/validate`, `GET /api/skills` |
| Sprawy | `GET/POST /api/cases`, `GET/PATCH/DELETE /api/cases/:caseId`, `POST …/{archive, unarchive, rotate-key, transfer-owner, import-legacy, migrate-legacy-storage}`, dostęp `GET/POST …/access`, `DELETE …/access/:userId`, `GET …/access-candidates`, `GET /api/cases/legacy` |
| Pliki i dokumenty | `GET/POST …/files`, `POST …/files/:uploadId/{process, deanonymize}`, `POST …/files/:uploadId/members/:fileId/process`, `GET …/documents/:documentId/{anonymized, privacy-key}`, `POST …/documents/:documentId/anonymized/{forms, grammar, protect, unprotect}`, `POST …/documents/:documentId/join-shared-key`, `POST /api/documents/{ingest, review}`, `POST /api/documents/:documentId/finalize`, `GET …/progress/:progressId` |
| Obszar roboczy | `GET …/workspace`, `GET …/workspace/artifacts`, `GET/POST …/workspace/thread(/messages)`, `POST/DELETE …/workspace/folders(/:folderId)`, `PATCH/DELETE …/workspace/items/:itemId`, `GET …/items/:itemId/{editable, preview}`, `POST …/items/:itemId/open`, `POST …/workspace/render` |
| Pisma | `POST …/artifacts/generate`, `GET …/artifacts/:artifactId/download`, `POST …/artifacts/:artifactId/deanonymization-intent`, `POST …/authoring/aliases`, `GET …/templates`, `POST /api/deanonymization/{preview, reauthorize, finalize}`, `GET /api/sensitive-download/:ticketId` |
| Workflow | `GET …/workflow/{chronology, contract-analysis, court-analysis, process-pleading}`, `…/ordered/:workflowId`, `POST …/initialize`, `POST …/reset`, process-pleading: `accept-start, confirm, not-applicable`; `GET …/workflow-audits/:artifactId` |
| Terminarz i kontakty | `GET/POST …/schedule`, `DELETE …/schedule/:eventId`, `GET /api/schedule/upcoming`, `GET/POST …/contacts`, `DELETE …/contacts/:contactId` |
| Wiedza | `POST …/knowledge/search`, `GET/POST /api/firm-knowledge`, `GET/POST /api/shared/templates` |
| Modele | `GET /api/providers`, `GET /api/models/:provider`, `GET /api/provider-accounts`, `POST /api/provider-accounts/:provider/login`, `GET /api/local-models`, `POST /api/local-models/{provision, repair, remove, start, stop}`, `GET/POST /api/local-models/update/{status, apply}` |
| Konserwacja (A) | `GET /api/update/status`, `POST /api/update/download`, `GET /api/skills/channel/status?channel=stable\|development`, `POST /api/skills/channel/refresh {channel}`, `GET /api/skills/update/status`, `POST /api/skills/update/apply` |
| Pozostałe | `GET/POST /api/guide/{state, initialize, transition}`, `POST /api/privacy/name-forms`, `GET /api/support/{me, diagnostics}`, `POST /api/support/logout`, `GET /health` |

(`…` = `/api/cases/:caseId`.) Pełna lista: `app/lex-runtime/src/http/*.ts`; 147 tras.

### Kody błędów warte uwagi
| Kod | Znaczenie |
|---|---|
| `DESKTOP_ROUTE_NOT_ALLOWED` | trasa bez wpisu w allowliście proxy (sekcja 8) |
| `CORE_LAW_TEXT_UNAVAILABLE` | lokalna kopia aktu bez artykułów (pobieranie w tle albo brak tekstu w ELI) |
| `ELI_UNAVAILABLE:<przyczyna>` | awaria ELI; wynik z kopii ma `sourceNotice` |
| `TEMPORAL_POST_TJ_AMENDMENTS` | nowelizacje po tekście jednolitym — brzmienie z t.j. nieaktualne |
| `READY_DOCUMENT_HYBRID_BLOCKED:<powody>` | HYBRID-VAL odrzucił pismo (np. `SOURCE_SESSION_BLOCKED_EVENT`) |
| `DOCUMENT_AST_SESSION_BLOCKED` | sesja pisma nie przeszła bramek; szczegóły w polach `reason`/`description` odpowiedzi 422 (`workflow=…`, `gateI=…`, `audit.violations`) |
| `SKILL_CHANNEL_*` | odświeżanie skilli: `GITHUB_HTTP_<kod>`, `FILE_HASH_MISMATCH`, `FILE_SET_MISMATCH`, `VALIDATION_FAILED`, `DIRECTORY_MISSING` |

## 10. Zmienne środowiskowe (uzupełnienie)

| Zmienna | Znaczenie |
|---|---|
| `LEX_MCP_PACKAGE`, `LEX_MCP_STATE_DIR` | ścieżka `lex-mcp.mjs`, katalog stanu konektorów |
| `LEX_CLAUDE_DESKTOP_CONFIG` | plik konfiguracji Claude Desktop do synchronizacji konektorów |
| `CEIDG_API_KEY` | klucz CEIDG (pierwszeństwo przed zapisanym) |
| `LEX_CORE_LAW_DIR` | katalog lokalnej kopii ELI (domyślnie `%LOCALAPPDATA%\LexMachina\core-law`) |
| `LOCALAPPDATA` | korzeń danych: `LexMachina\{skills, core-law, mcp}` |

## 11. Testy i walidatory

```bash
cd app/lex-runtime && npm install && npm run typecheck && npx vitest run && npm run build
cd app/lex-web && npm install && npx tsc -b && npx vitest run && npm run build && node scripts/validate-dist.mjs
python3 app/lex-desktop/scripts/check-route-allowlist.py
```

- Testy auth/kont wymagają Node ≥ 24.7 (Argon2 natywny); na starszym Node padają z `ARGON2_RUNTIME_UNAVAILABLE_NODE_24_7_REQUIRED` — to środowisko, nie kod.
- Sondy `*-live` (G17, G19, G20, G22, G30A, G40) wymagają dostępu do ELI/SAOS/CBOSA; w CI działają.
- Testy obszarów z tej wersji: `tests/{lex-mcp-connectors, mcp-search-http, core-law, core-law-pdf-articles, core-law-verification, finalization-gate, skill-channel, session-executor}.test.ts`, `src/update-discovery.test.ts`, `src/maintenance-skill-policy.test.ts`; Rust: testy `allowlist_*` w `trust_boundary.rs`.
- G14 (`validate-dist.mjs`): `localStorage` wyłącznie w `last-used-model.ts`.

## 12. Proces wydania (instalator online)

Workflow `publish-0.1.10-hotfixN.yml` (wyzwalany zmianą samego pliku albo `workflow_dispatch`):
1. `lex-runtime.yml` (typecheck, testy, walidatory, sondy live, kompilacja Tauri G34G);
2. `lex-installer.yml` (budowa NSIS, odbiór G33D: instalacja i start zainstalowanej kopii, SHA-256);
3. publikacja: weryfikacja SHA-256 artefaktu, commit-punkt tagu przez API (drzewo aplikacji = build, `.github` = `main`, rodzic = build — `GITHUB_TOKEN` dostaje 403 na tagu commita zmieniającego workflow), pre-release z `SHA256SUMS.txt`, `SOURCE-SHA.txt` (build + `tag_point`).

Przed nowym numerem sprawdź istniejące tagi (`git ls-remote --tags origin`); tag jest niezmienny (`IMMUTABLE_RELEASE_TAG_MISMATCH`). Instalator jest niepodpisany (Authenticode wymaga sekretów `LEX_WINDOWS_SIGNING_PFX_*`).
