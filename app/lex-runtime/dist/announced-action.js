// An answer that only announces the work ("Szukam teraz polskiego orzeczenia...",
// "Przeszukuję bazę pomocniczą SAOS; znaleziony wynik będzie...") ends the turn with
// nothing done: the user has to write again (version 0.1.27). One more round with the
// tools asks for the announced search and its result.
const ANNOUNCEMENT = /(?:^|[.!?;:]\s+|\n)\s*(?:(?:teraz|zaraz|najpierw|następnie|w\s+takim\s+razie)\s+)?(?:szukam|wyszukuję|przeszukuję|sprawdzam|weryfikuję|poszukam|sprawdzę|wyszukam|przeszukam|zweryfikuję|przejdę\s+do\s+(?:wyszukania|sprawdzenia|weryfikacji)|przystępuję\s+do|rozpoczynam\s+(?:wyszukiwanie|sprawdzanie|weryfikację)|kontynuuję\s+(?:wyszukiwanie|sprawdzanie))(?![\p{L}])/iu;
// What a finished answer carries: a result, an explicit no-hit, a question to the user, a link.
const RESULT = /(?<![\p{L}\d])[IVXL]{1,5}\s+[A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż]{0,5}(?:\/[A-Z][a-z]{0,2})?\s+\d{1,5}\/\d{2,4}|nie\s+znalaz\p{L}*|nie\s+znaleziono|brak\s+(?:trafień|wyników|orzecze\p{L}*)|https?:\/\/|\[CZEKAM NA ODPOWIEDŹ\]|\?\s*$/imu;
const DISCLAIMER_START = /\n\s*(?:⚖️|\*\*?Ważna informacja|Ważna informacja|Informacja ma charakter|To wyjaśnienie ma charakter)/u;
export function onlyAnnouncesWork(answer) {
    const body = answer.split(DISCLAIMER_START)[0].trim();
    return body.length > 0 && body.length <= 700 && ANNOUNCEMENT.test(body) && !RESULT.test(body);
}
export const ANNOUNCED_ACTION_PROMPT = "Twoja odpowiedź zapowiada wyszukiwanie albo sprawdzenie, ale go nie zawiera. Wykonaj je teraz narzędziami w tej turze i podaj wynik: co znaleziono (z sygnaturą, sądem, datą i przedmiotem sprawy z pobranego tekstu) albo wprost, że nie znaleziono orzeczenia spełniającego kryteria i co sprawdzono. Nie zapowiadaj dalszych czynności. Zwróć pełną odpowiedź.";
