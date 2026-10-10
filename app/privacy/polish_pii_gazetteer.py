"""Dictionary and pattern recognizer for Polish person names and addresses.

Persons come from SGJP through Morfeusz2 (the same dictionary the morphology
engine uses): every given name and surname SGJP knows, in every inflected
form. A span is a person when it looks like one in context:

- given name(s) followed by a surname or an unknown capitalized word
  ("Jan Kowalski", "Annie Marii Nowak", "Jan Xyzowski"),
- surname followed by a given name ("Kowalski Jan"),
- an initial and a surname ("J. Kowalski"),
- a role or title before a surname ("pozwany Kowalski", "pani Nowak"),
- a later mention of the surname alone once the full name was found.

Addresses are recognized by structure: a street marker (ul., al., pl., os.,
ulica, aleja, plac, osiedle, rondo ...) with a name and a house number,
optionally followed by a postal code and town; a village address with a
number and postal code; a postal code with a town. The TERYT register
(address_base.py) adds a street named without a house number ("przy ulicy
Długiej") and a locality, in any case form, where a text says someone lives,
lived or comes from there ("zamieszkały w Ponikwi 15", "ul. Długa 5 w Pcimiu");
a locality in a court's or office's name is not personal data.

Input: text file. Output: JSON list of {start, end, kind, value}.
The recognizer never sees the network and never writes the text anywhere.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from functools import lru_cache
from pathlib import Path

import morfeusz2

import address_base
import surname_base

UPPER = "A-ZĄĆĘŁŃÓŚŹŻÄÖÜÉÈÁÍÚÝČŠŽŘ"
WORD_RE = re.compile(r"[^\W\d_]+(?:[-'’][^\W\d_]+)*")

TRIGGERS = {
    "pan", "pana", "panu", "panem", "panie", "pani", "panią", "państwo",
    "powód", "powoda", "powodowi", "powodem", "powódka", "powódki", "powódce", "powódką",
    "pozwany", "pozwanego", "pozwanemu", "pozwanym", "pozwana", "pozwanej", "pozwaną",
    "świadek", "świadka", "świadkowi", "świadkiem",
    "oskarżony", "oskarżonego", "oskarżonemu", "oskarżonym", "oskarżona", "oskarżonej", "oskarżoną",
    "podejrzany", "podejrzanego", "podejrzana", "podejrzanej",
    "pokrzywdzony", "pokrzywdzonego", "pokrzywdzona", "pokrzywdzonej",
    "wnioskodawca", "wnioskodawcy", "wnioskodawczyni", "uczestnik", "uczestnika", "uczestniczka",
    "dłużnik", "dłużnika", "dłużniczka", "wierzyciel", "wierzyciela", "wierzycielka",
    "skarżący", "skarżącego", "skarżąca", "skarżącej", "obwiniony", "obwinionego", "obwiniona",
    "adwokat", "adwokata", "adw", "radca", "radcy", "mec", "sędzia", "sędziego", "prokurator",
    "prokuratora", "notariusz", "notariusza", "komornik", "komornika", "dr", "prof", "mgr", "inż",
    "syn", "córka", "żona", "mąż", "ojciec", "matka", "brat", "siostra",
}

# Nouns that head an institution name or name a party role, in every case form
# (generate_generic_words.py). Several are also SGJP surnames ("Bank", "Rada",
# "Skarb"): such a word starting a span is an institution or a role, not a
# person, unless a person-only word precedes it ("pani Rada").
_GENERIC = json.loads(Path(__file__).with_name("generic_words.json").read_text(encoding="utf-8"))
GENERIC_WORDS = frozenset(_GENERIC["institutions"]) | frozenset(_GENERIC["partyRoles"])
PARTY_ROLES = frozenset(_GENERIC["partyRoles"])
PERSON_ONLY_TRIGGERS = frozenset(_GENERIC["personOnlyTriggers"])


def is_generic(word: str) -> bool:
    return word.lower() in GENERIC_WORDS


STREET_MARKER = (
    r"(?i:ul\.|ulic(?:a|ą|ę|y|i)|al\.|alej(?:a|ą|ę|i)|alei|pl\.|plac(?:u|em)?|"
    r"os\.|osiedl(?:e|a|u|em)|rond(?:o|a|zie|em)|skwer(?:u|ze|em)?|"
    r"bulwar(?:u|ze|em)?|wybrzeż(?:e|a|u|em))"
)
NAME_TOKEN = (
    rf"(?:[{UPPER}][\w’'\-]{{0,3}}\.(?=\s)|[{UPPER}][\w’'\-]*|\d{{1,3}}(?=\s+[{UPPER}])|\d{{1,4}}-[a-ząćęłńóśźż]+|[IVX]{{1,4}}\b|[„\"][^\"”\n]{{1,30}}[”\"]|"
    # Titles and ranks before a patron's name: "gen. dyw.", "kpt. pilota", "księdza", "o."
    r"[a-ząćęłńóśźż]{1,5}\.(?=\s+\S)|"
    r"(?:księdza|majora|pilota|generała|pułkownika|kapitana|doktora|profesora|marszałka|biskupa|kardynała|"
    r"porucznika|hetmana|króla|królowej|świętego|świętej|błogosławionego|błogosławionej|ojca|matki|siostry|"
    r"brata|sierżanta|kaprala|rotmistrza|komandora|admirała|inżyniera|harcmistrza|podharcmistrza)(?=\s+\S))"
)
# "Żwirki i Wigury", "Bitwy pod Kutnem", "Poległym za Ojczyznę"
NAME_LINK = r"(?:i|pod|za|przy|nad|na|w|we|z|ze|od|do)"
HOUSE_NUMBER = (
    r"(?:nr\s*)?\d{1,4}[A-Za-z]?(?:\s*[/\-]\s*\d{1,4}[A-Za-z]?)?"
    r"(?:\s*(?:m\.|lok\.|lokal|m)\s*\d{1,4}[A-Za-z]?)?"
)
TOWN = rf"[{UPPER}][\w\-]+(?:[ \-][{UPPER}][\w\-]+){{0,2}}"
POSTAL = rf"\d{{2}}-\d{{3}}\s+{TOWN}"

STREET_ADDRESS_RE = re.compile(
    rf"(?<![\w.@/-]){STREET_MARKER}\s+{NAME_TOKEN}(?:\s+(?:{NAME_LINK}\s+)?{NAME_TOKEN}){{0,6}}\s+{HOUSE_NUMBER}(?![\w/])"
    rf"(?:\s*,?\s*{POSTAL})?"
)
VILLAGE_ADDRESS_RE = re.compile(
    rf"\b[{UPPER}][\w\-]+(?:\s+[{UPPER}][\w\-]+)?\s+\d{{1,4}}[A-Za-z]?(?:/\d{{1,4}})?,\s*{POSTAL}"
)
POSTAL_RE = re.compile(rf"(?<![\d-]){POSTAL}")

ANALYZER = morfeusz2.Morfeusz(generate=False)


@lru_cache(maxsize=200_000)
def word_class(word: str) -> tuple[bool, bool, bool, bool, bool, frozenset[str]]:
    """(given, surname, unknown, common, geographic, surname lemmas)."""
    forms = {word}
    if word.isupper() and len(word) > 1:
        forms.add(word.capitalize())
    given = surname = common = geographic = False
    unknown = True
    lemmas: set[str] = set()
    for form in forms:
        for _start, _end, (_orth, lemma, tag, name_types, _q) in ANALYZER.analyse(form):
            pos = tag.split(":", 1)[0]
            if pos == "ign":
                continue
            unknown = False
            types = set(name_types)
            if "imię" in types:
                given = True
            if "nazwisko" in types:
                surname = True
                lemmas.add(lemma.split(":", 1)[0])
            if "nazwa_geograficzna" in types:
                geographic = True
            if not (types & {"imię", "nazwisko", "nazwa_geograficzna"}) and pos not in {"brev", "interp"}:
                common = True
    return given, surname, unknown, common, geographic, frozenset(lemmas)


ADJECTIVAL = re.compile(r"^(.{2,}(?:sk|ck|dzk))(?:i|iego|iemu|im|a|iej|ą)$", re.IGNORECASE)


def surname_keys(word: str, in_surname_position: bool = False) -> set[str]:
    """Keys shared by every case form of a surname.

    A word that is also a given name ("Kondrat", "Bogusz") counts only when it
    stood in the surname position of a full name.
    """
    g, s, u, c, _geo, lemmas = word_class(word)
    # A PESEL surname SGJP does not know in this form: its nominative is the key
    # every case form shares ("Tkachuk" and "Tkachukiem", "Sharma" and "Sharmy").
    pesel = set()
    if (u or s or in_surname_position) and not (g and not in_surname_position):
        pesel = {
            "pesel:" + nominative.lower()
            for gender in ("m1", "f")
            for nominative, _cases, _count in surname_base.nominatives(word, gender)
        }
    if s and (not g or in_surname_position):
        return set(lemmas) | pesel
    if u or (c and in_surname_position and ADJECTIVAL.match(word)):
        match = ADJECTIVAL.match(word)
        # Unknown adjectival surname: the stem is shared by all cases and genders.
        return {"adj:" + (match.group(1) if match else word).lower()} | pesel
    return pesel


def is_capitalized(word: str) -> bool:
    if not word[:1].isupper() or word.lower() in TRIGGERS:
        return False
    if word.isupper() and len(word) <= 3:
        # Short all-caps words are acronyms (SA, RP) unless SGJP knows them as
        # a given name or surname ("JAN", "EWA").
        given, surname, *_rest = word_class(word)
        return given or surname
    return True


# Names that are not about a party: a street or institution named after
# someone ("ulicy Mickiewicza", "Szpital im. Jana Pawła II") and quoted titles.
NAMED_AFTER_RE = re.compile(
    rf"(?:(?<![\w.@/-])(?:im\.|imienia|{STREET_MARKER}))\s+((?:[{UPPER}][^\s,.;:]*\.?\s?){{1,4}})"
)
QUOTED_RE = re.compile(r"[„\"«][^”\"»\n]{1,120}[”\"»]")


def not_person_spans(text: str) -> list[tuple[int, int]]:
    spans = [(m.start(1), m.end(1)) for m in NAMED_AFTER_RE.finditer(text)]
    spans += [(m.start(), m.end()) for m in QUOTED_RE.finditer(text)]
    return spans


ROMAN_AFTER = re.compile(r"\s+[IVX]{1,4}\b")


def tokens(text: str) -> list[tuple[int, int, str]]:
    return [(m.start(), m.end(), m.group()) for m in WORD_RE.finditer(text)]


def adjacent(text: str, left: tuple[int, int, str], right: tuple[int, int, str]) -> bool:
    gap = text[left[1]:right[0]]
    return gap in {" ", " "} or (gap == "" and False)


# Where a text places a person: a locality after these is an address.
RESIDENCE_CUE_RE = re.compile(
    r"(?<![\w.])(?:"
    r"(?:zamieszka[łn]\w*|zameldowan\w*|mieszka\w*|zamieszkuj\w*|przebywa\w*|zatrzyman\w*|"
    r"wyprowadzi\w*\s+się|przeprowadzi\w*\s+się|przeni(?:ósł|osł\w*|esie\w*)\s+się|pochodz\w*|"
    r"urodzi\w*\s+się|urodzon\w*|ur\.)"
    r"(?:\s+(?:dnia\s+)?\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\s*(?:r\.)?)?"
    r"(?:\s+(?:na\s+stałe|obecnie|aktualnie|wcześniej|dotychczas|ostatnio))?\s+(?P<prep>w|we|z|ze|do)\s+"
    r"(?-i:(?:miejscowości|wsi|mieście|osadzie|kolonii)\s+)?"
    r"|zam\.\s+(?:w(?:e)?\s+)?"
    r"|(?:w|we|z|ze|do)\s+(?-i:miejscowości|wsi)\s+"
    r"|(?:miejscowość|miejsce\s+zamieszkania|adres\s+zamieszkania)\s*:?\s+"
    r")",
    re.IGNORECASE,
)
LOCALITY_LINKS = ("nad", "pod", "za", "na", "od", "przy", "koło", "k.", "w", "we")
LOCALITY_WORD_RE = re.compile(rf"(?:[{UPPER}][\w’'\-]*|(?:{'|'.join(re.escape(w) for w in LOCALITY_LINKS)})(?=\s+[{UPPER}]))")
HOUSE_AFTER_RE = re.compile(rf"\s+(?:nr\s*)?\d{{1,4}}[A-Za-z]?(?:\s*/\s*\d{{1,4}}[A-Za-z]?)?(?![\w/.,]\d)(?!\s*(?:r\.|lat|roku|zł))")
AFTER_STREET_RE = re.compile(r"(?:\s*,\s*|\s+(?:w|we)\s+)")

# Villages share these names; after "pochodzi z" they are the country.
COUNTRIES = frozenset("""Polska Niemcy Ukraina Białoruś Litwa Łotwa Estonia Rosja Czechy Słowacja Węgry
Rumunia Bułgaria Serbia Chorwacja Słowenia Austria Szwajcaria Francja Hiszpania Portugalia Włochy Grecja
Turcja Anglia Szkocja Irlandia Holandia Belgia Dania Szwecja Norwegia Finlandia Islandia Gruzja Armenia
Mołdawia Kazachstan Indie Chiny Japonia Korea Wietnam Kanada Ameryka Meksyk Brazylia Argentyna Egipt
Izrael Australia Europa Azja Afryka""".split())

_ADDRESS_MORPHOLOGY = None


def address_morphology():
    global _ADDRESS_MORPHOLOGY
    if _ADDRESS_MORPHOLOGY is None:
        from polish_address_morphology import AddressMorphology

        _ADDRESS_MORPHOLOGY = AddressMorphology(morfeusz2.Morfeusz())
    return _ADDRESS_MORPHOLOGY


def locality_at(text: str, start: int, country: bool = False) -> tuple[int, int] | None:
    """The longest run of words at `start` that is a locality of the register
    in some case form ("Ciemnej Woli", "Kępie nad Wisłą")."""
    words: list[tuple[int, int]] = []
    position = start
    while len(words) < 4:
        match = LOCALITY_WORD_RE.match(text, position)
        if not match or (not words and not match.group()[:1].isupper()):
            break
        words.append((match.start(), match.end()))
        gap = re.match(r"[ -]", text[match.end():match.end() + 1])
        if not gap or text[match.end()] == "-" and not text[match.end() + 1:match.end() + 2].isupper():
            break
        position = match.end() + 1
    morphology = address_morphology()
    for count in range(len(words), 0, -1):
        end = words[count - 1][1]
        name = text[start:end].rstrip("-")
        if not name[-1:].isalpha() or name.split(" ")[-1] in LOCALITY_LINKS:
            continue
        readings = morphology.locality_readings(name)
        if readings:
            if readings[0]["name"] in COUNTRIES and not country and not HOUSE_AFTER_RE.match(text, start + len(name)):
                # "pochodzi z Ukrainy": the country; "ul. Długa 5, Włochy",
                # "w Korei 13": the village or district of that name.
                return None
            return start, start + len(name)
    return None


def find_localities(text: str, taken: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not address_base.default_base().available:
        return []
    starts = []
    for match in RESIDENCE_CUE_RE.finditer(text):
        if (match.group("prep") or "").lower() in ("z", "ze", "do"):
            # "mieszka z Janem", "przeprowadził się do Kowalskich": a person.
            first = WORD_RE.match(text, match.end())
            if first:
                # A given name, alone or before a surname; a word that is only a
                # surname may well be a village (Dąbrowa, Walaszki).
                given, _surname, _u, _c, geographic, _l = word_class(first.group())
                after = WORD_RE.match(text, first.end() + 1)
                full_name = bool(after and after.group()[:1].isupper())
                found = locality_at(text, match.end())
                several_words = bool(found and " " in text[found[0]:found[1]].strip())
                if given and (not geographic or full_name) and not several_words:
                    continue
        starts.append(match.end())
    after_street = set()
    # "ul. Długa 5, Pcim", "ul. Długiej 5 w Pcimiu"
    for s, e in taken:
        follow = AFTER_STREET_RE.match(text, e)
        if follow and re.match(r"(?:ul\.|ulic|al\.|ale[ij]|pl\.|plac|os\.|osiedl|rond|skwer|bulwar|wybrzeż)", text[s:e], re.I):
            starts.append(follow.end())
            after_street.add(follow.end())
    spans: list[tuple[int, int]] = []
    for start in sorted(set(starts)):
        if any(s <= start < e for s, e in taken + spans):
            continue
        found = locality_at(text, start, country=start in after_street)
        if not found:
            continue
        s, e = found
        house = HOUSE_AFTER_RE.match(text, e)
        if house:
            e = house.end()
        spans.append((s, e))
    return spans


STREET_NAME_RE = re.compile(rf"(?<![\w.@/-]){STREET_MARKER}\s+{NAME_TOKEN}(?:\s+(?:{NAME_LINK}\s+)?{NAME_TOKEN}){{0,6}}")


# A street named without a number is someone's address only after these
# ("mieszka przy ulicy Długiej"); a court's or office's street is not.
STREET_CUE_RE = re.compile(
    r"(?:zamieszka\w*|mieszka\w*|zam\.|zameldowan\w*|zamieszkuj\w*|przebywa\w*|przeprowadzi\w*\s+się|"
    r"wyprowadzi\w*\s+się|przeni\w*\s+się|adres\w*)(?:\s+\S+){0,6}\s*:?\s*$",
    re.IGNORECASE,
)


def find_named_streets(text: str, taken: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """A street the register knows, named without a house number, where a
    text places a person."""
    if not address_base.default_base().streets.available:
        return []
    morphology = address_morphology()
    spans = []
    for match in STREET_NAME_RE.finditer(text):
        if any(match.start() < e and s < match.end() for s, e in taken):
            continue
        if not STREET_CUE_RE.search(text[max(0, match.start() - 60):match.start()]):
            continue
        words = match.group().split()
        key, marker, cases = morphology._marker(words[0])
        if not marker:
            continue
        if words[0][:1].isupper() and morphology.locality_readings(" ".join(w.rstrip(",.") for w in words[:2])):
            # "Sąd Rejonowy w Osiedlu Robotniczym": a locality, not a street.
            continue
        gender, lemma = marker
        kind = morphology.REGISTER_KIND.get(key, "ul.")
        for count in range(len(words) - 1, 0, -1):
            name = [w.rstrip(",.") if i == count - 1 else w for i, w in enumerate(words[1:count + 1])]
            reading, _ = morphology._street_reading(name, gender, kind, cases if lemma else None)
            if reading:
                end = match.start() + len(" ".join(words[:count + 1]).rstrip(",."))
                spans.append((match.start(), end))
                break
    return spans


def find_addresses(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for regex in (STREET_ADDRESS_RE, VILLAGE_ADDRESS_RE, POSTAL_RE):
        for match in regex.finditer(text):
            start, end = match.start(), match.end()
            if any(start < e and s < end for s, e in spans):
                continue
            spans.append((start, end))
    spans += find_named_streets(text, spans)
    spans += find_localities(text, spans)
    return sorted(spans)


def find_persons(text: str, blocked: list[tuple[int, int]]) -> list[tuple[int, int]]:
    words = tokens(text)
    taken = [False] * len(words)

    def free(index: int) -> bool:
        s, e, _ = words[index]
        return not taken[index] and not any(s < be and bs < e for bs, be in blocked)

    spans: list[tuple[int, int]] = []
    # Words that stood in the surname position of a full name found above.
    surname_positions: list[int] = []

    def take(first: int, last: int) -> None:
        for index in range(first, last + 1):
            taken[index] = True
        spans.append((words[first][0], words[last][1]))

    def cls(index: int):
        return word_class(words[index][2])

    def cap(index: int) -> bool:
        return 0 <= index < len(words) and is_capitalized(words[index][2]) and free(index)

    def linked(a: int, b: int) -> bool:
        return adjacent(text, words[a], words[b])

    # 1. Given name(s) + surname or unknown word.
    index = 0
    while index < len(words):
        if cap(index) and cls(index)[0]:
            end = index
            given_count = 1
            while cap(end + 1) and linked(end, end + 1) and cls(end + 1)[0] and given_count < 3:
                end += 1
                given_count += 1
            nxt = end + 1
            # Saints and monarchs ("Jana Pawła II", "Kazimierza III") are not parties.
            if ROMAN_AFTER.match(text, words[end][1]):
                index = end + 1
                continue
            if cap(nxt) and linked(end, nxt):
                g, s, u, c, geo, _ = cls(nxt)
                # An adjectival word after a given name is a surname even when
                # SGJP also reads it as an adjective ("Ewa Czarnowelska").
                # A PESEL surname that is also a common noun or a place right
                # after a given name ("Anna Ląg", "Jan Piastun", "Barbara Kock")
                # is the surname: left out, it stayed readable next to a masked name.
                in_register = not is_generic(words[nxt][2]) and bool(surname_base.default_base().counts(words[nxt][2]))
                if s or u or (not c and not geo) or ADJECTIVAL.match(words[nxt][2]) or in_register:
                    last = nxt
                    # Two-word surnames written with a space (Duran Perez,
                    # Grzelak Tanguila): the next surname belongs to the name.
                    while last - nxt < 2 and cap(last + 1) and linked(last, last + 1):
                        g2, s2, u2, c2, geo2, _ = cls(last + 1)
                        word2 = words[last + 1][2]
                        in_pesel = bool(surname_base.default_base().counts(word2))
                        if g2 or geo2 or is_generic(word2) or not (s2 or u2 or in_pesel):
                            break
                        if c2 and not s2 and not u2:
                            break
                        last += 1
                    take(index, last)
                    surname_positions.extend(range(nxt, last + 1))
                    index = last + 1
                    continue
            # "Jan Maria" + surname already consumed above; two given names where
            # the second is also a surname ("Anna Jan") are accepted as a name.
            if end > index and cls(end)[1]:
                take(index, end)
                surname_positions.append(end)
                index = end + 1
                continue
        index += 1

    # 2. Surname + given name ("Kowalski Jan").
    for index in range(len(words) - 1):
        if cap(index) and cap(index + 1) and linked(index, index + 1):
            g, s, u, c, geo, _ = cls(index)
            if (
                s and not geo and cls(index + 1)[0]
                and not is_generic(words[index][2])
                and not ROMAN_AFTER.match(text, words[index + 1][1])
            ):
                take(index, index + 1)
                surname_positions.append(index)

    # 3. Initial(s) + surname ("J. Kowalski", "J.M. Nowak").
    for match in re.finditer(rf"\b(?:[{UPPER}]\.\s?){{1,2}}\s?([{UPPER}][^\W\d_]+(?:-[{UPPER}][^\W\d_]+)?)", text):
        surname = match.group(1)
        g, s, u, c, geo, _ = word_class(surname)
        if (s or u) and not any(match.start() < be and bs < match.end() for bs, be in blocked + spans):
            spans.append((match.start(), match.end()))
            for i, (ws, we, _) in enumerate(words):
                if match.start() <= ws and we <= match.end():
                    taken[i] = True

    # 4. Role or title before a surname ("pozwany Kowalski", "pani Nowak").
    for index in range(len(words) - 1):
        trigger = words[index][2].lower()
        # Party roles of contracts ("Najemca Kowalski") point at a person too.
        if trigger not in TRIGGERS and trigger not in PARTY_ROLES:
            continue
        gap = text[words[index][1]:words[index + 1][0]]
        if gap.strip() not in {"", "."}:
            continue
        first = index + 1
        if not cap(first):
            continue
        # "pozwany Bank", "Wierzyciel Skarb Państwa": an institution, not a person.
        if is_generic(words[first][2]) and trigger not in PERSON_ONLY_TRIGGERS:
            continue
        last = first
        while last - first < 2 and cap(last + 1) and linked(last, last + 1):
            g, s, u, c, geo, _ = cls(last + 1)
            if not (g or s or u):
                break
            last += 1
        g, s, u, c, geo, _ = cls(first)
        if (s or u or g) and not (c and not s and not g):
            take(first, last)

    # 5. The surname alone after the full name was found.
    # Only real surnames of full names found above; a word that is also a given
    # name ("Jan", "Maria") is never propagated on its own.
    known: set[str] = set()
    for position in surname_positions:
        known |= surname_keys(words[position][2], in_surname_position=True)
    for start, end in spans:
        for ws, we, word in words:
            if start <= ws and we <= end:
                known |= surname_keys(word)
    if known:
        for index in range(len(words)):
            # "Bank Pekao" after "Jan Bank": the institution name, not the person.
            if (
                is_generic(words[index][2])
                and index + 1 < len(words)
                and linked(index, index + 1)
                and is_capitalized(words[index + 1][2])
            ):
                continue
            if cap(index) and surname_keys(words[index][2], in_surname_position=True) & known:
                take(index, index)

    return spans


def is_ambiguous(value: str) -> bool:
    """A person span a local model should confirm from the sentence: one word,
    a generic noun in it, or only words that are also common nouns."""
    words = [word for _s, _e, word in tokens(value)]
    if len(words) <= 1 or any(is_generic(word) for word in words):
        return True
    classes = [word_class(word) for word in words]
    return all(c and not g for g, _s, _u, c, _geo, _l in classes)


def recognize(text: str) -> list[dict]:
    addresses = find_addresses(text)
    persons = find_persons(text, addresses + not_person_spans(text))
    result = [
        {"start": s, "end": e, "kind": "ADDRESS", "value": text[s:e]} for s, e in addresses
    ] + [
        {"start": s, "end": e, "kind": "PERSON", "value": text[s:e], "ambiguous": is_ambiguous(text[s:e])}
        for s, e in persons
    ]
    return sorted(result, key=lambda item: item["start"])


def serve() -> None:
    # One JSON request per stdin line, one JSON answer per stdout line: Morfeusz, the
    # PESEL surname base and TERYT are loaded once, not for every checked message.
    recognize("Jan Kowalski mieszka przy ul. Długiej 5 w Krakowie.")
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            answer = {"id": request_id, "spans": recognize(str(request["text"]))}
        except Exception as error:  # the worker survives one bad request
            answer = {"id": request_id, "error": str(error)[:500]}
        sys.stdout.write(json.dumps(answer, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    if args.serve:
        serve()
        return
    if not args.input or not args.output:
        parser.error("--input and --output are required without --serve")
    text = Path(args.input).read_text(encoding="utf-8")
    Path(args.output).write_text(json.dumps(recognize(text), ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
