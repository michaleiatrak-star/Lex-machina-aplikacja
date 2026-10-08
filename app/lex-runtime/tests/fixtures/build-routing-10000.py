"""Builds routing-10000.json: 10 000 chat messages composed from matters, frames and
topics written separately from routing-5000 (a holdout for the routing tuned there).

Same fields as routing-5000. Domain labels follow prawo-polskie-v2 "Routing
błyskawiczny". Deterministic (seeded). Run: python3 -I build-routing-10000.py
"""
import json
import os
import random
import re

HERE = os.path.dirname(os.path.abspath(__file__))
rng = random.Random(10000)

# Matters per domain, in the words of a client (none copied from routing-5000).
MATTERS = {
    "dr-01": [
        "posłowie przegłosowali ustawę w nocy bez czytania w komisji", "prezydent nie podpisał ustawy o mediach",
        "chcę zgłosić obywatelski projekt ustawy o ochronie zwierząt", "Trybunał Konstytucyjny nie opublikował wyroku",
        "partia nie złożyła sprawozdania finansowego do PKW", "senator ma postępowanie o uchylenie immunitetu",
        "rząd wprowadził stan klęski żywiołowej po powodzi", "ustawa podatkowa działa wstecz od stycznia",
        "nie zgadzam się z wynikiem wyborów prezydenckich w mojej komisji", "Rzecznik Praw Obywatelskich nie odpowiada na mój wniosek",
        "minister wydał rozporządzenie wykraczające poza ustawę", "chcemy zorganizować referendum ogólnokrajowe",
        "skarga konstytucyjna na przepis o eksmisji na bruk", "Sejm uchwalił ustawę z naruszeniem trybu",
    ],
    "dr-02": [
        "teściowa nie chce wydać rzeczy po rozwodzie", "kupiłam pralkę, która zepsuła się po tygodniu, a sklep odsyła mnie do serwisu",
        "były mąż nie płaci alimentów na córkę od roku", "brat sprzedał mieszkanie po mamie bez mojej wiedzy",
        "najemca zniszczył mieszkanie i wyprowadził się bez płacenia", "deweloper nie usunął usterek w nowym mieszkaniu",
        "bank naliczył mi prowizję za wcześniejszą spłatę kredytu", "kontrahent nie płaci za wykonane usługi remontowe",
        "testament dziadka pomija moją mamę", "sąsiad postawił płot na mojej działce",
        "chcę rozwiązać spółkę cywilną ze wspólnikiem", "przewoźnik zgubił mój bagaż i nie chce zapłacić",
        "biuro podróży odwołało wycieczkę i nie oddaje zaliczki", "parabank żąda ode mnie odsetek wyższych niż pożyczka",
        "pies sąsiada ugryzł mnie na spacerze", "wspólnota nie naprawia przeciekającego dachu",
        "chcę ustalić kontakty z wnukami", "spadek po wujku obciążony długami",
    ],
    "dr-03": [
        "kolega z pracy ukradł mi telefon", "ktoś wyłudził ode mnie pieniądze metodą na wnuczka",
        "zostałem zatrzymany za jazdę po alkoholu na rowerze", "partner mnie bije i grozi mi",
        "sprzedawca z Allegro oszukał mnie na 3 tysiące", "policja znalazła u syna amfetaminę",
        "ktoś rozpowszechnia moje intymne zdjęcia", "byłem świadkiem pobicia i dostałem wezwanie na policję",
        "dostałem zarzut fałszowania faktur", "prokurator chce dla mnie kary pozbawienia wolności za oszustwo",
        "zostałem okradziony podczas wakacji nad morzem", "mam wyrok w zawieszeniu i dostałem nowy mandat",
        "ktoś włamał się do mojego samochodu", "sąsiad nęka mnie i grozi pobiciem",
    ],
    "dr-04": [
        "szef nie wypłacił mi pensji za dwa miesiące", "zwolnili mnie tydzień po powrocie z urlopu macierzyńskiego",
        "pracuję po 12 godzin bez dodatku za nadgodziny", "ZUS zakwestionował moje zwolnienie lekarskie",
        "pracodawca każe mi podpisać porozumienie stron", "przełożony wyzywa mnie przy klientach",
        "nie dostałem ekwiwalentu za urlop po zwolnieniu", "mam umowę zlecenie, a pracuję jak na etacie",
        "ZUS wyliczył mi bardzo niską emeryturę", "uległem wypadkowi w drodze do pracy",
        "pracodawca nie chce dać mi urlopu wychowawczego", "dostałem wypowiedzenie zmieniające z niższą pensją",
        "odmówiono mi świadczenia rehabilitacyjnego", "nie wypłacono mi odprawy emerytalnej",
    ],
    "dr-05": [
        "starostwo od roku nie rozpatruje mojego wniosku", "SKO uchyliło korzystną dla mnie decyzję",
        "urząd wojewódzki zgubił dokumenty do mojej karty pobytu", "gmina odmówiła udostępnienia umów z wykonawcami",
        "dostałem decyzję o zwrocie świadczenia po 5 latach", "organ wydał decyzję bez przeprowadzenia oględzin",
        "chcę wznowić postępowanie zakończone decyzją ostateczną", "cudzoziemiec dostał decyzję o zobowiązaniu do powrotu",
        "urząd nie zawiadomił mnie o wszczęciu postępowania", "sąd administracyjny odrzucił moją skargę za brak opłaty",
        "kurator oświaty nie odpowiada na skargę", "wojewoda nie przedłużył zezwolenia na pobyt czasowy",
    ],
    "dr-06": [
        "urząd skarbowy żąda zwrotu ulgi na internet", "zapłaciłem za dużo podatku od sprzedaży działki",
        "nie wiem, jak rozliczyć wynajem krótkoterminowy", "dostałem wezwanie z urzędu skarbowego do złożenia wyjaśnień",
        "firma nie odliczyła VAT od samochodu", "otrzymałem darowiznę od wujka na mieszkanie",
        "skarbówka zakwestionowała moje koszty w działalności", "zalegam z podatkiem od nieruchomości",
        "chcę przejść z ryczałtu na podatek liniowy", "dostałem spadek z zagranicy i nie wiem o podatku",
        "mam zaległy PIT za poprzedni rok", "kontrola celno-skarbowa w mojej hurtowni",
    ],
    "dr-07": [
        "przegraliśmy przetarg na odśnieżanie przez błąd w kosztorysie", "zamawiający żąda od nas kar za opóźnienie dostawy",
        "chcemy zaskarżyć warunki udziału w przetargu", "gmina nie wypłaca wynagrodzenia z umowy zamówienia publicznego",
        "agencja żąda zwrotu dofinansowania z programu unijnego", "zamawiający wybrał ofertę firmy bez doświadczenia",
        "nasza oferta została odrzucona za brak podpisu kwalifikowanego", "Regionalna Izba Obrachunkowa zakwestionowała wydatki gminy",
        "chcemy zmienić termin realizacji umowy z gminą", "konsorcjant wycofał się z przetargu po wyborze oferty",
    ],
    "dr-08": [
        "rada miasta uchwaliła zakaz handlu na targowisku", "plan miejscowy przewiduje drogę przez mój ogród",
        "wójt nie chce wydać decyzji o warunkach zabudowy", "gmina podniosła opłatę za wywóz śmieci",
        "radny głosował w sprawie własnej działki", "chcemy odwołać burmistrza w referendum",
        "gmina nie remontuje drogi gminnej przy moim domu", "uchwała krajobrazowa nakazuje usunąć reklamę",
        "sołtys rozdysponował fundusz sołecki bez zebrania", "miasto nalicza opłatę za parkowanie przed moim domem",
    ],
    "dr-09": [
        "sąsiad wyciął drzewa na granicy działki", "inspektor nadzoru budowlanego wstrzymał moją budowę",
        "chcę postawić wiatę garażową na działce", "obok mojego domu ma powstać biogazownia",
        "myśliwi strzelają blisko zabudowań", "zakład przemysłowy truje rzekę ściekami",
        "chcę podłączyć dom do sieci gazowej, a operator odmawia", "kamieniołom niszczy mój dom wibracjami",
        "kupiłem działkę, przez którą biegnie linia wysokiego napięcia", "nowa ekspresówka przebiega przez moje pole",
        "chcę przekształcić strych w mieszkanie", "farma fotowoltaiczna na sąsiedniej działce oślepia mnie odbiciami",
    ],
    "dr-10": [
        "lekarz nie skierował mnie na badania i choroba się rozwinęła", "szpital wypisał tatę mimo gorączki",
        "przychodnia nie chce zapisać mnie do lekarza", "szkoła nie wydała świadectwa córce",
        "nauczyciel obraził ucznia na lekcji", "sanepid zamknął moją piekarnię",
        "NFZ nie refunduje mi leku na cukrzycę", "dentysta uszkodził mi nerw podczas leczenia",
        "uczelnia nie uznała moich zaliczeń z Erasmusa", "agencja rolna nie wypłaciła dopłat do hektara",
        "pielęgniarka środowiskowa nie przychodzi do mamy", "szpital nie powiadomił rodziny o śmierci pacjenta",
    ],
    "dr-11": [
        "sklep wysłał moje dane do firmy windykacyjnej bez podstawy", "pracodawca czyta moje prywatne maile",
        "ktoś założył fałszywy profil z moimi zdjęciami", "aplikacja zbiera lokalizację bez mojej zgody",
        "firma szkoleniowa skopiowała mój kurs online", "chcemy wykorzystać ChatGPT do analizy danych klientów",
        "hakerzy zaszyfrowali dane w naszej firmie", "klinika zgubiła teczkę z wynikami pacjentów",
        "ktoś używa nazwy mojej marki w sklepie internetowym", "szkoła publikuje zdjęcia uczniów na Instagramie",
        "monitoring sąsiada nagrywa moje okna", "operator telekomunikacyjny udostępnił moje dane oszustowi",
    ],
    "dr-12": [
        "pełnomocnik nie informuje mnie o stanie sprawy", "nie stać mnie na opłatę od apelacji",
        "sąd od dwóch lat nie wyznaczył rozprawy", "biegły nie stawił się na rozprawę i sprawa się przeciąga",
        "notariusz pomylił numer księgi w akcie", "komornik sądowy naliczył mi wysokie koszty egzekucji",
        "chcę zmienić adwokata w trakcie procesu", "mediator nie był bezstronny",
        "sędzia przerywa mi na rozprawie i nie dopuszcza dowodów", "radca prawny zażądał wyższego honorarium niż w umowie",
    ],
    "dr-13": [
        "policjanci weszli do mojego mieszkania bez nakazu", "dostałem wezwanie do stawienia się w wojskowym centrum rekrutacji",
        "odebrano mi pozwolenie na broń myśliwską", "Straż Graniczna odmówiła mi wjazdu do strefy",
        "policja użyła wobec mnie gazu podczas demonstracji", "chcę wstąpić do Wojsk Obrony Terytorialnej i mam wątpliwości co do kontraktu",
        "pracuję z informacjami niejawnymi i nie dostałem certyfikatu", "funkcjonariusz SOP nie wylegitymował się",
        "dron policyjny nagrywa moją posesję", "żołnierz zawodowy chce odejść ze służby",
    ],
    "dr-14": [
        "żona wyjechała z dziećmi do Irlandii bez mojej zgody", "firma z Czech nie zapłaciła za dostawę towaru",
        "mój ojciec zmarł w Kanadzie i zostawił tam majątek", "pracowałem w Norwegii i nie dostałem wynagrodzenia",
        "chcę uznać w Polsce rozwód z Wielkiej Brytanii", "polski sąd naruszył moje prawo do obrony, chcę iść do Strasburga",
        "Komisja Europejska prowadzi postępowanie wobec Polski w mojej sprawie", "kupiłem samochód we Włoszech i sprzedawca zniknął",
        "jestem obywatelem Ukrainy i chcę uzyskać ochronę czasową", "kontrahent z Niemiec pozwał mnie przed sądem w Monachium",
    ],
    "dr-15": [
        "chcemy wdrożyć system zarządzania bezpieczeństwem informacji", "pracownik zgłosił nadużycia kierownika przez kanał sygnalisty",
        "audytor wskazał braki w polityce antykorupcyjnej", "zarząd chce przyjąć kodeks postępowania etycznego",
        "bank musi dostosować umowy z dostawcami IT do DORA", "przygotowujemy się do certyfikacji ISO 37301",
        "rada nadzorcza pyta o konflikt interesów prezesa", "kontrahent figuruje na liście sankcyjnej",
        "chcemy zbudować program compliance w spółce produkcyjnej", "dział zakupów przyjmuje prezenty od dostawców",
    ],
    "dr-16": [
        "chcę policzyć odsetki ustawowe od zaległej faktury", "portal internetowy nie chce opublikować mojego sprostowania",
        "potrzebuję wyrobić paszport dla noworodka", "chcę wymeldować najemcę, który się wyprowadził",
        "moja babcia była obywatelką Polski i chcę odzyskać obywatelstwo", "zaginęły akta mojej sprawy w sądzie",
        "nie odebrałem pisma z sądu przez e-doręczenia", "jak zbudować strategię procesową w sporze z ubezpieczycielem",
        "dziennikarz opublikował wywiad bez autoryzacji", "chcę zameldować dziecko bez zgody drugiego rodzica",
    ],
}

FRAMES = [
    "{m}, co dalej?", "Mam problem: {m}.", "Potrzebuję porady, {m}.", "{M} — jakie mam prawa?",
    "Czy coś mogę zrobić? {M}.", "Klient pyta: {m}.", "Sprawa wygląda tak: {m}. Jak to rozwiązać?",
    "{M}. Gdzie się zwrócić?", "Pomocy, {m}!", "Chciałbym zapytać, {m}. Czy to zgodne z prawem?",
    "Od miesiąca {m}. Co radzicie?", "{M}. Jakie przepisy tu obowiązują?",
]

TASKS = [
    ("Napisz pozew w sprawie: {m}.", "pisma-procesowe-v3"), ("Przygotuj apelację, sprawa: {m}.", "pisma-procesowe-v3"),
    ("Jakie mam szanse w sądzie? {M}.", "analiza-sadowa-v6"), ("Oceń szanse wygrania sprawy: {m}.", "analiza-sadowa-v6"),
    ("Znajdź wyrok w podobnej sprawie: {m}.", "orzeczenia-sadowe-v2"), ("Znajdź precedens: {m}.", "orzeczenia-sadowe-v2"),
    ("Przygotuj pytania do świadka w sprawie: {m}.", "przesluchanie-swiadkow-v2-min90"),
    ("Zrób chronologię sprawy: {m}.", "chronologia-sprawy-v1"), ("Oś czasu zdarzeń: {m}.", "chronologia-sprawy-v1"),
    ("Raport dla klienta w sprawie: {m}.", "raport-klienta-v1"), ("Jaki jest stan sprawy? {M}.", "raport-sytuacyjny-v2"),
    ("Oceń moje dowody w sprawie: {m}.", "analizator-dowodow-v3"), ("Od czego zacząć? {M}.", "przewodnik-prawny-v2"),
]
TASK_DOMAINS = ["dr-02", "dr-03", "dr-04", "dr-05", "dr-10", "dr-11"]

CONTRACTS = [
    "umowę najmu okazjonalnego", "umowę o świadczenie usług IT", "umowę przedwstępną zakupu działki", "umowę agencyjną",
    "umowę licencyjną na logo", "umowę o współpracy B2B", "umowę pożyczki od znajomego", "umowę dostawy z hurtownią",
]
CONTRACT_FRAMES = ["Przeanalizuj {c} przed podpisaniem.", "Czy mogę podpisać {c}?", "Analiza umowy: {c}, na co uważać?"]

NONLEGAL_TOPICS = {
    "kuchnia": ["upiec murzynka", "ugotować rosół", "zrobić pesto", "usmażyć placki ziemniaczane", "przygotować tiramisu", "zrobić kiszoną kapustę", "upiec chleb żytni", "zrobić dżem truskawkowy"],
    "dom": ["odetkać zlew", "wymienić żarówkę w lampie sufitowej", "usunąć pleśń z łazienki", "wyczyścić fugi", "zamontować półkę na ścianie", "wyprać zasłony", "pozbyć się kurzu", "odświeżyć stare meble"],
    "technologia": ["zresetować router", "zrobić kopię zapasową telefonu", "wyczyścić pamięć podręczną przeglądarki", "zainstalować Pythona", "skonfigurować drukarkę sieciową", "przyspieszyć Windowsa", "zmienić język klawiatury", "nagrać ekran na laptopie"],
    "zdrowie": ["poprawić kondycję", "zacząć biegać", "wzmocnić kręgosłup", "lepiej się wysypiać", "pić więcej wody", "zrobić rozgrzewkę przed treningiem"],
    "ogrod": ["przyciąć róże", "wysiać trawę", "podlewać pomidory", "przesadzić fikusa", "zrobić kompostownik", "pozbyć się ślimaków"],
    "nauka": ["nauczyć się tabliczki mnożenia", "zapamiętywać daty z historii", "napisać wypracowanie", "przygotować się do egzaminu z angielskiego", "uczyć się do sesji"],
}
NONLEGAL_FRAMES = ["Jak {t}?", "Jak najlepiej {t}?", "Podpowiesz, jak {t}?", "Co zrobić, żeby {t}?", "Jak szybko {t}?"]
CREATIVE = [
    "Napisz wiersz o {x}.", "Napisz bajkę o {x}.", "Wymyśl rymowankę o {x}.", "Napisz krótki tekst na bloga o {x}.",
    "Opowiedz ciekawostkę o {x}.", "Co to jest {x}?", "Wyjaśnij dziecku, czym jest {x}.",
]
THEMES = ["zimie", "kotach", "kosmosie", "morzu", "przyjaźni", "wakacjach", "górach", "dinozaurach", "jesiennym lesie", "pociągach", "pszczołach", "rowerach"]
CONCEPTS = ["fotosynteza", "grawitacja", "algorytm", "wulkan", "atom", "tęcza", "mitochondrium", "procent", "ułamek", "elektron", "galaktyka", "ekosystem"]
MATH = ["Ile to jest {a} razy {b}?", "Policz {a} plus {b}.", "Ile to {a} procent z {b}?", "Podziel {b} przez {a}.", "Ile to jest {a} do kwadratu?"]
TRANSLATE = ["Przetłumacz na angielski: {p}", "Jak po francusku jest {p}?", "Przetłumacz na niemiecki: {p}", "Jak po włosku powiedzieć {p}?"]
PHRASES = ["miłego weekendu", "gdzie jest apteka", "poproszę kawę", "dziękuję za pomoc", "jutro będzie padać", "lubię czytać książki"]
RECOMMEND = ["Polecisz {r}?", "Jaki {r} wybrać?", "Masz pomysł na {r}?"]
RECS = ["dobry film na wieczór", "książkę na wakacje", "grę dla dzieci", "prezent dla taty", "przepis na kolację", "miejsce na weekend nad morzem", "podcast o historii", "serial komediowy"]

ACKS = ["ok", "okej", "super", "jasne", "rozumiem", "spoko", "dobrze", "świetnie", "w porządku"]
THANKS = ["dzięki", "dziękuję", "wielkie dzięki", "dziękuję bardzo", "thx"]
GREETINGS = ["cześć", "hej", "dzień dobry", "witam", "dobry wieczór", "siema", "halo"]

ASSISTANT_QUESTIONS = ["Kiedy to się stało?", "Czy ma Pan dokumenty?", "Czy była umowa na piśmie?", "Ile czasu minęło od zdarzenia?"]
ANSWERS = ["dwa tygodnie temu", "tak, mam wszystko w mailach", "nie, wszystko było ustnie", "ponad rok", "w zeszły piątek", "mam tylko SMS-y", "nie pamiętam dokładnie, chyba w marcu"]
ASSISTANT_STATEMENTS = ["Warto zebrać dokumenty i spisać przebieg zdarzeń.", "Proszę pilnować terminów i zachować korespondencję."]
ASSISTANT_PROPOSALS = ["Czy mam przygotować projekt pisma?", "Czy przygotować wezwanie?", "Czy mam opisać kolejne kroki?"]

DIACRITICS = str.maketrans("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ", "acelnoszzACELNOSZZ")
ENFORCEMENT = re.compile(r"komorni|egzekuc|zaje(?:l|ci)|zajeci", re.I)


def plain(text):
    return text.translate(DIACRITICS)


def spell(text):
    """Most messages as typed; some without Polish letters, some in lower case."""
    roll = rng.random()
    if roll < 0.25:
        return plain(text)
    if roll < 0.35:
        return plain(text).lower()
    return text


def fill(frame, matter):
    return frame.replace("{m}", matter).replace("{M}", matter[0].upper() + matter[1:])


def thread(first, answer, follow):
    return f"Użytkownik: {first}\n\nAsystent: {answer}\n\nUżytkownik: {follow}"


def main():
    out = []

    def add(q, kind, legal, dr=None, skill=None, variant="kompozycja"):
        item = {"q": q, "kind": kind, "legal": legal, "dr": dr, "variant": variant}
        if skill:
            item["skill"] = skill
        if legal:
            item["criminal"] = dr == "dr-03" and not ENFORCEMENT.search(plain(q))
        out.append(item)

    legal = [(dr, fill(frame, matter)) for dr, matters in MATTERS.items() for matter in matters for frame in FRAMES]
    rng.shuffle(legal)
    for dr, text in legal:
        add(text, "legal", True, dr, None, "kompozycja")
        add(plain(text) if rng.random() < 0.6 else plain(text).lower(), "legal", True, dr, None, "kompozycja-bez-znakow")

    tasks = [(dr, fill(frame, matter), skill) for frame, skill in TASKS for dr in TASK_DOMAINS for matter in MATTERS[dr]]
    tasks += [("dr-02", frame.format(c=contract), "analizator-umow-v1") for frame in CONTRACT_FRAMES for contract in CONTRACTS]
    rng.shuffle(tasks)
    for dr, text, skill in tasks:
        add(spell(text), "executive", True, dr, skill, "zadanie")

    nonlegal = [frame.format(t=topic) for topics in NONLEGAL_TOPICS.values() for topic in topics for frame in NONLEGAL_FRAMES]
    nonlegal += [frame.format(x=theme) for frame in CREATIVE[:5] for theme in THEMES]
    nonlegal += [frame.format(x=concept) for frame in CREATIVE[5:] for concept in CONCEPTS]
    nonlegal += [frame.format(a=a, b=b) for frame in MATH for a in (3, 7, 12, 25, 48) for b in (9, 40, 150, 360)]
    nonlegal += [frame.format(p=phrase) for frame in TRANSLATE for phrase in PHRASES]
    nonlegal += [frame.format(r=rec) for frame in RECOMMEND for rec in RECS]
    openings = ["", "", "Hej, ", "Mam pytanie: ", "Cześć! "]
    pool = []
    for text in nonlegal:
        for opening in openings:
            pool.append(opening + (text[0].lower() + text[1:] if opening else text))
    rng.shuffle(pool)
    for text in pool:
        add(spell(text), "nonlegal", False, None, None, "temat")

    trivial = set(ACKS + THANKS + GREETINGS)
    trivial |= {f"{a}, {t}" for a in ACKS for t in THANKS}
    trivial |= {f"{a} {t}" for a in ACKS for t in THANKS}
    trivial |= {f"{g}!" for g in GREETINGS} | {f"{t}!" for t in THANKS} | {f"{a}." for a in ACKS}
    for text in sorted(trivial):
        add(text, "trivial", False, None, None, "krotkie")

    firsts = [(dr, fill("{M}.", matter)) for dr, matters in MATTERS.items() for matter in matters]
    count = 0
    while count < 1300:
        dr, first = rng.choice(firsts)
        roll = rng.random()
        if roll < 0.5:
            add(thread(first, rng.choice(ASSISTANT_QUESTIONS), spell(rng.choice(ANSWERS))), "followup", True, dr, None, "watek-odpowiedz")
        elif roll < 0.75:
            add(thread(first, rng.choice(ASSISTANT_PROPOSALS), rng.choice(ACKS)), "followup", True, dr, None, "watek-zgoda")
        else:
            add(thread(first, rng.choice(ASSISTANT_STATEMENTS), rng.choice([f"{a}, {t}" for a in ACKS for t in THANKS] + THANKS)), "trivial", False, None, None, "watek-podziekowanie")
        count += 1

    suffixes = [" Z góry dzięki.", " Proszę o krótką odpowiedź.", " Pilne!", " :)"]
    while len(out) < 10000:
        add(spell(rng.choice(pool) + rng.choice(suffixes)), "nonlegal", False, None, None, "temat-dopisek")
    out = out[:10000]
    with open(os.path.join(HERE, "routing-10000.json"), "w", encoding="utf-8") as handle:
        json.dump(out, handle, ensure_ascii=False, indent=0)
        handle.write("\n")
    counts = {}
    for item in out:
        counts[item["kind"]] = counts.get(item["kind"], 0) + 1
    print(len(out), counts, "unique", len({item["q"] for item in out}))


if __name__ == "__main__":
    main()
