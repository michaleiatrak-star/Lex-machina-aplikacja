"""Builds scenarios-5000.json: 5000 chat turns with the expected routing and the
expected outcome of the turn.

Outcome (what the user gets):
  DOKUMENT  - a file (letter, pleading, contract) is generated
  ANALIZA   - full legal analysis (mandatory path profile PEŁNY)
  PROSTA    - a simple legal answer (profile LEKKI: lay question)
  OGOLNA    - a general answer without legal skills (non-legal, small talk)
PROFIL-LEKKI forbids the light profile for a criminal matter: a criminal
question is ANALIZA even when a lay person asks it.

Fields: q, history (earlier turns, optional), outcome, dr, skill (document
skill for DOKUMENT), criminal, frame, variant. Run: python3 -I build-scenarios-5000.py
"""
import json
import os
import random
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ns = {}
with open(os.path.join(HERE, "scenario-situations.py"), encoding="utf-8") as handle:
    exec(handle.read(), ns)
SITUATIONS = ns["S"]
assert len(SITUATIONS) == 160, len(SITUATIONS)

SKILL = {"proste": "pisma-proste-v2", "procesowe": "pisma-procesowe-v3", "umowa": "analizator-umow-v1"}
DOC_VERBS = ["Napisz", "Przygotuj", "Sporządź", "Napisz mi", "Przygotuj mi"]
ANALYSIS = [
    "Przeanalizuj szanse i ryzyka w sprawie {t}.",
    "Oceń moje szanse w sprawie {t} i wskaż ryzyka.",
    "Proszę o pełną analizę prawną sprawy {t}: podstawy, ryzyka, rekomendacje.",
]
FOLLOW_LEGAL = ["A jaki mam termin?", "Ile to będzie kosztować?", "A co jeśli druga strona się nie zgodzi?", "Czy potrzebuję do tego prawnika?"]
FOLLOW_THANKS = ["dzięki", "ok, dziękuję", "super, to wszystko", "dziękuję za pomoc"]
FOLLOW_DOC = ["Przygotuj to pismo.", "Napisz mi to pismo do pobrania.", "Zrób z tego dokument w Wordzie.", "Wygeneruj ten dokument."]

NONLEGAL = [
    "Jak upiec sernik na zimno?", "Ile to jest 15% z 240?", "Przetłumacz na angielski: dziękuję za spotkanie.",
    "Napisz krótki wiersz o jesieni.", "Co to jest fotosynteza?", "Jak zresetować router?", "Polecisz dobry film na wieczór?",
    "Ile kalorii ma banan?", "Jaka jest stolica Australii?", "Napisz funkcję w Pythonie, która odwraca listę.",
    "Jak nauczyć psa chodzić na smyczy?", "Co ugotować na obiad z kurczaka?", "Jak zrobić tabelkę w Wordzie?",
    "Kto napisał Pana Tadeusza?", "Jak szybko zasnąć?", "Wymyśl imię dla chomika.", "Jak działa GPS?",
    "Ile to jest 2 do potęgi 10?", "Jak zrobić lemoniadę?", "Co to jest inflacja?", "Jak wyczyścić piekarnik?",
    "Jaka będzie pogoda w weekend?", "Podaj przepis na pierogi ruskie.", "Jak zmienić oponę w samochodzie?",
    "Ile trwa lot do Nowego Jorku?", "Jak się nauczyć grać na gitarze?", "Co zwiedzić w Krakowie w jeden dzień?",
    "Jak obliczyć pole koła?", "Jakie są objawy grypy?", "Jak zrobić kopię zapasową telefonu?", "Napisz życzenia urodzinowe dla mamy.",
    "Jak dbać o storczyka?", "Ile wody dziennie pić?", "Jak działa silnik elektryczny?", "Co to jest blockchain?",
    "Jak ugotować jajko na miękko?", "Jaki laptop do 3000 zł polecasz?", "Jak usunąć plamę z wina?", "Streść Lalkę Prusa.",
    "Jak napisać CV?", "Co to jest czarna dziura?", "Jak zrobić pizzę w domu?", "Ile gwiazd ma Droga Mleczna?",
    "Jak przyspieszyć komputer?", "Jaki prezent dla teściowej?", "Jak nauczyć dziecko jeździć na rowerze?",
    "Co to jest algorytm?", "Jak zrobić excela z wykresem?", "Wymień planety Układu Słonecznego.", "Jak zdjąć kamień z czajnika?",
]
TRIVIAL = ["ok", "dzięki", "cześć", "super", "dzień dobry", "ok, dziękuję", "hej", "dobrze", "jasne", "rozumiem",
           "tak", "nie", "witam", "dziękuję bardzo", "spoko", "w porządku", "ok super", "na razie", "do widzenia", "hej, jak leci?"]


def strip_accents(text):
    return "".join(ch for ch in unicodedata.normalize("NFD", text) if unicodedata.category(ch) != "Mn").replace("ł", "l").replace("Ł", "L")


def variants(text):
    lower = text[0].lower() + text[1:]
    return {
        "oryginal": text,
        "bez-polskich-znakow": strip_accents(text),
        "male-litery": strip_accents(text).lower().rstrip(".?!"),
        "powitanie": "Dzień dobry, " + lower,
        "prosba": "Proszę o pomoc. " + text,
    }


def frames(item, index):
    crim = item["c"]
    simple = "ANALIZA" if crim else "PROSTA"
    verb = DOC_VERBS[index % len(DOC_VERBS)]
    return [
        ("A-pytanie-laika", item["q"], simple, None),
        ("B-opis-laika", item["s"], simple, None),
        ("C-opis-prawnika", item["p"], "ANALIZA", None),
        ("D-prosba-o-pismo", f"{verb} {item['d']} w sprawie {item['t']}.", "DOKUMENT", SKILL[item["k"]]),
        ("E-prosba-o-analize", ANALYSIS[index % len(ANALYSIS)].format(t=item["t"]), "ANALIZA", None),
    ]


cases = []
for index, item in enumerate(SITUATIONS):
    for frame, text, outcome, skill in frames(item, index):
        for variant, q in variants(text).items():
            case = {"q": q, "outcome": outcome, "dr": item["dr"], "criminal": item["c"], "frame": frame, "variant": variant}
            if skill:
                case["skill"] = skill
            cases.append(case)
    # A thread: the lay story, the assistant's answer, then a follow-up.
    history = f"Użytkownik: {item['s']}\n\nAsystent: Rozumiem sytuację. Mogę wyjaśnić Pana/Pani prawa i możliwe kroki."
    cases.append({"q": FOLLOW_LEGAL[index % 4], "history": history, "outcome": "ANALIZA" if item["c"] else "PROSTA",
                  "dr": item["dr"], "criminal": item["c"], "frame": "F-watek-pytanie", "variant": "watek"})
    cases.append({"q": FOLLOW_THANKS[index % 4], "history": history, "outcome": "OGOLNA", "dr": None, "criminal": False,
                  "frame": "F-watek-podziekowanie", "variant": "watek"})
    cases.append({"q": FOLLOW_DOC[index % 4], "history": history + f"\n\nUżytkownik: Czy warto przygotować {item['d']}?\n\nAsystent: Tak, to dobry krok.",
                  "outcome": "DOKUMENT", "dr": item["dr"], "criminal": item["c"], "frame": "F-watek-pismo", "variant": "watek", "skill": SKILL[item["k"]]})
    cases.append({"q": FOLLOW_LEGAL[(index + 1) % 4], "history": history, "outcome": "ANALIZA" if item["c"] else "PROSTA",
                  "dr": item["dr"], "criminal": item["c"], "frame": "F-watek-pytanie", "variant": "watek"})

nonlegal_variants = {
    "oryginal": lambda t: t,
    "bez-polskich-znakow": strip_accents,
    "male-litery": lambda t: strip_accents(t).lower().rstrip(".?!"),
    "powitanie": lambda t: "Cześć, " + t[0].lower() + t[1:],
    "prosba": lambda t: "Mam pytanie: " + t[0].lower() + t[1:],
}
for text in NONLEGAL:
    for variant, make in nonlegal_variants.items():
        cases.append({"q": make(text), "outcome": "OGOLNA", "dr": None, "criminal": False, "frame": "G-nieprawne", "variant": variant})

random.seed(5000)
while len(cases) < 5000:
    text = TRIVIAL[len(cases) % len(TRIVIAL)]
    cases.append({"q": text if random.random() < 0.6 else text.capitalize() + random.choice(["", "!", "."]), "outcome": "OGOLNA",
                  "dr": None, "criminal": False, "frame": "H-trywialne", "variant": "oryginal"})

assert len(cases) == 5000, len(cases)
with open(os.path.join(HERE, "scenarios-5000.json"), "w", encoding="utf-8") as out:
    json.dump(cases, out, ensure_ascii=False, indent=0)
print(len(cases))
