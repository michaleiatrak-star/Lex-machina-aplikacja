# Legal situations for build-scenarios-5000.py, 10 per domain DR-01..DR-16.
# q: a lay person's short question; s: a lay person's story; p: a lawyer's brief;
# d: the document asked for (after "Napisz"); k: proste | procesowe | umowa;
# t: the matter after "w sprawie"; c: criminal matter (PROFIL-LEKKI: always PEŁNY).
S = []


def add(dr, q, s, p, d, k, t, c=False):
    S.append({"dr": dr, "q": q, "s": s, "p": p, "d": d, "k": k, "t": t, "c": c})


add("dr-01", "Czy mogę złożyć skargę konstytucyjną na przepis zastosowany w moim wyroku?",
    "Sąd oddalił moje odwołanie na podstawie przepisu, który moim zdaniem jest sprzeczny z Konstytucją. Wyrok jest prawomocny od miesiąca. Czy coś jeszcze mogę zrobić?",
    "Mocodawca uzyskał prawomocny wyrok NSA oparty na przepisie ustawy budzącym wątpliwości co do zgodności z Konstytucją RP. Proszę o analizę przesłanek skargi konstytucyjnej i terminu jej wniesienia.",
    "skargę konstytucyjną", "procesowe", "niezgodności przepisu z Konstytucją")
add("dr-01", "Kto może zgłosić obywatelski projekt ustawy?",
    "Z sąsiadami chcemy zmienić przepisy o ochronie zwierząt. Zebraliśmy już trochę osób. Jak to zrobić formalnie?",
    "Komitet inicjatywy ustawodawczej klienta planuje zbiórkę podpisów pod projektem ustawy. Proszę o analizę wymogów ustawy o wykonywaniu inicjatywy ustawodawczej przez obywateli.",
    "zawiadomienie o utworzeniu komitetu inicjatywy ustawodawczej", "proste", "obywatelskiej inicjatywy ustawodawczej")
add("dr-01", "Czy ustawa może działać wstecz?",
    "Nowe przepisy nałożyły na mnie opłatę za okres sprzed ich uchwalenia. Urząd każe płacić za dwa lata wstecz. Czy to w ogóle legalne?",
    "Klient został obciążony opłatą na podstawie ustawy przewidującej działanie wsteczne. Proszę o analizę zgodności z zasadą lex retro non agit i zasadą ochrony praw nabytych w orzecznictwie TK.",
    "pismo do Rzecznika Praw Obywatelskich", "proste", "wstecznego działania ustawy")
add("dr-01", "Jak napisać wniosek do Rzecznika Praw Obywatelskich?",
    "Urząd od roku nie reaguje na moje skargi, a sąd odrzucił pozew z powodów formalnych. Czuję, że moje prawa są łamane. Czy RPO może mi pomóc?",
    "Mocodawca wyczerpał drogę sądową w sprawie naruszenia prawa do sądu. Proszę o analizę kompetencji RPO z ustawy o Rzeczniku Praw Obywatelskich i możliwości przystąpienia do postępowania.",
    "wniosek do Rzecznika Praw Obywatelskich o interwencję", "proste", "naruszenia praw obywatelskich")
add("dr-01", "Czy w stanie klęski żywiołowej można zakazać wjazdu do miejscowości?",
    "W naszej gminie po powodzi wojewoda zakazał wjazdu do wsi. Mieszkam tam i nie mogę dojechać do domu. Czy mają prawo?",
    "Klient kwestionuje ograniczenie swobody przemieszczania się wprowadzone w stanie klęski żywiołowej. Proszę o analizę granic ograniczeń z art. 233 Konstytucji i ustawy o stanie klęski żywiołowej.",
    "skargę na ograniczenie wolności w stanie klęski żywiołowej", "procesowe", "ograniczenia swobody przemieszczania się")
add("dr-01", "Jaką większością Sejm odrzuca weto Prezydenta?",
    "Słyszałem w wiadomościach, że Prezydent zawetował ustawę o mieszkaniach, na którą czekam. Czy jest jeszcze szansa, że wejdzie w życie?",
    "Klient, podmiot objęty zawetowaną ustawą, pyta o dalszy tryb legislacyjny. Proszę o analizę procedury ponownego uchwalenia ustawy i skutków dla przepisów przejściowych.",
    "opinię o trybie ponownego uchwalenia ustawy", "proste", "weta prezydenckiego")
add("dr-01", "Czy rozporządzenie może być sprzeczne z ustawą?",
    "Minister wydał rozporządzenie, które zabrania mi czegoś, na co ustawa pozwala. Przez to tracę klientów. Co mogę zrobić?",
    "Mocodawca kwestionuje rozporządzenie wykraczające poza delegację ustawową. Proszę o analizę hierarchii źródeł prawa i możliwości odmowy zastosowania rozporządzenia przez sąd.",
    "skargę do sądu administracyjnego z zarzutem niezgodności rozporządzenia z ustawą", "procesowe", "rozporządzenia wykraczającego poza ustawę")
add("dr-01", "Czy można zaskarżyć ważność wyborów?",
    "W naszym okręgu doszło do nieprawidłowości przy liczeniu głosów. Mam zdjęcia protokołu. Czy mogę coś z tym zrobić?",
    "Klient dysponuje dowodami nieprawidłowości w obwodowej komisji wyborczej. Proszę o analizę przesłanek protestu wyborczego w Kodeksie wyborczym i terminu jego wniesienia.",
    "protest wyborczy", "procesowe", "nieprawidłowości przy liczeniu głosów")
add("dr-01", "Czy umowa międzynarodowa jest ważniejsza od ustawy?",
    "Sąd w mojej sprawie pominął przepis konwencji, który mi sprzyja, i zastosował polską ustawę. Czy mógł tak zrobić?",
    "Mocodawca powołuje się na ratyfikowaną umowę międzynarodową sprzeczną z ustawą. Proszę o analizę pierwszeństwa z art. 91 Konstytucji i obowiązku stosowania przez sąd.",
    "apelację z zarzutem pominięcia umowy międzynarodowej", "procesowe", "pierwszeństwa umowy międzynarodowej")
add("dr-01", "Kiedy poseł traci mandat?",
    "Nasz poseł został skazany prawomocnym wyrokiem, ale nadal zasiada w Sejmie. Jako wyborca chcę wiedzieć, czy to zgodne z prawem.",
    "Klient pyta o skutki prawomocnego skazania posła za przestępstwo umyślne. Proszę o analizę przesłanek wygaśnięcia mandatu i trybu stwierdzenia wygaśnięcia przez Marszałka Sejmu.",
    "pismo do Marszałka Sejmu o stwierdzenie wygaśnięcia mandatu", "proste", "wygaśnięcia mandatu posła")

add("dr-02", "Czy wynajmujący może zatrzymać kaucję?",
    "Wyprowadziłem się z mieszkania dwa miesiące temu i oddałem klucze. Właściciel nie oddaje kaucji 3000 zł, twierdzi, że ściany są brudne. Co mogę zrobić?",
    "Klient, były najemca, domaga się zwrotu kaucji zatrzymanej przez wynajmującego bez wykazania szkody. Proszę o analizę roszczenia na gruncie KC i ustawy o ochronie praw lokatorów.",
    "wezwanie do zwrotu kaucji", "proste", "zwrotu kaucji za mieszkanie")
add("dr-02", "Czy należy mi się zachowek po ojcu?",
    "Tata zapisał cały dom bratu w testamencie. Ja nic nie dostałam, a mam dwoje dzieci. Czy mogę coś zrobić?",
    "Mocodawczyni została pominięta w testamencie notarialnym spadkodawcy. Proszę o analizę roszczenia o zachowek z KC, w tym zaliczenia darowizn i przedawnienia.",
    "pozew o zachowek", "procesowe", "zachowku po ojcu")
add("dr-02", "Jak odrzucić spadek z długami?",
    "Wujek zmarł miesiąc temu i zostawił same długi. Dostałam pismo z banku. Nie chcę tego spadku, co mam zrobić?",
    "Klientka jest spadkobierczynią ustawową zmarłego z zadłużeniem przekraczającym aktywa. Proszę o analizę terminu na odrzucenie spadku z KC i skutków dla zstępnych.",
    "oświadczenie o odrzuceniu spadku", "proste", "odrzucenia spadku")
add("dr-02", "Jak podwyższyć alimenty na dziecko?",
    "Ojciec mojego syna zarabia teraz dwa razy więcej niż przy rozwodzie, a płaci nadal 600 zł. Syn idzie do liceum i wydatki wzrosły. Jak to zmienić?",
    "Mocodawczyni wnosi o podwyższenie alimentów na małoletniego z powodu zmiany stosunków z KRO. Proszę o analizę przesłanek i dowodów na wzrost możliwości zarobkowych zobowiązanego.",
    "pozew o podwyższenie alimentów", "procesowe", "podwyższenia alimentów na syna")
add("dr-02", "Jak reklamować wadliwy telewizor?",
    "Kupiłem telewizor w sklepie internetowym, po trzech tygodniach przestał działać. Sklep każe mi pisać do producenta. Czy muszę?",
    "Klient, konsument, zgłasza brak zgodności towaru z umową. Proszę o analizę uprawnień z ustawy o prawach konsumenta i odpowiedzialności sprzedawcy wobec odesłania do gwaranta.",
    "reklamację telewizora", "proste", "wadliwego telewizora")
add("dr-02", "Czy mój dług się przedawnił?",
    "Firma windykacyjna dzwoni w sprawie długu z karty kredytowej sprzed ośmiu lat. Nigdy nie dostałem pozwu. Czy muszę płacić?",
    "Klient otrzymał wezwanie od funduszu sekurytyzacyjnego dotyczące wierzytelności z 2017 roku. Proszę o analizę biegu i przerwania przedawnienia z KC oraz zarzutu w postępowaniu.",
    "odpowiedź na wezwanie z zarzutem przedawnienia", "proste", "przedawnionego długu")
add("dr-02", "Jak odzyskać pieniądze od kontrahenta?",
    "Wykonałem stronę internetową dla firmy, wystawiłem fakturę na 12 000 zł. Minęły trzy miesiące, a oni nie płacą i nie odbierają telefonu. Co robić?",
    "Mocodawca, przedsiębiorca, posiada wymagalną wierzytelność z faktury. Proszę o analizę drogi postępowania upominawczego z KPC, odsetek w transakcjach handlowych i rekompensaty.",
    "wezwanie do zapłaty faktury", "proste", "niezapłaconej faktury")
add("dr-02", "Czy sąsiad mógł zasiedzieć część mojej działki?",
    "Sąsiad postawił płot metr w głąb mojej działki ponad 25 lat temu. Teraz sprzedaję działkę i geodeta to wykazał. Czy mogę żądać przesunięcia płotu?",
    "Klient jest właścicielem nieruchomości, której pas jest od ponad 20 lat w posiadaniu samoistnym sąsiada. Proszę o analizę przesłanek zasiedzenia z KC i roszczenia windykacyjnego.",
    "wniosek o rozgraniczenie nieruchomości", "procesowe", "płotu postawionego na mojej działce")
add("dr-02", "Jak przeprowadzić eksmisję lokatora?",
    "Lokator nie płaci czynszu od pół roku i nie chce się wyprowadzić. Wypowiedziałem umowę, ale on dalej mieszka. Co teraz?",
    "Mocodawca jest właścicielem lokalu zajmowanego bez tytułu prawnego po wypowiedzeniu najmu. Proszę o analizę pozwu o eksmisję i prawa do lokalu socjalnego z ustawy o ochronie praw lokatorów.",
    "pozew o eksmisję", "procesowe", "eksmisji lokatora")
add("dr-02", "Czy deweloper musi zapłacić karę za opóźnienie?",
    "Mieszkanie miało być gotowe w marcu, a jest wrzesień i nadal nie ma odbioru. Płacę za wynajem i kredyt jednocześnie. Co mogę zrobić?",
    "Klient zawarł umowę deweloperską, deweloper opóźnia przeniesienie własności o sześć miesięcy. Proszę o analizę kar umownych, odszkodowania i prawa odstąpienia z ustawy deweloperskiej.",
    "wezwanie dewelopera do zapłaty kary umownej", "proste", "opóźnienia dewelopera")

add("dr-03", "Co grozi za jazdę po alkoholu?",
    "Zatrzymała mnie policja, miałem 0,6 promila. Zabrali mi prawo jazdy. Pierwszy raz mi się to zdarzyło. Co mi grozi?",
    "Klient został zatrzymany z wynikiem 0,6 promila alkoholu w wydychanym powietrzu. Proszę o analizę kwalifikacji z KK, wymiaru kary, zakazu prowadzenia pojazdów i świadczenia pieniężnego.",
    "wniosek o dobrowolne poddanie się karze", "procesowe", "jazdy po alkoholu", True)
add("dr-03", "Czy kradzież w sklepie za 400 zł to przestępstwo?",
    "Syn ukradł w markecie słuchawki za 400 zł. Ochrona wezwała policję. Ma 19 lat. Co mu grozi?",
    "Mocodawca, lat 19, zatrzymany za zabór słuchawek o wartości 400 zł. Proszę o analizę granicy wykroczenia z KW i przestępstwa z KK oraz możliwości warunkowego umorzenia.",
    "wniosek o warunkowe umorzenie postępowania", "procesowe", "kradzieży w sklepie", True)
add("dr-03", "Jak złożyć zawiadomienie o oszustwie?",
    "Kupiłam telefon przez internet, zapłaciłam 2500 zł, a sprzedawca zniknął. Mam potwierdzenie przelewu i rozmowy. Co mam zrobić?",
    "Klientka padła ofiarą oszustwa internetowego na kwotę 2500 zł. Proszę o analizę kwalifikacji z art. 286 KK i uprawnień pokrzywdzonego w postępowaniu przygotowawczym.",
    "zawiadomienie o podejrzeniu popełnienia przestępstwa oszustwa", "proste", "oszustwa przy zakupie telefonu", True)
add("dr-03", "Czy policja może przeszukać mój samochód bez nakazu?",
    "Policja zatrzymała mnie do kontroli i przeszukała auto bez żadnego papieru. Znaleźli trochę marihuany. Czy to legalne?",
    "Klientowi przeszukano pojazd bez postanowienia, znaleziono środki odurzające. Proszę o analizę legalności przeszukania z KPK i kwalifikacji posiadania z ustawy o przeciwdziałaniu narkomanii.",
    "zażalenie na przeszukanie", "procesowe", "przeszukania samochodu", True)
add("dr-03", "Co grozi za pobicie w obronie własnej?",
    "W nocy zaatakował mnie mężczyzna, broniąc się złamałem mu nos. Teraz on mnie oskarża o pobicie. Co mam robić?",
    "Mocodawca odpierał bezpośredni bezprawny zamach, napastnik doznał złamania nosa. Proszę o analizę obrony koniecznej z KK, przekroczenia jej granic i kwalifikacji uszkodzenia ciała.",
    "wyjaśnienia podejrzanego z powołaniem na obronę konieczną", "procesowe", "obrony koniecznej", True)
add("dr-03", "Czy komornik może zająć całą pensję?",
    "Komornik zajął mi wynagrodzenie i zostaje mi bardzo mało na życie. Mam dwoje dzieci. Ile może mi zabrać?",
    "Klient jest dłużnikiem w egzekucji z wynagrodzenia za pracę. Proszę o analizę granic potrąceń z KP, kwoty wolnej i skargi na czynność komornika z KPC.",
    "skargę na czynność komornika", "procesowe", "zajęcia wynagrodzenia przez komornika")
add("dr-03", "Jak wnieść prywatny akt oskarżenia o zniesławienie?",
    "Sąsiadka rozpowiada po osiedlu, że kradnę z piwnic. Ludzie przestali się do mnie odzywać. Chcę, żeby za to odpowiedziała.",
    "Mocodawczyni jest pomawiana publicznie o kradzieże. Proszę o analizę przesłanek z art. 212 KK, trybu prywatnoskargowego i terminu przedawnienia karalności.",
    "prywatny akt oskarżenia o zniesławienie", "procesowe", "zniesławienia przez sąsiadkę", True)
add("dr-03", "Co grozi za niepłacenie alimentów?",
    "Były mąż nie płaci alimentów od roku, komornik nic nie ściągnął. Słyszałam, że to przestępstwo. Czy mogę go zgłosić?",
    "Klientka jest wierzycielką alimentacyjną, dłużnik uchyla się od świadczeń od 12 miesięcy. Proszę o analizę przesłanek przestępstwa niealimentacji z KK i trybu ścigania.",
    "zawiadomienie o przestępstwie niealimentacji", "proste", "niepłacenia alimentów", True)
add("dr-03", "Czy mogę dostać mandat za przekroczenie prędkości z fotoradaru po roku?",
    "Dostałem wezwanie z fotoradaru za zdarzenie sprzed jedenastu miesięcy. Nie pamiętam, kto prowadził. Co zrobić?",
    "Klient otrzymał wezwanie do wskazania kierującego po upływie niemal roku od wykroczenia. Proszę o analizę przedawnienia karalności z KW i obowiązku z Prawa o ruchu drogowym.",
    "odpowiedź na wezwanie do wskazania kierującego", "proste", "wezwania z fotoradaru", True)
add("dr-03", "Co grozi za groźby karalne?",
    "Były partner wysyła mi wiadomości, że mnie zabije. Boję się wychodzić z domu. Co mogę zrobić?",
    "Mocodawczyni otrzymuje od byłego partnera wiadomości z groźbami pozbawienia życia. Proszę o analizę kwalifikacji z KK, środków zapobiegawczych i zakazu zbliżania się.",
    "wniosek o ściganie za groźby karalne", "proste", "gróźb od byłego partnera", True)

add("dr-04", "Ile mam czasu na odwołanie od zwolnienia dyscyplinarnego?",
    "Pracodawca zwolnił mnie dyscyplinarnie za trzy spóźnienia. Pracowałem tam sześć lat. Uważam, że to niesprawiedliwe. Co mogę zrobić?",
    "Klient został zwolniony w trybie art. 52 KP za trzy spóźnienia. Proszę o analizę zasadności rozwiązania umowy bez wypowiedzenia i roszczeń o przywrócenie lub odszkodowanie.",
    "odwołanie od rozwiązania umowy o pracę do sądu pracy", "procesowe", "zwolnienia dyscyplinarnego")
add("dr-04", "Czy pracodawca musi zapłacić za nadgodziny?",
    "Od roku pracuję po 10 godzin dziennie, a płacą mi za osiem. Szef mówi, że taka jest praca. Czy mogę żądać pieniędzy?",
    "Mocodawca świadczył pracę w godzinach nadliczbowych przez 12 miesięcy bez dodatku. Proszę o analizę roszczenia z KP, dowodzenia czasu pracy i przedawnienia.",
    "pozew o zapłatę wynagrodzenia za nadgodziny", "procesowe", "niezapłaconych nadgodzin")
add("dr-04", "Jak długi jest okres wypowiedzenia umowy o pracę?",
    "Pracuję w firmie od czterech lat na umowie na czas nieokreślony. Chcę odejść do konkurencji. Ile muszę jeszcze przepracować?",
    "Klientka zamierza wypowiedzieć umowę na czas nieokreślony przy stażu czterech lat. Proszę o analizę okresu wypowiedzenia z KP, porozumienia stron i zakazu konkurencji.",
    "wypowiedzenie umowy o pracę", "proste", "wypowiedzenia umowy o pracę")
add("dr-04", "Czy ZUS może odmówić zasiłku chorobowego?",
    "Byłam na zwolnieniu lekarskim dwa miesiące, a ZUS odmówił zasiłku, bo twierdzi, że firma jest fikcyjna. Prowadzę ją od trzech lat. Co robić?",
    "Klientka, przedsiębiorczyni, otrzymała decyzję ZUS kwestionującą tytuł ubezpieczenia. Proszę o analizę odwołania do sądu ubezpieczeń społecznych i ciężaru dowodu prowadzenia działalności.",
    "odwołanie od decyzji ZUS", "procesowe", "odmowy zasiłku chorobowego")
add("dr-04", "Czy mobbing to podstawa do odszkodowania?",
    "Kierownik od miesięcy mnie poniża przy innych i daje niewykonalne zadania. Jestem na zwolnieniu z powodu depresji. Co mogę zrobić?",
    "Mocodawczyni doświadcza uporczywego nękania przez przełożonego, rozwinęła rozstrój zdrowia. Proszę o analizę przesłanek mobbingu z KP i roszczeń o zadośćuczynienie.",
    "pozew o zadośćuczynienie za mobbing", "procesowe", "mobbingu w pracy")
add("dr-04", "Czy mogę dostać emeryturę wcześniej za pracę w szczególnych warunkach?",
    "Pracowałem 15 lat jako spawacz w stoczni. ZUS nie chce uznać tych lat. Mam 60 lat. Czy przysługuje mi wcześniejsza emerytura?",
    "Klient wnosi o emeryturę w obniżonym wieku z tytułu pracy w szczególnych warunkach. Proszę o analizę przesłanek z ustawy o emeryturach i rentach z FUS oraz dowodów stażu szczególnego.",
    "wniosek o emeryturę w obniżonym wieku", "proste", "wcześniejszej emerytury")
add("dr-04", "Czy pracodawca może zwolnić kobietę w ciąży?",
    "Jestem w trzecim miesiącu ciąży i dostałam wypowiedzenie. Pracodawca twierdzi, że likwiduje stanowisko. Czy może tak zrobić?",
    "Klientka w ciąży otrzymała wypowiedzenie umowy na czas nieokreślony. Proszę o analizę ochrony z KP, wyjątku upadłości lub likwidacji i roszczeń o przywrócenie do pracy.",
    "odwołanie od wypowiedzenia umowy o pracę w ciąży", "procesowe", "wypowiedzenia w ciąży")
add("dr-04", "Jak dostać świadczenie z PFRON na zatrudnienie?",
    "Mam firmę i chcę zatrudnić osobę z orzeczeniem o niepełnosprawności. Słyszałem o dopłatach. Jak to załatwić?",
    "Mocodawca, pracodawca, planuje zatrudnienie osoby niepełnosprawnej. Proszę o analizę dofinansowania wynagrodzeń z ustawy o rehabilitacji zawodowej i obowiązków sprawozdawczych.",
    "wniosek o dofinansowanie z PFRON", "proste", "dofinansowania z PFRON")
add("dr-04", "Czy należy mi się odprawa przy zwolnieniu grupowym?",
    "Firma zwalnia 40 osób, w tym mnie. Pracuję tam 12 lat. Mówią, że odprawy nie będzie, bo to porozumienie stron. Czy to prawda?",
    "Klient jest objęty zwolnieniami z przyczyn niedotyczących pracownika. Proszę o analizę prawa do odprawy z ustawy o zwolnieniach grupowych przy rozwiązaniu za porozumieniem stron.",
    "pozew o zapłatę odprawy", "procesowe", "odprawy przy zwolnieniu grupowym")
add("dr-04", "Jak odwołać się od decyzji o rencie?",
    "ZUS odebrał mi rentę, bo lekarz orzecznik uznał, że mogę pracować. Ledwo chodzę po wypadku. Co mogę zrobić?",
    "Mocodawca utracił rentę z tytułu niezdolności do pracy po orzeczeniu lekarza orzecznika. Proszę o analizę odwołania, sprzeciwu do komisji lekarskiej i dowodu z opinii biegłego.",
    "odwołanie od decyzji o odebraniu renty", "procesowe", "odebrania renty")

add("dr-05", "Ile mam czasu na odwołanie od decyzji urzędu?",
    "Urząd odmówił mi pozwolenia na budowę garażu. Decyzję dostałem tydzień temu. Uważam, że niesłusznie. Co dalej?",
    "Klient otrzymał decyzję odmowną organu pierwszej instancji. Proszę o analizę terminu i wymogów odwołania z KPA oraz zarzutów naruszenia przepisów postępowania.",
    "odwołanie od decyzji", "proste", "odmowy pozwolenia na budowę garażu")
add("dr-05", "Co zrobić, gdy urząd nie wydaje decyzji?",
    "Złożyłem wniosek do urzędu pięć miesięcy temu i dalej nic. Dzwonię i słyszę, że sprawa w toku. Jak ich zmusić?",
    "Mocodawca oczekuje na decyzję ponad pięć miesięcy. Proszę o analizę ponaglenia z KPA i skargi na bezczynność do WSA z PPSA, w tym grzywny i sumy pieniężnej.",
    "skargę na bezczynność organu", "procesowe", "bezczynności urzędu")
add("dr-05", "Jak zaskarżyć decyzję do sądu administracyjnego?",
    "Wojewoda utrzymał w mocy decyzję o wywłaszczeniu mojej działki pod drogę. Odszkodowanie jest za niskie. Co jeszcze mogę zrobić?",
    "Klient otrzymał decyzję organu drugiej instancji utrzymującą wywłaszczenie. Proszę o analizę skargi do WSA z PPSA i zarzutów co do ustalenia odszkodowania.",
    "skargę do wojewódzkiego sądu administracyjnego", "procesowe", "wywłaszczenia działki")
add("dr-05", "Jak uzyskać kartę pobytu w Polsce?",
    "Jestem z Ukrainy, pracuję w Polsce od dwóch lat. Wiza mi się kończy za miesiąc. Jak zostać legalnie?",
    "Klient, obywatel Ukrainy, zatrudniony od dwóch lat, wnosi o zezwolenie na pobyt czasowy i pracę. Proszę o analizę wymogów ustawy o cudzoziemcach i legalności pobytu w toku postępowania.",
    "wniosek o zezwolenie na pobyt czasowy i pracę", "proste", "karty pobytu")
add("dr-05", "Czy mogę dostać dostęp do dokumentów w urzędzie?",
    "Gmina nie chce mi pokazać umów z firmą, która remontuje drogę. Mówią, że to tajemnica. Czy mam prawo je zobaczyć?",
    "Mocodawca wystąpił o udostępnienie umów zawartych przez gminę. Proszę o analizę dostępu do informacji publicznej, tajemnicy przedsiębiorcy i skargi na bezczynność.",
    "wniosek o udostępnienie informacji publicznej", "proste", "dostępu do informacji publicznej")
add("dr-05", "Jak wznowić postępowanie administracyjne?",
    "Po latach odkryłem, że w mojej sprawie urzędnik był spokrewniony z sąsiadem, który wygrał. Decyzja jest ostateczna. Czy da się to odkręcić?",
    "Klient ujawnił udział w wydaniu decyzji pracownika podlegającego wyłączeniu. Proszę o analizę przesłanek wznowienia z KPA i terminów.",
    "wniosek o wznowienie postępowania", "proste", "wznowienia postępowania administracyjnego")
add("dr-05", "Czy mandat od straży miejskiej można zaskarżyć?",
    "Straż miejska założyła blokadę na koło, choć parkowałem prawidłowo. Mam zdjęcia. Czy mogę się odwołać?",
    "Klient kwestionuje założenie blokady i nałożenie kary przez straż miejską. Proszę o analizę trybu odmowy przyjęcia mandatu i postępowania w sprawach o wykroczenia.",
    "pismo z odmową przyjęcia mandatu i wyjaśnieniami", "proste", "blokady założonej przez straż miejską")
add("dr-05", "Co zrobić z decyzją o zwrocie dotacji?",
    "Urząd marszałkowski każe mi oddać dotację na firmę, bo spóźniłem się ze sprawozdaniem o tydzień. To 80 tysięcy. Czy muszę?",
    "Mocodawca otrzymał decyzję o zwrocie dofinansowania z odsetkami. Proszę o analizę proporcjonalności, ustawy o finansach publicznych i odwołania.",
    "odwołanie od decyzji o zwrocie dotacji", "procesowe", "zwrotu dotacji")
add("dr-05", "Jak przyspieszyć egzekucję administracyjną?",
    "Gmina wydała nakaz rozbiórki nielegalnej budowy sąsiada trzy lata temu i nic się nie dzieje. Budowa mi zasłania słońce. Co zrobić?",
    "Klient jest stroną postępowania, w którym organ nie egzekwuje ostatecznego nakazu rozbiórki. Proszę o analizę ustawy o postępowaniu egzekucyjnym w administracji i ponaglenia.",
    "wniosek o wszczęcie egzekucji administracyjnej", "proste", "niewykonanego nakazu rozbiórki")
add("dr-05", "Czy decyzja wydana bez mojego udziału jest ważna?",
    "Dowiedziałem się, że urząd wydał decyzję o lokalizacji masztu przy moim domu, a nikt mnie nie zawiadomił. Czy to w ogóle obowiązuje?",
    "Mocodawca nie został zawiadomiony o postępowaniu, choć był jego stroną. Proszę o analizę przesłanek nieważności lub wznowienia z KPA.",
    "wniosek o stwierdzenie nieważności decyzji", "proste", "decyzji wydanej bez udziału strony")

add("dr-06", "Czy muszę zapłacić podatek od sprzedaży mieszkania?",
    "Sprzedałam mieszkanie, które kupiłam trzy lata temu. Zarobiłam 100 tysięcy. Czy muszę to rozliczyć z fiskusem?",
    "Klientka zbyła lokal przed upływem pięciu lat od nabycia. Proszę o analizę PIT od odpłatnego zbycia i ulgi mieszkaniowej.",
    "oświadczenie o przeznaczeniu przychodu na cele mieszkaniowe", "proste", "podatku od sprzedaży mieszkania")
add("dr-06", "Jak odwołać się od decyzji urzędu skarbowego?",
    "Urząd skarbowy naliczył mi 40 tysięcy zaległego VAT po kontroli. Twierdzą, że faktury są puste. Ja naprawdę kupiłem ten towar. Co robić?",
    "Mocodawca otrzymał decyzję wymiarową zakwestionowania odliczenia VAT. Proszę o analizę dobrej wiary, należytej staranności i odwołania z Ordynacji podatkowej.",
    "odwołanie od decyzji podatkowej", "procesowe", "zakwestionowanego VAT")
add("dr-06", "Jak uzyskać interpretację podatkową?",
    "Prowadzę firmę i nie wiem, czy mogę wrzucić w koszty samochód, którym jeżdżę też prywatnie. Księgowa mówi różnie. Jak się upewnić?",
    "Klient planuje rozliczenie kosztów pojazdu o mieszanym użytku. Proszę o analizę wniosku o interpretację indywidualną z Ordynacji podatkowej i ochrony z niej wynikającej.",
    "wniosek o interpretację indywidualną", "proste", "kosztów samochodu firmowego")
add("dr-06", "Czy darowizna od rodziców jest opodatkowana?",
    "Rodzice dali mi 150 tysięcy na mieszkanie przelewem. Nic nie zgłaszałem. Czy będę mieć problem?",
    "Klient otrzymał od rodziców darowiznę pieniężną bez zgłoszenia. Proszę o analizę zwolnienia dla najbliższej rodziny z ustawy o podatku od spadków i darowizn i terminu zgłoszenia.",
    "zgłoszenie darowizny SD-Z2", "proste", "darowizny od rodziców")
add("dr-06", "Co grozi za spóźnione złożenie PIT?",
    "Zapomniałem złożyć PIT za zeszły rok. Minęły dwa miesiące od terminu. Co mi grozi?",
    "Klient nie złożył zeznania rocznego w terminie. Proszę o analizę czynnego żalu z KKS i skutków zaległości podatkowej.",
    "czynny żal", "proste", "niezłożonego PIT", True)
add("dr-06", "Jakie obowiązki AML ma biuro rachunkowe?",
    "Prowadzę małe biuro rachunkowe. Klient przelewa duże kwoty gotówką. Czy muszę to gdzieś zgłaszać?",
    "Mocodawca prowadzi biuro rachunkowe będące instytucją obowiązaną. Proszę o analizę obowiązków z ustawy o przeciwdziałaniu praniu pieniędzy, w tym środków bezpieczeństwa finansowego.",
    "procedurę wewnętrzną AML", "proste", "obowiązków AML biura rachunkowego")
add("dr-06", "Czy urząd skarbowy może zająć konto?",
    "Urząd skarbowy zajął mi konto firmowe przez zaległość, o której nie wiedziałem. Nie mam z czego płacić pracownikom. Co robić?",
    "Klient jest zobowiązanym w egzekucji administracyjnej należności podatkowych. Proszę o analizę zarzutów w sprawie egzekucji i wniosku o wstrzymanie.",
    "zarzuty w sprawie prowadzenia egzekucji", "proste", "zajęcia konta przez urząd skarbowy")
add("dr-06", "Jak rozłożyć zaległy podatek na raty?",
    "Mam zaległość w podatku 20 tysięcy. Firma ma gorszy okres. Czy mogę płacić w ratach?",
    "Mocodawca wnosi o rozłożenie zaległości podatkowej na raty. Proszę o analizę przesłanek ulgi z Ordynacji podatkowej i pomocy publicznej de minimis.",
    "wniosek o rozłożenie zaległości podatkowej na raty", "proste", "rat podatkowych")
add("dr-06", "Czy podatek od nieruchomości można zaskarżyć?",
    "Gmina naliczyła mi podatek od nieruchomości jak za firmę, choć w domu tylko mam siedzibę. Płacę kilka razy więcej. Czy to zgodne z prawem?",
    "Klient kwestionuje opodatkowanie budynku mieszkalnego stawką dla działalności gospodarczej. Proszę o analizę ustawy o podatkach i opłatach lokalnych i orzecznictwa NSA.",
    "odwołanie od decyzji w sprawie podatku od nieruchomości", "procesowe", "podatku od nieruchomości")
add("dr-06", "Jak rozliczyć kryptowaluty?",
    "W zeszłym roku zarobiłem na kryptowalutach i wypłaciłem na konto. Nie wiem, jak to wpisać do PIT. Pomożesz?",
    "Klient zbywał waluty wirtualne z zyskiem. Proszę o analizę przychodów z kapitałów pieniężnych z ustawy o PIT i kosztów nabycia.",
    "korektę zeznania PIT-38", "proste", "rozliczenia kryptowalut")

add("dr-07", "Jak odwołać się do KIO od wyboru oferty?",
    "Startowaliśmy w przetargu gminy na remont szkoły. Wygrała firma z ceną rażąco niską. Jak to zaskarżyć?",
    "Mocodawca, wykonawca, kwestionuje wybór oferty z rażąco niską ceną. Proszę o analizę odwołania do KIO z PZP, terminu i wpisu.",
    "odwołanie do KIO", "procesowe", "wyboru oferty w przetargu")
add("dr-07", "Czy mogę zostać wykluczony z przetargu za stare zaległości?",
    "Zamawiający wykluczył moją firmę, bo dwa lata temu nie wykonaliśmy umowy. Od tego czasu wszystko poprawiliśmy. Czy to legalne?",
    "Klient został wykluczony na podstawie przesłanki fakultatywnej z PZP. Proszę o analizę samooczyszczenia i proporcjonalności wykluczenia.",
    "wyjaśnienia dotyczące samooczyszczenia", "proste", "wykluczenia z przetargu")
add("dr-07", "Jak rozliczyć dotację unijną?",
    "Dostałem dofinansowanie z funduszy unijnych na maszynę. Kończy się projekt i nie wiem, co muszę złożyć. Boję się, że będę musiał oddać pieniądze.",
    "Mocodawca jest beneficjentem projektu współfinansowanego z UE. Proszę o analizę obowiązków rozliczeniowych z umowy o dofinansowanie i ryzyka korekty finansowej.",
    "wniosek o płatność końcową", "proste", "rozliczenia dotacji unijnej")
add("dr-07", "Czy zamawiający może zmienić umowę po przetargu?",
    "Wygraliśmy przetarg, ale ceny materiałów wzrosły o 30 procent. Zamawiający nie chce podnieść wynagrodzenia. Co możemy zrobić?",
    "Klient jest wykonawcą zamówienia publicznego, koszty wzrosły istotnie. Proszę o analizę waloryzacji i zmiany umowy z PZP.",
    "wniosek o waloryzację wynagrodzenia", "proste", "waloryzacji umowy z przetargu")
add("dr-07", "Jakie dokumenty złożyć do przetargu?",
    "Pierwszy raz startuję w przetargu publicznym na dostawę komputerów. Nie wiem, co to JEDZ. Jak się przygotować?",
    "Mocodawca przygotowuje ofertę w postępowaniu powyżej progów unijnych. Proszę o analizę JEDZ, podmiotowych środków dowodowych i wadium z PZP.",
    "ofertę przetargową z formularzem ofertowym", "proste", "przygotowania oferty przetargowej")
add("dr-07", "Czy KIO zwraca wpis po wygranej?",
    "Złożyliśmy odwołanie do KIO i zapłaciliśmy duży wpis. Zamawiający uwzględnił odwołanie przed rozprawą. Czy odzyskamy pieniądze?",
    "Klient wniósł odwołanie, zamawiający uwzględnił zarzuty w całości. Proszę o analizę zwrotu wpisu i kosztów postępowania odwoławczego z PZP.",
    "wniosek o zwrot wpisu", "proste", "zwrotu wpisu od odwołania")
add("dr-07", "Czy mogę zaskarżyć wyrok KIO?",
    "KIO oddaliło nasze odwołanie, ale moim zdaniem źle oceniło dowody. Co dalej?",
    "Mocodawca przegrał przed KIO. Proszę o analizę skargi do sądu zamówień publicznych z PZP, terminu i zarzutów.",
    "skargę na orzeczenie KIO", "procesowe", "wyroku KIO")
add("dr-07", "Czy zamawiający może naliczyć karę za opóźnienie dostawy?",
    "Opóźniliśmy dostawę o dwa tygodnie przez braki u producenta. Szpital naliczył nam karę 50 tysięcy. Czy to sprawiedliwe?",
    "Klient jest wykonawcą, zamawiający naliczył karę umowną. Proszę o analizę miarkowania kary z KC i limitów kar z PZP.",
    "pismo z wnioskiem o miarkowanie kary umownej", "proste", "kary za opóźnienie dostawy")
add("dr-07", "Jak działa konsorcjum w przetargu?",
    "Chcemy z kolegą z innej firmy wspólnie wystartować w przetargu. Jak to zrobić, żeby było dobrze?",
    "Mocodawcy planują wspólne ubieganie się o zamówienie. Proszę o analizę odpowiedzialności solidarnej i pełnomocnika konsorcjum z PZP.",
    "umowę konsorcjum", "umowa", "wspólnego startu w przetargu")
add("dr-07", "Czy zamawiający może unieważnić przetarg?",
    "Złożyliśmy najtańszą ofertę, a zamawiający unieważnił przetarg, bo zabrakło mu pieniędzy. Czy możemy coś zrobić?",
    "Klient kwestionuje unieważnienie postępowania z powodu braku środków. Proszę o analizę przesłanek unieważnienia i odwołania z PZP.",
    "odwołanie od unieważnienia postępowania", "procesowe", "unieważnienia przetargu")

add("dr-08", "Jak zaskarżyć uchwałę rady gminy?",
    "Rada gminy uchwaliła nową opłatę za śmieci, która jest dwa razy wyższa dla domów niż mieszkań. Czy mogę to zaskarżyć?",
    "Mocodawca kwestionuje uchwałę rady gminy w sprawie opłaty za gospodarowanie odpadami. Proszę o analizę skargi z ustawy o samorządzie gminnym i interesu prawnego.",
    "skargę na uchwałę rady gminy", "procesowe", "uchwały o opłacie za śmieci")
add("dr-08", "Czy wójt może zabronić zgromadzenia?",
    "Chcieliśmy zorganizować pikietę przed urzędem gminy, ale wójt zakazał. Twierdzi, że zakłóci ruch. Czy może?",
    "Klient, organizator zgromadzenia, otrzymał decyzję zakazującą. Proszę o analizę prawa o zgromadzeniach i odwołania.",
    "odwołanie od zakazu zgromadzenia", "procesowe", "zakazu zgromadzenia")
add("dr-08", "Jak złożyć petycję do rady miasta?",
    "Mieszkańcy osiedla chcą, żeby miasto wybudowało plac zabaw. Zebraliśmy podpisy. Jak to złożyć oficjalnie?",
    "Mocodawcy, grupa mieszkańców, planują wnieść petycję. Proszę o analizę wymogów ustawy o petycjach i terminu rozpatrzenia.",
    "petycję do rady miasta", "proste", "budowy placu zabaw")
add("dr-08", "Czy gmina może sprzedać działkę bez przetargu?",
    "Gmina sprzedała działkę obok mojej firmie radnego bez żadnego przetargu. Wygląda to podejrzanie. Czy to zgodne z prawem?",
    "Klient kwestionuje zbycie nieruchomości gminnej w trybie bezprzetargowym. Proszę o analizę ustawy o gospodarce nieruchomościami i nadzoru wojewody.",
    "skargę do wojewody na sprzedaż działki", "proste", "sprzedaży działki bez przetargu")
add("dr-08", "Jak odwołać wójta w referendum?",
    "Mieszkańcy są niezadowoleni z wójta. Chcemy go odwołać. Ile podpisów trzeba?",
    "Mocodawcy, inicjatorzy referendum, planują odwołanie wójta. Proszę o analizę ustawy o referendum lokalnym i progów ważności.",
    "wniosek o przeprowadzenie referendum lokalnego", "proste", "odwołania wójta")
add("dr-08", "Czy radny może być zatrudniony w gminie?",
    "Nasz radny pracuje jako kierownik w urzędzie gminy. Czy tak można?",
    "Klient pyta o zakaz łączenia mandatu radnego z zatrudnieniem w urzędzie gminy. Proszę o analizę ustawy o samorządzie gminnym i skutków wygaśnięcia mandatu.",
    "wniosek o stwierdzenie wygaśnięcia mandatu radnego", "proste", "zatrudnienia radnego w gminie")
add("dr-08", "Kto odpowiada za dziurawą drogę gminną?",
    "Uszkodziłem oponę i felgę w dziurze na drodze gminnej. Naprawa kosztowała 1200 zł. Kto mi za to zapłaci?",
    "Mocodawca poniósł szkodę na drodze zarządzanej przez gminę. Proszę o analizę odpowiedzialności zarządcy drogi z KC i ustawy o drogach publicznych.",
    "wezwanie gminy do zapłaty odszkodowania", "proste", "szkody na dziurawej drodze")
add("dr-08", "Czy plan miejscowy można zaskarżyć?",
    "Nowy plan zagospodarowania zrobił z mojej działki budowlanej teren zielony. Straciłem na wartości. Co mogę zrobić?",
    "Klient kwestionuje miejscowy plan zagospodarowania przestrzennego. Proszę o analizę skargi z ustawy o samorządzie gminnym i roszczeń z ustawy o planowaniu.",
    "skargę na miejscowy plan zagospodarowania", "procesowe", "planu miejscowego")
add("dr-08", "Jak uzyskać dofinansowanie z budżetu obywatelskiego?",
    "Chcę zgłosić projekt siłowni plenerowej do budżetu obywatelskiego. Jak to zrobić, żeby przeszło?",
    "Mocodawca przygotowuje wniosek do budżetu obywatelskiego. Proszę o analizę regulaminu, uchwały rady i kryteriów formalnych.",
    "wniosek do budżetu obywatelskiego", "proste", "budżetu obywatelskiego")
add("dr-08", "Czy gmina musi odśnieżać chodnik przed moim domem?",
    "Gmina każe mi odśnieżać chodnik przy ulicy, a straż miejska grozi mandatem. Czy to mój obowiązek?",
    "Klient pyta o obowiązek uprzątnięcia chodnika przy nieruchomości. Proszę o analizę ustawy o utrzymaniu czystości i porządku w gminach.",
    "pismo do gminy w sprawie obowiązku odśnieżania", "proste", "odśnieżania chodnika")

add("dr-09", "Czy potrzebuję pozwolenia na budowę altany?",
    "Chcę postawić w ogrodzie altanę 30 metrów kwadratowych. Sąsiad mówi, że bez pozwolenia przyjdzie nadzór. Jak jest naprawdę?",
    "Klient planuje wzniesienie altany o powierzchni 30 m2. Proszę o analizę zwolnień z pozwolenia i zgłoszenia z Prawa budowlanego.",
    "zgłoszenie budowy altany", "proste", "budowy altany")
add("dr-09", "Co zrobić z nakazem rozbiórki?",
    "Nadzór budowlany kazał mi rozebrać taras, który postawiłem bez pozwolenia pięć lat temu. Wydałem na niego 40 tysięcy. Czy da się to zalegalizować?",
    "Mocodawca otrzymał nakaz rozbiórki samowoli budowlanej. Proszę o analizę legalizacji, w tym uproszczonej po 20 latach, i odwołania z Prawa budowlanego.",
    "wniosek o legalizację samowoli budowlanej", "proste", "nakazu rozbiórki tarasu")
add("dr-09", "Jak uzyskać warunki zabudowy?",
    "Kupiłem działkę rolną i chcę postawić dom. W gminie nie ma planu. Od czego zacząć?",
    "Klient wnosi o decyzję o warunkach zabudowy dla działki bez planu miejscowego. Proszę o analizę zasady dobrego sąsiedztwa i ustawy o planowaniu i zagospodarowaniu przestrzennym.",
    "wniosek o wydanie warunków zabudowy", "proste", "warunków zabudowy domu")
add("dr-09", "Czy sąsiad może postawić farmę wiatrową przy moim domu?",
    "Firma chce postawić wiatraki 500 metrów od mojego domu. Boję się hałasu. Czy mogę coś zrobić?",
    "Mocodawca jest właścicielem nieruchomości w sąsiedztwie planowanej elektrowni wiatrowej. Proszę o analizę ustawy odległościowej, decyzji środowiskowej i udziału strony.",
    "uwagi do postępowania w sprawie decyzji środowiskowej", "proste", "farmy wiatrowej przy domu")
add("dr-09", "Jaka kara grozi za wycinkę drzewa?",
    "Wyciąłem stary dąb na swojej działce, bo zagrażał domowi. Gmina chce kary 30 tysięcy. Czy to możliwe?",
    "Klient usunął drzewo bez zezwolenia. Proszę o analizę administracyjnej kary pieniężnej z ustawy o ochronie przyrody i przesłanek odstąpienia.",
    "odwołanie od decyzji o karze za wycinkę drzewa", "procesowe", "kary za wycinkę drzewa")
add("dr-09", "Jak zgłosić instalację fotowoltaiczną?",
    "Chcę założyć panele na dach domu, 9 kilowatów. Czy muszę mieć jakieś pozwolenie?",
    "Mocodawca planuje mikroinstalację fotowoltaiczną. Proszę o analizę wymogów Prawa budowlanego, uzgodnienia ppoż. i zgłoszenia do operatora z Prawa energetycznego.",
    "zgłoszenie mikroinstalacji do operatora sieci", "proste", "fotowoltaiki na dachu")
add("dr-09", "Czy mogę odliczyć prąd od dostawcy przy przerwach?",
    "Przez awarię nie miałem prądu cztery dni. Zepsuła się lodówka. Czy dostawca musi mi coś zapłacić?",
    "Klient doznał szkody wskutek przerwy w dostawie energii. Proszę o analizę bonifikat z Prawa energetycznego i odpowiedzialności odszkodowawczej.",
    "wniosek o bonifikatę za przerwę w dostawie prądu", "proste", "przerwy w dostawie prądu")
add("dr-09", "Kto płaci za odbiór budynku?",
    "Wykonawca skończył budowę domu, ale nie chce zgłosić zakończenia budowy. Mówi, że to moja sprawa. Kto ma rację?",
    "Mocodawca jest inwestorem, wykonawca odmawia czynności przy zakończeniu budowy. Proszę o analizę obowiązków z Prawa budowlanego i umowy o roboty budowlane.",
    "zawiadomienie o zakończeniu budowy", "proste", "zakończenia budowy domu")
add("dr-09", "Gdzie zgłosić wywożenie śmieci do lasu?",
    "Widzę, jak sąsiad wywozi gruz do lasu za wsią. Gdzie to zgłosić?",
    "Klient dysponuje dowodami nielegalnego składowania odpadów. Proszę o analizę ustawy o odpadach i trybu zgłoszenia do inspekcji ochrony środowiska.",
    "zawiadomienie do inspekcji ochrony środowiska", "proste", "wywożenia gruzu do lasu")
add("dr-09", "Czy przewoźnik odpowiada za zniszczony towar?",
    "Firma transportowa dowiozła nam maszynę z uszkodzoną obudową. Na liście przewozowym nic nie wpisaliśmy. Czy możemy żądać odszkodowania?",
    "Mocodawca odebrał przesyłkę z uszkodzeniem bez zastrzeżeń w liście przewozowym. Proszę o analizę reklamacji z Prawa przewozowego i terminów.",
    "reklamację do przewoźnika", "proste", "uszkodzonej przesyłki")

add("dr-10", "Jak złożyć skargę na lekarza?",
    "Lekarz w szpitalu przeoczył złamanie u mojej mamy. Leżała tydzień bez leczenia. Gdzie mogę to zgłosić?",
    "Klientka podnosi błąd diagnostyczny lekarza szpitala. Proszę o analizę odpowiedzialności zawodowej, roszczeń cywilnych i wniosku do wojewódzkiej komisji ds. zdarzeń medycznych.",
    "skargę do rzecznika odpowiedzialności zawodowej lekarzy", "proste", "błędu lekarza")
add("dr-10", "Czy szpital musi dać mi dokumentację medyczną?",
    "Chcę kopię dokumentacji z porodu, a szpital żąda 300 zł i każe czekać miesiąc. Czy to zgodne z prawem?",
    "Mocodawczyni żąda udostępnienia dokumentacji medycznej. Proszę o analizę ustawy o prawach pacjenta, opłat i terminów.",
    "wniosek o udostępnienie dokumentacji medycznej", "proste", "dokumentacji medycznej z porodu")
add("dr-10", "Jak dostać odszkodowanie za zakażenie w szpitalu?",
    "Po operacji kolana złapałem w szpitalu bakterię. Byłem na zwolnieniu pół roku. Czy należy mi się odszkodowanie?",
    "Klient doznał zakażenia szpitalnego po zabiegu. Proszę o analizę roszczeń z KC, domniemania faktycznego winy i trybu z ustawy o prawach pacjenta.",
    "wezwanie szpitala do zapłaty zadośćuczynienia", "proste", "zakażenia szpitalnego")
add("dr-10", "Czy mogę sprzedawać suplementy przez internet?",
    "Chcę otworzyć sklep internetowy z suplementami diety. Czy muszę je gdzieś rejestrować?",
    "Mocodawca planuje wprowadzenie suplementów diety do obrotu. Proszę o analizę powiadomienia GIS z ustawy o bezpieczeństwie żywności i zakazów reklamy.",
    "powiadomienie GIS o wprowadzeniu suplementu", "proste", "sprzedaży suplementów diety")
add("dr-10", "Jak założyć prywatną praktykę lekarską?",
    "Jestem lekarzem i chcę otworzyć własny gabinet. Jakie formalności muszę załatwić?",
    "Klient, lekarz, zakłada indywidualną praktykę. Proszę o analizę wpisu do rejestru podmiotów wykonujących działalność leczniczą z ustawy o działalności leczniczej.",
    "wniosek o wpis do rejestru podmiotów wykonujących działalność leczniczą", "proste", "prywatnej praktyki lekarskiej")
add("dr-10", "Czy rolnik dostanie odszkodowanie za suszę?",
    "Susza zniszczyła mi połowę zboża. Słyszałem o pomocy z ARiMR. Jak ją dostać?",
    "Mocodawca, rolnik, poniósł straty w uprawach wskutek suszy. Proszę o analizę pomocy klęskowej, protokołu komisji i ubezpieczeń upraw.",
    "wniosek o pomoc suszową", "proste", "strat w uprawach przez suszę")
add("dr-10", "Czy apteka może odmówić sprzedaży leku?",
    "Farmaceutka odmówiła mi sprzedaży tabletek, bo jej zdaniem recepta była źle wypisana. Lekarz mówi, że wszystko w porządku. Kto ma rację?",
    "Klient kwestionuje odmowę realizacji recepty. Proszę o analizę Prawa farmaceutycznego i przepisów o receptach.",
    "skargę do wojewódzkiego inspektora farmaceutycznego", "proste", "odmowy wydania leku")
add("dr-10", "Jakie prawa ma pacjent w szpitalu psychiatrycznym?",
    "Brata przyjęli do szpitala psychiatrycznego bez jego zgody. Nikt nam nic nie mówi. Co możemy zrobić?",
    "Mocodawca reprezentuje rodzinę osoby przyjętej bez zgody. Proszę o analizę ustawy o ochronie zdrowia psychicznego i kontroli sądu opiekuńczego.",
    "wniosek do sądu opiekuńczego o zbadanie zasadności przyjęcia", "procesowe", "przyjęcia do szpitala psychiatrycznego bez zgody")
add("dr-10", "Czy weterynarz odpowiada za śmierć psa?",
    "Pies zmarł po rutynowym zabiegu kastracji. Weterynarz mówi, że to powikłanie. Czy mogę żądać odszkodowania?",
    "Klientka podnosi błąd lekarza weterynarii skutkujący śmiercią zwierzęcia. Proszę o analizę odpowiedzialności kontraktowej z KC i dowodu z opinii biegłego.",
    "wezwanie weterynarza do zapłaty odszkodowania", "proste", "śmierci psa po zabiegu")
add("dr-10", "Czy sanepid może zamknąć restaurację?",
    "Sanepid przyszedł na kontrolę i zamknął moją restaurację na tydzień. Tracę pieniądze. Czy mogli tak zrobić?",
    "Mocodawca otrzymał decyzję organu Państwowej Inspekcji Sanitarnej o unieruchomieniu zakładu. Proszę o analizę rygoru natychmiastowej wykonalności i odwołania.",
    "odwołanie od decyzji sanepidu", "procesowe", "zamknięcia restauracji przez sanepid")

add("dr-11", "Co zrobić, gdy firma wyciekła moje dane?",
    "Dostałem maila, że ze sklepu internetowego wyciekły moje dane i hasło. Teraz dostaję podejrzane SMS-y. Co mogę zrobić?",
    "Klient jest osobą, której dane objęło naruszenie ochrony u administratora. Proszę o analizę roszczeń z art. 82 RODO i skargi do Prezesa UODO.",
    "skargę do Prezesa UODO", "proste", "wycieku moich danych")
add("dr-11", "Czy firma może nagrywać pracowników kamerą?",
    "Szef zamontował kamery w pokoju socjalnym i nawet przy szatni. Nikt nas nie pytał. Czy to legalne?",
    "Mocodawcy, pracownicy, kwestionują monitoring w pomieszczeniach socjalnych. Proszę o analizę KP i RODO w zakresie monitoringu wizyjnego.",
    "zawiadomienie do Państwowej Inspekcji Pracy", "proste", "kamer w pokoju socjalnym")
add("dr-11", "Jak usunąć moje zdjęcie z internetu?",
    "Ktoś wrzucił na portal moje zdjęcie z imprezy z obraźliwym podpisem. Portal nie reaguje. Jak to usunąć?",
    "Klientka żąda usunięcia wizerunku z serwisu internetowego. Proszę o analizę prawa do bycia zapomnianym z RODO, ochrony wizerunku i obowiązków dostawcy usług z DSA.",
    "żądanie usunięcia danych osobowych", "proste", "zdjęcia w internecie")
add("dr-11", "Czy mogę użyć cudzego zdjęcia na stronie firmy?",
    "Wziąłem zdjęcie z Google na stronę mojej firmy. Teraz fotograf żąda 5000 zł. Czy muszę płacić?",
    "Mocodawca wykorzystał utwór fotograficzny bez licencji. Proszę o analizę roszczeń z ustawy o prawie autorskim i wysokości wynagrodzenia.",
    "odpowiedź na wezwanie fotografa", "proste", "zdjęcia użytego bez zgody")
add("dr-11", "Czy mój system AI podlega AI Act?",
    "Mam startup, który robi oprogramowanie oceniające CV kandydatów sztuczną inteligencją. Czy muszę coś spełniać?",
    "Klient wdraża system AI do rekrutacji. Proszę o analizę kwalifikacji jako systemu wysokiego ryzyka z AI Act i obowiązków dostawcy.",
    "procedurę zgodności z AI Act", "proste", "systemu AI do rekrutacji")
add("dr-11", "Jak zastrzec znak towarowy?",
    "Wymyśliłem nazwę dla mojej marki kosmetyków. Boję się, że ktoś mi ją ukradnie. Jak ją chronić?",
    "Mocodawca zamierza zgłosić znak towarowy. Proszę o analizę zdolności rejestrowej, klas nicejskich i zgłoszenia do UPRP lub EUIPO.",
    "zgłoszenie znaku towarowego", "proste", "zastrzeżenia nazwy marki")
add("dr-11", "Czy firma musi mieć inspektora ochrony danych?",
    "Prowadzę przychodnię z pięcioma lekarzami. Ktoś mi powiedział, że muszę zatrudnić IOD. Czy to prawda?",
    "Klient przetwarza dane szczególnych kategorii na dużą skalę. Proszę o analizę obowiązku wyznaczenia IOD z RODO.",
    "zawiadomienie o wyznaczeniu inspektora ochrony danych", "proste", "inspektora ochrony danych")
add("dr-11", "Co grozi za włamanie na cudzy Facebook?",
    "Ktoś przejął moje konto na Facebooku i wysyła prośby o BLIK do znajomych. Co mogę zrobić?",
    "Mocodawca padł ofiarą przejęcia konta. Proszę o analizę kwalifikacji z art. 267 KK i oszustwa komputerowego oraz zabezpieczenia dowodów.",
    "zawiadomienie o przestępstwie przejęcia konta", "proste", "przejęcia konta na Facebooku", True)
add("dr-11", "Czy sklep internetowy może mi zablokować konto?",
    "Platforma sprzedażowa zablokowała mi konto sprzedawcy bez uzasadnienia. Mam tam towar za 20 tysięcy. Co robić?",
    "Klient, sprzedawca, został zablokowany przez platformę. Proszę o analizę rozporządzenia P2B i DSA w zakresie uzasadnienia i odwołania.",
    "odwołanie od blokady konta sprzedawcy", "proste", "blokady konta na platformie")
add("dr-11", "Czy NIS2 dotyczy mojej firmy?",
    "Prowadzę firmę hostingową, 60 osób. Słyszałem o nowej dyrektywie o cyberbezpieczeństwie. Czy muszę coś robić?",
    "Mocodawca świadczy usługi hostingowe. Proszę o analizę statusu podmiotu kluczowego lub ważnego z ustawy o KSC wdrażającej NIS2 i obowiązków.",
    "politykę bezpieczeństwa zgodną z KSC", "proste", "obowiązków z NIS2")

add("dr-03", "Jak złożyć skargę na komornika?",
    "Komornik zajął mi samochód, który nie jest mój, tylko żony. Nie chce słuchać. Co robić?",
    "Mocodawca kwestionuje zajęcie ruchomości stanowiącej własność osoby trzeciej. Proszę o analizę skargi na czynność komornika i powództwa przeciwegzekucyjnego z KPC.",
    "skargę na czynność komornika", "procesowe", "zajęcia samochodu żony")
add("dr-12", "Jak złożyć skargę na adwokata?",
    "Adwokat wziął zaliczkę 5000 zł i przegapił termin na apelację. Nie odbiera telefonu. Gdzie mogę go zgłosić?",
    "Klient zarzuca pełnomocnikowi zaniedbanie terminu. Proszę o analizę odpowiedzialności dyscyplinarnej z Prawa o adwokaturze i odszkodowawczej z OC.",
    "skargę do rzecznika dyscyplinarnego izby adwokackiej", "proste", "zaniedbania adwokata")
add("dr-12", "Ile kosztuje wniesienie pozwu?",
    "Chcę pozwać firmę o 30 tysięcy. Ile zapłacę opłaty sądowej i czy mogę się z niej zwolnić?",
    "Mocodawca wytacza powództwo o zapłatę 30 000 zł. Proszę o analizę opłaty z ustawy o kosztach sądowych i przesłanek zwolnienia.",
    "wniosek o zwolnienie od kosztów sądowych", "procesowe", "kosztów pozwu")
add("dr-12", "Czy mogę złożyć skargę na przewlekłość postępowania?",
    "Moja sprawa w sądzie trwa już cztery lata, a rozprawy są co pół roku. Czy mogę coś zrobić?",
    "Klient jest stroną postępowania cywilnego trwającego ponad cztery lata. Proszę o analizę skargi na przewlekłość z ustawy o skardze i wysokości sumy pieniężnej.",
    "skargę na przewlekłość postępowania", "procesowe", "przewlekłości postępowania")
add("dr-12", "Jak wyłączyć sędziego ze sprawy?",
    "Sędzia w mojej sprawie jest znajomym mojego byłego męża. Widziałam ich razem. Czy mogę żądać zmiany sędziego?",
    "Mocodawczyni powzięła wiedzę o relacji sędziego ze stroną przeciwną. Proszę o analizę wyłączenia sędziego z KPC.",
    "wniosek o wyłączenie sędziego", "procesowe", "wyłączenia sędziego")
add("dr-12", "Ile kosztuje notariusz przy sprzedaży mieszkania?",
    "Sprzedaję mieszkanie za 500 tysięcy. Ile zapłacę notariuszowi i kto płaci, kupujący czy ja?",
    "Klient zbywa lokal o wartości 500 000 zł. Proszę o analizę maksymalnej taksy z rozporządzenia w sprawie taksy notarialnej i podziału kosztów.",
    "projekt umowy sprzedaży mieszkania", "umowa", "kosztów notariusza")
add("dr-12", "Jak dostać adwokata z urzędu?",
    "Mam sprawę w sądzie, ale nie stać mnie na prawnika. Zarabiam najniższą krajową. Czy sąd może mi kogoś przydzielić?",
    "Mocodawca wnosi o ustanowienie pełnomocnika z urzędu. Proszę o analizę przesłanek z KPC i oświadczenia o stanie majątkowym.",
    "wniosek o ustanowienie pełnomocnika z urzędu", "procesowe", "adwokata z urzędu")
add("dr-03", "Czy prokurator może umorzyć sprawę bez przesłuchania mnie?",
    "Złożyłem zawiadomienie o oszustwie, a prokuratura umorzyła sprawę bez przesłuchania mnie. Co mogę zrobić?",
    "Klient jako pokrzywdzony otrzymał postanowienie o umorzeniu dochodzenia. Proszę o analizę zażalenia z KPK i subsydiarnego aktu oskarżenia.",
    "zażalenie na umorzenie postępowania", "procesowe", "umorzenia sprawy przez prokuraturę", True)
add("dr-12", "Czy radca prawny może reprezentować mnie w sprawie karnej?",
    "Mój radca prawny prowadzi moją firmę. Teraz mam sprawę karną. Czy może być moim obrońcą?",
    "Mocodawca pyta o uprawnienia radcy prawnego do obrony w procesie karnym. Proszę o analizę ustawy o radcach prawnych i KPK.",
    "upoważnienie do obrony", "proste", "obrońcy w sprawie karnej")
add("dr-12", "Jak zażalić się na koszty zasądzone przez sąd?",
    "Wygrałem sprawę, ale sąd zasądził mi zwrot kosztów tylko połowy wynagrodzenia prawnika. Czy mogę to zmienić?",
    "Klient kwestionuje rozstrzygnięcie o kosztach postępowania. Proszę o analizę zażalenia z KPC i stawek z rozporządzenia o opłatach za czynności adwokackie.",
    "zażalenie na postanowienie o kosztach", "procesowe", "kosztów zasądzonych przez sąd")

add("dr-13", "Czy policja może sprawdzić mój telefon?",
    "Na kontroli drogowej policjant kazał mi odblokować telefon. Odmówiłem. Czy miałem prawo?",
    "Klient odmówił udostępnienia zawartości telefonu podczas kontroli. Proszę o analizę ustawy o Policji i KPK w zakresie przeszukania i zatrzymania rzeczy.",
    "zażalenie na zatrzymanie telefonu", "procesowe", "sprawdzania telefonu przez policję")
add("dr-13", "Jak uzyskać poświadczenie bezpieczeństwa?",
    "Dostałem ofertę pracy w firmie zbrojeniowej. Wymagają poświadczenia bezpieczeństwa. Jak to się załatwia?",
    "Mocodawca ubiega się o poświadczenie bezpieczeństwa do informacji niejawnych. Proszę o analizę postępowania sprawdzającego z ustawy o ochronie informacji niejawnych.",
    "ankietę bezpieczeństwa osobowego", "proste", "poświadczenia bezpieczeństwa")
add("dr-13", "Czy ABW może mnie podsłuchiwać?",
    "Podejrzewam, że jestem podsłuchiwany, bo dziwne rzeczy dzieją się z telefonem. Pracuję w administracji. Jak to sprawdzić?",
    "Klient pyta o kontrolę operacyjną wobec niego. Proszę o analizę ustawy o ABW, zgody sądu i uprawnień informacyjnych.",
    "wniosek o informację o kontroli operacyjnej", "proste", "podsłuchu przez służby")
add("dr-13", "Jak odwołać się od odmowy pozwolenia na broń?",
    "Policja odmówiła mi pozwolenia na broń sportową, choć mam licencję i patent. Co mogę zrobić?",
    "Mocodawca otrzymał decyzję odmowną komendanta wojewódzkiego Policji. Proszę o analizę ustawy o broni i amunicji i odwołania.",
    "odwołanie od odmowy pozwolenia na broń", "procesowe", "pozwolenia na broń")
add("dr-13", "Czy żołnierz może odmówić wyjazdu na misję?",
    "Syn jest żołnierzem zawodowym. Kierują go na misję za granicę, a on ma chorą żonę. Czy może odmówić?",
    "Klient, żołnierz zawodowy, otrzymał skierowanie do jednostki poza granicami. Proszę o analizę ustawy o obronie Ojczyzny i trybu odwoławczego.",
    "odwołanie od rozkazu personalnego", "proste", "wyjazdu żołnierza na misję")
add("dr-13", "Czy strażnik graniczny może mnie zatrzymać na lotnisku?",
    "Na lotnisku Straż Graniczna zatrzymała mnie na trzy godziny bez wyjaśnień. Spóźniłem się na samolot. Czy to legalne?",
    "Mocodawca został zatrzymany przez Straż Graniczną. Proszę o analizę ustawy o Straży Granicznej, KPK i zażalenia na zatrzymanie.",
    "zażalenie na zatrzymanie", "procesowe", "zatrzymania na lotnisku")
add("dr-13", "Jak złożyć skargę na policjanta?",
    "Policjant podczas interwencji mnie wyzywał i popchnął. Mam nagranie. Gdzie to zgłosić?",
    "Klient zarzuca funkcjonariuszowi przekroczenie uprawnień. Proszę o analizę skargi z KPA, postępowania dyscyplinarnego i art. 231 KK.",
    "skargę na funkcjonariusza Policji", "proste", "zachowania policjanta", True)
add("dr-13", "Czy mogę dostać informacje z IPN o sobie?",
    "Chcę sprawdzić, czy SB miała na mnie teczkę w latach 80. Jak to zrobić?",
    "Mocodawca wnosi o dostęp do dokumentów organów bezpieczeństwa państwa. Proszę o analizę ustawy o IPN i trybu wniosku.",
    "wniosek do IPN o udostępnienie dokumentów", "proste", "teczki w IPN")
add("dr-13", "Czy firma ochroniarska może mnie przeszukać?",
    "Ochrona w galerii kazała mi pokazać zawartość plecaka. Odmówiłam, a oni mnie przytrzymali. Czy mieli prawo?",
    "Klientka została zatrzymana przez pracowników ochrony. Proszę o analizę ustawy o ochronie osób i mienia oraz obywatelskiego ujęcia z KPK.",
    "skargę na pracowników ochrony", "proste", "przeszukania przez ochronę")
add("dr-13", "Jak zostać policjantem z wyrokiem w zawieszeniu?",
    "Mam wyrok w zawieszeniu za bójkę sprzed pięciu lat. Chcę iść do policji. Czy to mnie dyskwalifikuje?",
    "Mocodawca, kandydat do służby, był karany. Proszę o analizę wymogu niekaralności z ustawy o Policji i zatarcia skazania z KK.",
    "wniosek o zatarcie skazania", "procesowe", "kandydowania do policji z wyrokiem", True)

add("dr-14", "Jak złożyć skargę do Europejskiego Trybunału Praw Człowieka?",
    "Moja sprawa w Polsce trwała 10 lat i przegrałem we wszystkich instancjach. Słyszałem o Strasburgu. Czy mogę tam pójść?",
    "Klient wyczerpał krajowe środki odwoławcze. Proszę o analizę dopuszczalności skargi do ETPC, terminu czterech miesięcy i zarzutów z EKPC.",
    "skargę do Europejskiego Trybunału Praw Człowieka", "procesowe", "naruszenia praw człowieka")
add("dr-14", "Czy mogę pracować w Niemczech bez pozwolenia?",
    "Dostałem ofertę pracy w Berlinie. Jestem Polakiem. Czy potrzebuję jakichś pozwoleń?",
    "Mocodawca, obywatel UE, podejmuje zatrudnienie w innym państwie członkowskim. Proszę o analizę swobody przepływu pracowników z TFUE i koordynacji zabezpieczenia społecznego.",
    "wniosek o formularz A1", "proste", "pracy w Niemczech")
add("dr-14", "Czy przepis unijny jest ważniejszy niż polski?",
    "Sąd odmówił mi zwrotu opłaty, choć według dyrektywy mi się należy. Czy polski sąd musi stosować prawo unijne?",
    "Klient powołuje się na dyrektywę niewdrożoną prawidłowo. Proszę o analizę zasady pierwszeństwa, skutku bezpośredniego i pytania prejudycjalnego do TSUE.",
    "wniosek o skierowanie pytania prejudycjalnego do TSUE", "procesowe", "pierwszeństwa prawa unijnego")
add("dr-14", "Jak uznać zagraniczny wyrok rozwodowy w Polsce?",
    "Rozwiodłam się w Wielkiej Brytanii. Teraz chcę wziąć ślub w Polsce. Czy ten rozwód jest tu ważny?",
    "Mocodawczyni uzyskała rozwód przed sądem państwa trzeciego. Proszę o analizę uznania orzeczenia z KPC i wpisu do aktu stanu cywilnego.",
    "wniosek o uznanie zagranicznego orzeczenia rozwodowego", "procesowe", "zagranicznego rozwodu")
add("dr-14", "Jakie prawa mam jako pasażer przy opóźnieniu lotu?",
    "Lot z Warszawy do Barcelony był opóźniony o pięć godzin. Linia mówi, że to przez pogodę. Czy należy mi się odszkodowanie?",
    "Klient doznał opóźnienia lotu ponad trzy godziny. Proszę o analizę rozporządzenia 261/2004, nadzwyczajnych okoliczności i orzecznictwa TSUE.",
    "wniosek do przewoźnika o odszkodowanie za opóźniony lot", "proste", "opóźnionego lotu")
add("dr-14", "Czy mogę ściągnąć alimenty od ojca w Holandii?",
    "Ojciec mojego dziecka wyjechał do Holandii i nie płaci alimentów. Mam polski wyrok. Jak to wyegzekwować?",
    "Mocodawczyni posiada polskie orzeczenie alimentacyjne, dłużnik przebywa w Niderlandach. Proszę o analizę rozporządzenia 4/2009 i trybu przez sąd okręgowy.",
    "wniosek o egzekucję alimentów za granicą", "procesowe", "alimentów od ojca w Holandii")
add("dr-14", "Czy uchodźca może dostać ochronę w Polsce?",
    "Jestem z Białorusi, w kraju grozi mi więzienie za udział w protestach. Czy mogę zostać w Polsce?",
    "Klient, obywatel Białorusi, obawia się prześladowań. Proszę o analizę statusu uchodźcy z Konwencji genewskiej i ustawy o udzielaniu cudzoziemcom ochrony.",
    "wniosek o udzielenie ochrony międzynarodowej", "proste", "ochrony międzynarodowej")
add("dr-14", "Czy firma z Polski może sprzedawać do Francji bez rejestracji?",
    "Prowadzę sklep internetowy i coraz więcej klientów jest z Francji. Czy muszę tam coś rejestrować?",
    "Mocodawca prowadzi sprzedaż wysyłkową do konsumentów w UE. Proszę o analizę swobody świadczenia usług, procedury OSS w VAT i prawa właściwego dla umów konsumenckich.",
    "rejestrację do procedury OSS", "proste", "sprzedaży do Francji")
add("dr-14", "Jak uprowadzenie dziecka za granicę jest traktowane?",
    "Była żona wywiozła syna do Irlandii bez mojej zgody i nie chce wrócić. Mamy wspólną władzę rodzicielską. Co robić?",
    "Klient wnosi o powrót dziecka uprowadzonego do Irlandii. Proszę o analizę Konwencji haskiej z 1980 roku i rozporządzenia Bruksela II ter.",
    "wniosek o wydanie dziecka w trybie konwencji haskiej", "procesowe", "uprowadzenia syna do Irlandii")
add("dr-14", "Czy sankcje UE dotyczą mojej firmy?",
    "Moja firma sprzedaje części maszyn do Kazachstanu. Kontrahent pyta o dostawy dalej. Czy mogę mieć problem z sankcjami?",
    "Mocodawca eksportuje towary podwójnego zastosowania do państwa trzeciego. Proszę o analizę rozporządzeń sankcyjnych UE i ryzyka obchodzenia sankcji.",
    "procedurę weryfikacji kontrahentów pod kątem sankcji", "proste", "sankcji UE w eksporcie")

add("dr-15", "Czy moja firma musi mieć procedurę dla sygnalistów?",
    "Zatrudniam 60 osób. Słyszałem, że muszę mieć jakiś system zgłaszania nieprawidłowości. Od kiedy i co to ma być?",
    "Klient zatrudnia ponad 50 osób. Proszę o analizę obowiązku procedury zgłoszeń wewnętrznych z ustawy o ochronie sygnalistów i terminów konsultacji.",
    "procedurę zgłoszeń wewnętrznych", "proste", "procedury dla sygnalistów")
add("dr-15", "Jak przygotować się do audytu ISO 27001?",
    "Klient wymaga od nas certyfikatu ISO 27001. Nigdy tego nie robiliśmy. Od czego zacząć?",
    "Mocodawca przygotowuje się do certyfikacji ISMS. Proszę o analizę wymagań normy, deklaracji stosowania i powiązań z RODO i KSC.",
    "politykę bezpieczeństwa informacji", "proste", "audytu ISO 27001")
add("dr-15", "Czy sygnalista może zostać zwolniony?",
    "Zgłosiłem przełożonemu, że firma fałszuje faktury. Tydzień później dostałem wypowiedzenie. Czy to zemsta i co mogę zrobić?",
    "Klient dokonał zgłoszenia nieprawidłowości, następnie otrzymał wypowiedzenie. Proszę o analizę zakazu działań odwetowych z ustawy o ochronie sygnalistów i roszczeń z KP.",
    "odwołanie od wypowiedzenia z powołaniem na ochronę sygnalisty", "procesowe", "zwolnienia sygnalisty")
add("dr-15", "Jak zrobić politykę antykorupcyjną w firmie?",
    "Nasz zagraniczny kontrahent wymaga od nas polityki antykorupcyjnej. Nie wiem, co powinna zawierać.",
    "Mocodawca wdraża program compliance antykorupcyjnego. Proszę o analizę wymogów kontrahenta, UK Bribery Act i odpowiedzialności podmiotów zbiorowych.",
    "politykę antykorupcyjną", "proste", "polityki antykorupcyjnej")
add("dr-15", "Kto w zarządzie odpowiada za compliance?",
    "Jestem członkiem zarządu spółki. Pojawiły się nieprawidłowości w dziale zakupów. Czy mogę za to odpowiadać osobiście?",
    "Klient, członek zarządu, pyta o odpowiedzialność za brak nadzoru nad zgodnością. Proszę o analizę KSH, business judgment rule i odpowiedzialności podmiotów zbiorowych.",
    "uchwałę zarządu o podziale odpowiedzialności za compliance", "proste", "odpowiedzialności zarządu za compliance")
add("dr-15", "Jak przeprowadzić wewnętrzne dochodzenie w firmie?",
    "Podejrzewamy, że pracownik działu finansów wyprowadza pieniądze. Jak to sprawdzić zgodnie z prawem?",
    "Mocodawca planuje postępowanie wyjaśniające wobec pracownika. Proszę o analizę granic kontroli pracownika z KP i RODO oraz zabezpieczenia dowodów.",
    "regulamin postępowania wyjaśniającego", "proste", "wewnętrznego dochodzenia")
add("dr-15", "Czy spółka musi mieć komitet audytu?",
    "Nasza spółka weszła na giełdę. Biegły rewident pyta o komitet audytu. Czy musimy go mieć?",
    "Klient jest jednostką zainteresowania publicznego. Proszę o analizę obowiązku powołania komitetu audytu z ustawy o biegłych rewidentach i jego składu.",
    "regulamin komitetu audytu", "proste", "komitetu audytu")
add("dr-15", "Jak ocenić ryzyko prawne dostawcy?",
    "Chcemy podpisać dużą umowę z nowym dostawcą z Azji. Jak sprawdzić, czy nie wpakujemy się w kłopoty?",
    "Mocodawca prowadzi due diligence kontrahenta. Proszę o analizę zakresu weryfikacji, sankcji, łańcucha dostaw i klauzul compliance.",
    "kwestionariusz due diligence dostawcy", "proste", "weryfikacji dostawcy")
add("dr-15", "Co musi zawierać raport ESG?",
    "Zarząd każe mi przygotować raport ESG. Nie wiem, czy to obowiązkowe dla nas. Zatrudniamy 300 osób.",
    "Klient jest dużą jednostką objętą CSRD. Proszę o analizę obowiązków sprawozdawczych z ustawy o rachunkowości i standardów ESRS.",
    "raport zrównoważonego rozwoju", "proste", "raportu ESG")
add("dr-15", "Czy firma musi szkolić pracowników z RODO?",
    "Kontrola zarzuciła nam, że pracownicy nie znają zasad ochrony danych. Czy szkolenia są obowiązkowe?",
    "Mocodawca otrzymał zalecenia pokontrolne. Proszę o analizę zasady rozliczalności z RODO i dokumentowania szkoleń.",
    "program szkoleń z ochrony danych", "proste", "szkoleń z RODO")

add("dr-02", "Jak napisać apelację od wyroku?",
    "Przegrałem sprawę o zapłatę w sądzie rejonowym. Wyrok dostałem z uzasadnieniem tydzień temu. Uważam, że sąd źle ocenił świadków.",
    "Mocodawca przegrał w pierwszej instancji. Proszę o analizę zarzutów apelacyjnych naruszenia art. 233 KPC i terminu na wniesienie apelacji.",
    "apelację od wyroku", "procesowe", "przegranej sprawy o zapłatę")
add("dr-16", "Jak przygotować świadka do rozprawy?",
    "Moja koleżanka będzie świadkiem w mojej sprawie o mobbing. Boi się, co ją zapytają. Jak ją przygotować?",
    "Klient prowadzi spór, w którym kluczowe jest przesłuchanie świadka. Proszę o analizę zakresu pytań i granic przygotowania świadka.",
    "plan przesłuchania świadka", "proste", "przygotowania świadka")
add("dr-02", "Jak policzyć odsetki od zaległej faktury?",
    "Kontrahent spóźnił się z zapłatą 50 tysięcy o pół roku. Chcę doliczyć odsetki. Jak to policzyć?",
    "Mocodawca dochodzi odsetek za opóźnienie w transakcji handlowej. Proszę o analizę stopy odsetek ustawowych i rekompensaty z ustawy o przeciwdziałaniu nadmiernym opóźnieniom.",
    "wezwanie do zapłaty z wyliczeniem odsetek", "proste", "odsetek od faktury")
add("dr-02", "Jak napisać sprzeciw od nakazu zapłaty?",
    "Dostałem nakaz zapłaty na 8000 zł za usługę, której nie zamawiałem. Mam dwa tygodnie. Co robić?",
    "Klient otrzymał nakaz zapłaty w postępowaniu upominawczym. Proszę o analizę zarzutów sprzeciwu z KPC i wniosków dowodowych.",
    "sprzeciw od nakazu zapłaty", "procesowe", "nakazu zapłaty")
add("dr-02", "Jakie dowody zgłosić w pozwie?",
    "Chcę pozwać firmę remontową za źle położone płytki. Mam zdjęcia i SMS-y. Czy to wystarczy?",
    "Mocodawca przygotowuje powództwo o naprawienie szkody z wadliwego wykonania robót. Proszę o analizę materiału dowodowego, prekluzji i dowodu z opinii biegłego.",
    "pozew o odszkodowanie za wadliwy remont", "procesowe", "źle położonych płytek")
add("dr-16", "Jak znaleźć orzeczenia w podobnej sprawie?",
    "Chcę wiedzieć, jak sądy rozstrzygają sprawy o kary umowne dla deweloperów. Gdzie to znaleźć?",
    "Klient potrzebuje przeglądu orzecznictwa w sprawach kar umownych z umów deweloperskich. Proszę o analizę linii orzeczniczej SN i sądów apelacyjnych.",
    "zestawienie orzecznictwa", "proste", "kar umownych dla deweloperów")
add("dr-02", "Jak napisać odpowiedź na pozew?",
    "Dostałam pozew od byłego wspólnika o 100 tysięcy. Sąd dał mi miesiąc na odpowiedź. Co w niej napisać?",
    "Mocodawczyni jest pozwaną w sporze między byłymi wspólnikami. Proszę o analizę strategii obrony, zarzutów merytorycznych i formalnych.",
    "odpowiedź na pozew", "procesowe", "pozwu od byłego wspólnika")
add("dr-02", "Czy warto iść na mediację?",
    "Sąd zaproponował nam mediację w sprawie o podział majątku z byłym mężem. Czy to się opłaca?",
    "Klientka jest uczestniczką postępowania o podział majątku. Proszę o analizę korzyści mediacji, ugody i kosztów.",
    "wniosek o skierowanie sprawy do mediacji", "procesowe", "mediacji przy podziale majątku")
add("dr-02", "Jak napisać zażalenie na postanowienie sądu?",
    "Sąd oddalił mój wniosek o zabezpieczenie konta dłużnika. Boję się, że wyprowadzi pieniądze. Co mogę zrobić?",
    "Mocodawca otrzymał postanowienie oddalające wniosek o zabezpieczenie. Proszę o analizę zażalenia z KPC i uprawdopodobnienia interesu prawnego.",
    "zażalenie na postanowienie o oddaleniu wniosku o zabezpieczenie", "procesowe", "zabezpieczenia konta dłużnika")
add("dr-16", "Jak przygotować chronologię sprawy?",
    "Mam pudło dokumentów ze sporu z firmą budowlaną. Nie wiem, co było kiedy. Jak to uporządkować przed sprawą?",
    "Klient dysponuje obszerną dokumentacją sporu budowlanego. Proszę o analizę przebiegu zdarzeń i ustalenie osi czasu z kluczowymi terminami.",
    "chronologię sprawy", "proste", "sporu z firmą budowlaną")
