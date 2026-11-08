// Amendments of the court regulation published after the consolidated text the court base is
// built from (court-base-data.ts, t.j. Dz.U. 2026 poz. 492), each applied from the day it enters
// into force. Checked against ELI by app/courts/check_court_act.py (weekly CI): an amending act
// missing here fails the check. A new consolidated text: rebuild the base with
// app/courts/build_court_base.py and empty this list.
export const COURT_BASE_AMENDMENTS = [
    {
        eli: "DU/2026/1448",
        title: "Rozporządzenie Ministra Sprawiedliwości z dnia 28 października 2026 r. zmieniające rozporządzenie w sprawie ustalenia siedzib i obszarów właściwości sądów apelacyjnych, sądów okręgowych i sądów rejonowych oraz zakresu rozpoznawanych przez nie spraw",
        od: "2027-01-01",
        przepis: "§ 3 pkt 18 lit. b",
        court: "Sąd Rejonowy w Chełmie",
        obszar_tekst: "miasta Chełm oraz gmin: Białopole, Dorohusk, Dubienka, Kamień, Pokrówka, Ruda-Huta, Sawin, Siedliszcze, Wierzbica i Żmudź",
        gminy: ["Białopole", "Dorohusk", "Dubienka", "Kamień", "Pokrówka", "Ruda-Huta", "Sawin", "Siedliszcze", "Wierzbica", "Żmudź"],
        // § 5 rozporządzenia Rady Ministrów z 29.07.2026 r. (Dz.U. 2026 poz. 1023): od 1.01.2027 r.
        // gmina Chełm (powiat chełmski) nosi nazwę Pokrówka; jej TERC się nie zmienia.
        przyczyna: "DU/2026/1023 § 5: zmiana nazwy gminy Chełm na gminę Pokrówka"
    }
];
