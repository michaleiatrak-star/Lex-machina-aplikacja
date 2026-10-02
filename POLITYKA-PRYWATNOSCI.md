# Polityka prywatności Lex Machina

Wersja: 1.0 (projekt) · obowiązuje od: [DATA PUBLIKACJI] · część [LICENSE](LICENSE), pkt 8.

> **Projekt do uzupełnienia.** Pola w nawiasach kwadratowych wypełnia administrator. Odwołania do przepisów oznaczone `[DO WERYFIKACJI]` nie zostały jeszcze sprawdzone w EUR-Lex/ELI (zob. „Źródła”). Nie publikować jako adresu polityki na ekranie zgody OAuth Google przed uzupełnieniem obu.

## 1. Najważniejsze w skrócie

- Lex Machina działa **lokalnie na Twoim komputerze**. Autor nie prowadzi serwera, który odbiera Twoje dane, i nie zbiera telemetrii, statystyk ani raportów awarii.
- Sprawy, dokumenty, czat, terminy, kontakty i faktury zapisujesz **na swoim dysku, zaszyfrowane** kluczem Twojego konta.
- Dane opuszczają komputer tylko wtedy, gdy sam(a) użyjesz funkcji, która tego wymaga: modelu AI w chmurze, wyszukiwania w źródłach prawa, odzyskiwania konta przez Google albo sprawdzenia aktualizacji. Wtedy trafiają bezpośrednio do danego dostawcy, nie do autora.
- Jeżeli wprowadzasz do aplikacji dane innych osób (np. klientów), to **Ty** decydujesz o celach i sposobach ich przetwarzania i ciążą na Tobie obowiązki administratora tych danych `[DO WERYFIKACJI: RODO art. 4 pkt 7]`.

## 2. Administrator

Administratorem danych w zakresie opisanym w pkt 4.4, 4.5 i 6 (dane przekazywane autorowi lub przetwarzane w ramach klienta OAuth autora) jest:

- [IMIĘ I NAZWISKO / FIRMA]
- [ADRES]
- e-mail: [ADRES E-MAIL DO SPRAW DANYCH OSOBOWYCH]
- Inspektor ochrony danych: [nie wyznaczono / DANE IOD]

Danych zapisanych lokalnie w aplikacji autor nie otrzymuje i nie ma do nich dostępu.

## 3. Dane zapisywane lokalnie

| Co | Gdzie | Ochrona |
|---|---|---|
| Konto aplikacji (login, nazwa, data logowania), zdarzenia bezpieczeństwa | `~/.lex-machina/data/auth/auth.sqlite` (Windows: `%USERPROFILE%\.lex-machina\data`) | hasło: Argon2id; klucz główny konta szyfrowany AES-256-GCM |
| Sprawy: dokumenty, załączniki, czat, terminy, kontakty, sejf pseudonimizacji, szablony | `.../data/cases/<id>/secure/*.lme` | AES-256-GCM, klucz sprawy wyprowadzony (HKDF-SHA256) z klucza konta |
| Nazwa sprawy | `auth.sqlite` | **niezaszyfrowana** (widoczna dla osoby z dostępem do dysku) |
| Faktury, profil sprzedawcy, logo, token KSeF | `.../data/users/<id>/invoices.lme` | AES-256-GCM kluczem konta |
| Klucze API dostawców AI, token OAuth Anthropic, hasło lokalnego administratora | Menedżer poświadczeń Windows / Pęk kluczy macOS | magazyn systemowy |
| Dziennik nieprawidłowości (kody błędów, dostawca, model; **bez treści pytań, odpowiedzi i dokumentów**) | `.../data/diagnostics/anomalies.jsonl` | maks. 5000 wpisów |
| Modele lokalne, skille, komponenty | `%LOCALAPPDATA%\LexMachina` / `~/.lex-machina/local-ai`, `~/Library/Application Support/LexMachina` | bez danych osobowych |

Lokalny serwer aplikacji nasłuchuje tylko na `127.0.0.1` i wymaga losowego tokenu uruchomieniowego.

## 4. Kiedy dane opuszczają komputer

### 4.1. Modele AI w chmurze (opcjonalnie)

Gdy wybierzesz model OpenAI, Anthropic, Google (Gemini) lub xAI, treść rozmowy i fragmenty dokumentów sprawy trafiają do tego dostawcy na podstawie **Twojego** klucza API lub konta (także przez Claude Code, Codex lub Gemini CLI). Przed wysłaniem aplikacja zastępuje pseudonimami m.in. PESEL, NIP, REGON, IBAN, e-mail, telefon, imiona i nazwiska, adresy, numery dokumentów, KRS, ksiąg wieczystych, daty urodzenia, rejestracje i numery kart. Pseudonimizacja automatyczna może czegoś nie wykryć. Dostawca przetwarza dane na zasadach swojej umowy z Tobą. Model lokalny nie wysyła treści poza komputer.

### 4.2. Źródła prawa i rejestry

Zapytania (słowa kluczowe, sygnatury, numery aktów, KRS, NIP, numer rachunku) trafiają do źródła, które wybiera aplikacja: ISAP/ELI (api.sejm.gov.pl), EUR-Lex, SAOS, sn.pl, CBOSA (NSA), UODO, UZP/KIO, API KRS, NBP, CEIDG, biała lista VAT (wl-api.mf.gov.pl), Eureka (MF) i inne źródła z listy dozwolonych. Wyszukiwanie w internecie (Brave Search z Twoim kluczem lub DuckDuckGo) przyjmuje zapytania do 300 znaków i odrzuca te, które zawierają dane osobowe lub fragmenty dokumentów.

### 4.3. Aktualizacje i instalacja

Aplikacja sprawdza wydania i skille w GitHub (api.github.com, codeload.github.com). Instalator pobiera komponenty z nodejs.org, python.org, files.pythonhosted.org, github.com, huggingface.co, download.visualstudio.microsoft.com oraz modele OCR (m.in. modelscope, aistudio). Serwery te widzą Twój adres IP i dane techniczne żądania.

### 4.4. Konto Google: odzyskiwanie dostępu (opcjonalnie)

Funkcja korzysta z klienta OAuth autora. Zakresy: `openid`, `email` i `drive.appdata`.

- Pobierane dane: identyfikator konta Google i adres e-mail (zapisane lokalnie w `auth.sqlite`).
- W ukrytym folderze aplikacji na **Twoim** Dysku Google zapisywany jest plik `lex-machina-recovery-<id>.json` z losowym sekretem odzyskiwania. Sam sekret nie odszyfrowuje danych; otwiera tylko kopię klucza konta zapisaną lokalnie.
- Token dostępu jest trzymany wyłącznie w pamięci i odwoływany po każdej operacji; token odświeżania nie jest zapisywany.
- Odłączenie Google usuwa powiązanie lokalne, ale **nie usuwa pliku z Dysku**. Usuniesz go w Dysku Google: Ustawienia, Zarządzaj aplikacjami, Lex Machina, Usuń ukryte dane aplikacji.
- Dane z Google nie trafiają do autora ani do żadnego modelu AI.

Zakresy `drive.file`, Gmail i Kalendarz są przewidziane, ale aplikacja z nich nie korzysta. Przed ich włączeniem ta polityka zostanie uzupełniona.

Korzystanie z danych otrzymanych z interfejsów API Google i ich przekazywanie innym aplikacjom jest zgodne z Google API Services User Data Policy, w tym z wymogami Limited Use `[DO WERYFIKACJI: brzmienie oświadczenia wymaganego przez Google]`.

### 4.5. KSeF

Panel faktur zapisuje token KSeF i kontekstowy NIP lokalnie, zaszyfrowane. Obecna wersja **nie wysyła** faktur do KSeF. Gdy wysyłka zostanie włączona, dane faktury trafią do systemu KSeF Ministerstwa Finansów w wybranym środowisku (testowym lub produkcyjnym), a ta polityka zostanie uzupełniona. Dane faktur nie trafiają do modeli AI.

## 5. Okres przechowywania i usuwanie

- Dane lokalne przechowujesz, dopóki ich nie usuniesz. W aplikacji usuniesz sprawę (wymaga hasła), dokumenty, kontakty, terminy, wpisy czatu, użytkowników, klucze API, token KSeF i dziennik nieprawidłowości. Wystawionych faktur nie można usunąć w aplikacji.
- Odinstalowanie usuwa program, ale **nie usuwa danych**. Aby usunąć je całkowicie, skasuj `~/.lex-machina` (Windows: `%USERPROFILE%\.lex-machina`), `%LOCALAPPDATA%\LexMachina` (macOS: `~/Library/Application Support/LexMachina`) oraz wpisy „Lex Machina” w Menedżerze poświadczeń / Pęku kluczy.

## 6. Podstawy prawne i Twoje prawa

Jeżeli autor przetwarza Twoje dane (pkt 4.4 lub kontakt z autorem), podstawą jest Twoje żądanie skorzystania z funkcji lub kontaktu `[DO WERYFIKACJI: RODO art. 6 ust. 1 lit. b]` oraz prawnie uzasadniony interes autora w obsłudze zgłoszeń `[DO WERYFIKACJI: RODO art. 6 ust. 1 lit. f]`. Autor nie przekazuje tych danych nikomu poza dostawcami opisanymi wyżej i nie podejmuje wobec Ciebie zautomatyzowanych decyzji.

Masz prawo do dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia i sprzeciwu `[DO WERYFIKACJI: RODO art. 15–21]` oraz do wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa) `[DO WERYFIKACJI: RODO art. 77; ustawa o ochronie danych osobowych]`. Dane lokalne usuniesz samodzielnie (pkt 5); w pozostałych sprawach napisz na adres z pkt 2.

Dostawcy usług wymienieni w pkt 4.1–4.3 mogą przetwarzać dane poza Europejskim Obszarem Gospodarczym na zasadach własnych polityk.

## 7. Zmiany

Zmiany polityki są publikowane w tym pliku w repozytorium; historia zmian jest w historii git.

## Źródła

Środowisko, w którym przygotowano projekt (2026-10-02), nie miało dostępu do eur-lex.europa.eu ani api.sejm.gov.pl, więc żaden przepis nie został zweryfikowany. Przed publikacją sprawdź:

| Akt | Adres | Status |
|---|---|---|
| RODO, rozporządzenie (UE) 2016/679, CELEX 32016R0679: art. 4 pkt 7, 6, 13, 15–21, 77 | https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:32016R0679 | `[DO WERYFIKACJI]` |
| Ustawa z 10 maja 2018 r. o ochronie danych osobowych (Prezes UODO jako organ nadzorczy) | https://isap.sejm.gov.pl (wyszukaj ELI aktu i aktualny tekst jednolity) | `[DO WERYFIKACJI]` |
| Google API Services User Data Policy | https://developers.google.com/terms/api-services-user-data-policy | `[DO WERYFIKACJI]` |
