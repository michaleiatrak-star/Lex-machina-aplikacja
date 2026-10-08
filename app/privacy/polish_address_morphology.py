"""Declension of Polish addresses: street names and localities (TERYT).

A locality is inflected word by word from its nominative and its official
genitive (PRNG, kept in localities_teryt.tsv): SGJP when it knows a lemma
whose genitive is the official one, otherwise the declension class the
nominative-genitive pair determines (Pcim - Pcimia - Pcimiu, Ponikiew -
Ponikwi, Zurzyce - Zurzyc - Zurzycach, Ciemna Wola - Ciemnej Woli). An
inflected form ("w Ponikwi") is traced back by generating the paradigms of
the register's names that share its beginning and keeping those that contain
it.

A street name is inflected only when it is an adjective agreeing with the
street type ("ul. Długa" - "ulicy Długiej"); a name in the genitive
("Konopnickiej", "Armii Krajowej") is written the same in every case. The
ULIC register decides which of the two a form is.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

import address_base
from address_base import fold

CASES = ("nom", "gen", "dat", "acc", "inst", "loc", "voc")
VOWELS = "aąeęioóuy"
SOFT_STEM = ("i", "j", "l", "c", "cz", "sz", "rz", "ż", "dz", "dż", "ś", "ź", "ć", "ń", "k", "g", "ch", "h")
# Hard stem -> its palatalized form before -e (masculine/neuter locative).
PALATAL = [
    ("str", "strze"), ("st", "ście"), ("zd", "ździe"), ("sł", "śle"), ("zł", "źle"), ("r", "rze"), ("t", "cie"), ("d", "dzie"), ("n", "nie"), ("s", "sie"), ("z", "zie"),
    ("ł", "le"), ("m", "mie"), ("p", "pie"), ("b", "bie"), ("w", "wie"), ("f", "fie"), ("ch", "sze"),
]
# Feminine -a: dative/locative of the stem.
# Feminine -zna softens the z (SGJP localities: 181 "-źnie" to 58 "-znie");
# neuter -zno and -sno keep it (96 to 4: w Grzęznie, w Desnie).
PALATAL_FEM = [("k", "ce"), ("g", "dze"), ("ch", "sze"), ("zn", "źnie")] + PALATAL
FUNCTION_WORDS = {"nad", "pod", "przy", "za", "na", "w", "we", "k.", "koło", "ad", "z", "ze", "i", "u", "o", "od", "do"}


def _cap(model: str, value: str) -> str:
    if model.isupper() and len(model) > 1:
        return value.upper()
    if model[:1].isupper():
        # "Podkamienna", not SGJP's segmented "podKamienny".
        rest = value[1:].lower() if model[1:] == model[1:].lower() else value[1:]
        return value[:1].upper() + rest
    return value


def _palatal(stem: str, table=PALATAL) -> str | None:
    low = stem.lower()
    for hard, soft in table:
        if low.endswith(hard):
            return stem[: len(stem) - len(hard)] + soft
    return None


def _ends(word: str, *endings: str) -> bool:
    return word.lower().endswith(endings)


def _instr_masc(stem: str) -> str:
    return stem + ("iem" if _ends(stem, "k", "g") else "em")


def rule_forms(word: str, genitive: str | None, after_noun: bool = False) -> tuple[dict[str, list[str]], str] | None:
    """Case forms of one word of a locality name from its nominative and
    genitive (declension class), or None when the pair fits no class.

    A neuter adjectival name keeps the old -em of the instrumental and
    locative ("w Zakopanem", "w Wysokiem Mazowieckiem"); an adjective after
    a noun takes -ym ("w Dymaczewie Nowym")."""
    w, g = word, genitive
    lw = w.lower()
    if g is None:
        g = _guess_genitive(w)
        if g is None:
            return {c: [w] for c in CASES}, "nieodmienne(bez dopełniacza)"
    lg = g.lower()
    one = lambda **forms: {c: [forms.get(c, w)] for c in CASES}  # noqa: E731
    if lg == lw:
        return {c: [w] for c in CASES}, "nieodmienne"
    # Adjectives (Wielka Wieś, Psary Polskie, Wysokie Mazowieckie).
    if lg.endswith("owego") and lw.endswith("ów"):
        # Possessive adjective: Stęplów-Gościniec - Stęplowego-Gościńca.
        stem = g[:-3]
        return one(gen=g, dat=stem + "emu", inst=stem + "ym", loc=stem + "ym"), "przymiotnik dzierżawczy"
    if lg.endswith("ego") and lw[-1:] in ("y", "i", "e", "o"):
        stem = g[:-3]
        modern = stem + ("m" if stem.endswith("i") else "ym")
        forms = {c: [w] for c in CASES} | {"gen": [g], "dat": [stem + "emu"], "inst": [modern], "loc": [modern]}
        if lw.endswith("e"):
            # Both are in use for the same place ("w Tarnowie Podgórnem" and
            # "Podgórnym"); the first is the one a generated text uses.
            old = stem + "em"
            for case in ("inst", "loc"):
                forms[case] = [modern, old] if after_noun else [old, modern]
        return forms, "przymiotnik m/n"
    if lg.endswith("ej") and lw.endswith("a"):
        return one(gen=g, dat=g, acc=w[:-1] + "ą", inst=w[:-1] + "ą", loc=g), "przymiotnik ż"
    if (lg.endswith("ych") or lg.endswith("ich")) and lw[-1:] in ("e", "i") and len(lg) > len(lw):
        stem = g[:-2]
        return one(gen=g, dat=stem + "m", inst=stem + "mi", loc=g), "przymiotnik lm"
    last = lw[-1:]
    plural_gen = lg.endswith("ów") or lg[-1:] not in VOWELS or (lg[-1:] in ("i", "y") and last in ("y", "i", "e"))
    if last in ("y", "i", "e", "a") and plural_gen and not lg.endswith(("a", "u")) and not (last == "a" and lg[-1:] in ("i", "y")):
        # Pieronkowie - Pieronków - Pieronkom; a plural of persons (-owie,
        # Szewcy) has the accusative of the genitive.
        base = g[:-2] if lw.endswith("owie") and lg.endswith("ów") else w[:-1]
        acc = g if lw.endswith(("owie", "cy", "dzy")) else w
        return one(gen=g, dat=base + "om", acc=acc, inst=base + "ami", loc=base + "ach"), "rzeczownik lm"
    if last not in VOWELS:
        if lg.endswith(("a", "u")):
            stem = g[:-1]
            loc = stem + "u" if _ends(stem, *SOFT_STEM) else _palatal(stem)
            if loc is None:
                return None
            return one(gen=g, dat=stem + "owi", inst=_instr_masc(stem), loc=loc, voc=loc), "rzeczownik m"
        if lg.endswith(("i", "y")):
            # Ponikwi - Ponikwią, Łodzi - Łodzią; Bieli - Bielą.
            inst = g[:-1] + "ą" if not lg.endswith("i") or lg.endswith(("li", "ji")) else g + "ą"
            return one(gen=g, dat=g, inst=inst, loc=g, voc=g), "rzeczownik ż (spółgłoska)"
        return None
    if last == "a" and lg.endswith(("y", "i")):
        stem = w[:-1]
        if not _ends(stem, "k", "g", "ch") and (lg.endswith("i") or _ends(stem, "c", "cz", "sz", "rz", "ż", "dz", "dż", "j", "l")):
            dl = g
        else:
            dl = _palatal(stem, PALATAL_FEM)
            if dl is None:
                return None
        return one(gen=g, dat=dl, acc=stem + "ę", inst=stem + "ą", loc=dl, voc=stem + "o"), "rzeczownik ż"
    if last in ("o", "e") and lg.endswith("a"):
        stem = g[:-1]
        if last == "e" or _ends(stem, *SOFT_STEM):
            loc = stem + "u"
        else:
            loc = _palatal(stem)
            if loc is None:
                return None
        return one(gen=g, dat=stem + "u", inst=_instr_masc(stem), loc=loc), "rzeczownik n"
    return None


def _guess_genitive(w: str) -> str | None:
    lw = w.lower()
    if lw.endswith(("ski", "cki", "dzki")):
        return w + "ego"
    if lw.endswith(("ska", "cka", "dzka", "owa", "na")) and len(lw) > 4:
        return w[:-1] + "ej"
    if lw.endswith("a"):
        stem = w[:-1]
        return stem + ("i" if _ends(stem, "k", "g", "l", "j", "i") else "y")
    if lw.endswith(("o", "e")):
        return w[:-1] + "a"
    if lw[-1:] not in VOWELS:
        return w + "a"
    return None


class AddressMorphology:
    """Canonical form and seven case forms of an address mention: a street
    address ("ul. Długiej 5"), a locality ("Ponikwi") or a village address
    ("Jemnej 15")."""

    STREET_TYPES = {
        "ul.": ("f", None), "al.": ("f", None), "pl.": ("m3", None), "os.": ("n", None),
        "ulica": ("f", "ulica"), "aleja": ("f", "aleja"), "plac": ("m3", "plac"),
        "osiedle": ("n", "osiedle"), "rondo": ("n", "rondo"), "skwer": ("m3", "skwer"),
        "bulwar": ("m3", "bulwar"), "wybrzeże": ("n", "wybrzeże"),
    }
    # ULIC kind of each street type, to check a name against the register.
    REGISTER_KIND = {"ul.": "ul.", "ulica": "ul.", "al.": "al.", "aleja": "al.", "pl.": "pl.", "plac": "pl.",
                     "os.": "os.", "osiedle": "os.", "rondo": "rondo", "skwer": "skwer", "bulwar": "bulw.",
                     "wybrzeże": "wyb."}
    # Used when the register is missing: streets named after women.
    FEMALE_PATRON_STREETS = {
        "konopnickiej", "orzeszkowej", "skłodowskiej", "curie-skłodowskiej", "skłodowskiej-curie",
        "zapolskiej", "dąbrowskiej", "nałkowskiej", "szymborskiej", "żmichowskiej", "pawlikowskiej",
        "pawlikowskiej-jasnorzewskiej", "kossak-szczuckiej", "rodziewiczówny", "gojawiczyńskiej",
        "kuncewiczowej", "bacewiczówny", "grabskiej", "moniuszkowej", "prusowej", "ordonówny",
        "krzywickiej", "świętochowskiej", "sempołowskiej", "kopernikowej", "wańkowiczowej",
    }
    HOUSE = re.compile(r"^(?:nr|\d{1,4}[A-Za-z]?(?:[/\-]\d{1,4}[A-Za-z]?)?[,.]?)$", re.I)

    def __init__(self, engine, base: address_base.AddressBase | None = None, use_sgjp: bool = True) -> None:
        self.engine = engine
        self.base = base or address_base.default_base()
        self.use_sgjp = use_sgjp

    # --- SGJP -------------------------------------------------------------

    @staticmethod
    def _features(tag: str) -> list[set[str]]:
        return [set(part.split(".")) for part in tag.split(":")]

    @lru_cache(maxsize=65536)
    def _generate(self, lemma: str) -> tuple[tuple[str, str], ...]:
        return tuple((orth, tag) for orth, _lemma, tag, *_rest in self.engine.generate(lemma))

    @lru_cache(maxsize=65536)
    def _sgjp_word(self, word: str, genitive: str, after_noun: bool = False) -> tuple[tuple[str, tuple[str, ...]], ...] | None:
        """SGJP paradigm of `word` whose genitive is `genitive`: geographic
        names first, then common nouns and adjectives (Wola, Nowa)."""
        found = []
        for _s, _e, (_orth, lemma, tag, types, _q) in self.engine.analyse(word):
            parts = self._features(tag)
            if parts[0] & {"subst", "adj"} and len(parts) > 3 and "nom" in parts[2]:
                for number in parts[1] & {"sg", "pl"}:
                    for gender in parts[3]:
                        rank = 0 if "nazwa_geograficzna" in types else 1
                        if after_noun:
                            # "Nowe" after "Dymaczewo" is the adjective, not the town Nowe.
                            rank = 0 if "adj" in parts[0] else 1 + rank
                        found.append((rank, lemma, next(iter(parts[0] & {"subst", "adj"})), number, gender))
        for _rank, lemma, pos, number, gender in sorted(set(found)):
            forms: dict[str, list[str]] = {c: [] for c in CASES}
            for orth, tag in self._generate(lemma):
                parts = self._features(tag)
                if pos not in parts[0] or number not in parts[1] or len(parts) < 4 or gender not in parts[3]:
                    continue
                if pos == "adj" and "pos" not in parts[-1]:
                    continue
                for case in parts[2] & set(CASES):
                    value = _cap(word, orth)
                    if value not in forms[case]:
                        forms[case].append(value)
            if any(f.lower() == genitive.lower() for f in forms["gen"]) and all(forms.values()):
                if not any(f.lower() == word.lower() for f in forms["nom"]):
                    continue
                # The nominative and genitive as the register writes them first.
                forms["nom"] = [word] + [f for f in forms["nom"] if f != word]
                forms["gen"] = [genitive] + [f for f in forms["gen"] if f.lower() != genitive.lower()]
                return tuple((c, tuple(forms[c])) for c in CASES)
        return None

    # --- localities -------------------------------------------------------

    @staticmethod
    def _split(name: str) -> list[str]:
        """Words and separators: "Borów-Kolonia" -> ["Borów", "-", "Kolonia"]."""
        return [piece for piece in re.split(r"([ \-])", name) if piece]

    @lru_cache(maxsize=65536)
    def locality_paradigm(self, name: str, genitive: str | None) -> tuple[dict[str, list[str]], str, bool] | None:
        """(case -> forms, source, confident) of a locality name."""
        words = self._split(name)
        gen_words = self._split(genitive) if genitive else None
        if gen_words is not None and len(gen_words) != len(words):
            gen_words = None
        per_word: list[dict[str, list[str]]] = []
        sources = set()
        frozen_rest = False
        after_noun = False
        for index, word in enumerate(words):
            if word in (" ", "-"):
                per_word.append({c: [word] for c in CASES})
                continue
            gen_word = gen_words[index] if gen_words else None
            if gen_word is not None and gen_word.lower() == word.lower() or not word[:1].isalpha() or (
                gen_word is None and (frozen_rest or word.lower() in FUNCTION_WORDS)
            ):
                frozen_rest = True
                per_word.append({c: [word] for c in CASES})
                continue
            forms = None
            if self.use_sgjp and gen_word and gen_word.lower() != word.lower():
                sgjp = self._sgjp_word(word, gen_word, after_noun)
                if sgjp:
                    forms = {c: list(v) for c, v in sgjp}
                    sources.add("sgjp")
                    # Of SGJP's variants the regular one first (Wysokim, not
                    # the archaic Wysokiem).
                    ruled = rule_forms(word, gen_word, after_noun)
                    if ruled:
                        for case in CASES:
                            regular = ruled[0][case][0]
                            if regular in forms[case]:
                                forms[case].remove(regular)
                                forms[case].insert(0, regular)
            if forms is None:
                ruled = rule_forms(word, gen_word, after_noun)
                if ruled is None:
                    return None
                forms = ruled[0]
                sources.add("rule" if gen_word else "guess")
            if word.lower().endswith("e") and forms["gen"][0].lower().endswith("ego"):
                ruled = rule_forms(word, forms["gen"][0], after_noun)
                for case in ("inst", "loc"):
                    for variant in ruled[0][case]:
                        if variant not in forms[case]:
                            forms[case].append(variant)
            per_word.append(forms)
            gen_low = forms["gen"][0].lower()
            if not gen_low.endswith(("ego", "ej", "ych", "ich")) or word.lower().endswith(("ów", "in", "yn")):
                after_noun = True
        paradigm = {c: ["".join(w[c][0] for w in per_word)] for c in CASES}
        # Alternatives a document may use: each word's variants.
        for case in CASES:
            for index, w in enumerate(per_word):
                for variant in w[case][1:]:
                    text = "".join(variant if i == index else x[case][0] for i, x in enumerate(per_word))
                    if text not in paradigm[case]:
                        paradigm[case].append(text)
        source = "sgjp" if sources == {"sgjp"} else ("guess" if "guess" in sources else ("rule" if sources else "frozen"))
        return paradigm, source, "guess" not in sources

    def locality_readings(self, observed: str, context: tuple[str, ...] = ()) -> list[dict[str, Any]]:
        """Localities of the register `observed` can be a case form of, most
        likely first: [{"name", "genitive", "cases", "count", "paradigm", "source"}]."""
        words = observed.split(" ")
        if not words or not words[0][:1].isupper() or not self.base.available:
            return []
        first = fold(words[0].split("-")[0])
        # Stems alternate at the end (Cmolas - Cmolesie, Ponikiew - Ponikwi);
        # a short word may alternate earlier (Łacha - Łasze).
        prefix = first[: max(min(len(first), 3), len(first) - 4)]
        found = self._readings_with_prefix(observed, words, prefix)
        if not found and len(prefix) > 2:
            found = self._readings_with_prefix(observed, words, prefix[:2])
        if not found and len(first) >= 2:
            # Mobile e at the start: Wsi - Wieś, Pnia - Pień.
            for vowel in ("ie", "e"):
                found = self._readings_with_prefix(observed, words, first[0] + vowel + first[1])
                if found:
                    break
        # The name the document also writes in the nominative wins, then one
        # of its other forms; then the form read as a nominative, then
        # towns, then the more frequent name.
        named = {fold(c) for c in context}

        def explained(reading) -> int:
            # How many of the document's other mentions the name accounts for,
            # its nominative counted twice (Golin: "Golin" and "Golina").
            forms = {fold(f) for c in CASES for f in reading["paradigm"][c]}
            return sum(2 if n == fold(reading["name"]) else 1 for n in named if n in forms)

        found.sort(key=lambda r: (-explained(r), r["name"] != observed, -r["towns"], -r["count"]))
        return found

    def _readings_with_prefix(self, observed: str, words: list[str], prefix: str) -> list[dict[str, Any]]:
        found = []
        for locality in self.base.localities_with_prefix(prefix):
            name_words = locality.name.split(" ")
            if len(name_words) != len(words):
                continue
            if any(fold(a)[:1] != fold(b)[:1] for a, b in zip(name_words[1:], words[1:])):
                continue
            genitives = [g for g, _n in locality.genitives] or [None]
            for genitive in genitives:
                result = self.locality_paradigm(locality.name, genitive)
                if not result:
                    continue
                paradigm, source, confident = result
                cases = {c for c in CASES if any(f.lower() == observed.lower() for f in paradigm[c])}
                if cases:
                    found.append({"name": locality.name, "genitive": genitive, "cases": cases, "count": locality.count,
                                  "towns": locality.towns, "paradigm": paradigm, "source": source,
                                  "confident": confident})
                    break
        return found

    # --- streets ----------------------------------------------------------

    def _marker(self, word: str):
        low = word.lower()
        if low in self.STREET_TYPES:
            return low, self.STREET_TYPES[low], {"nom"}
        for key, (gender, lemma) in self.STREET_TYPES.items():
            if not lemma:
                continue
            cases: set[str] = set()
            for _s, _e, (_orth, lem, tag, _types, _q) in self.engine.analyse(low):
                parts = self._features(tag)
                if lem.split(":")[0] == lemma and parts[0] == {"subst"} and "sg" in parts[1]:
                    cases |= parts[2] & set(CASES)
            if cases:
                return key, (gender, lemma), cases
        return None, None, set()

    def _adjective(self, word: str, gender: str, cases: set[str] | None):
        for _s, _e, (_orth, lemma, tag, _types, _q) in self.engine.analyse(word):
            parts = self._features(tag)
            if parts[0] == {"adj"} and "sg" in parts[1] and gender in parts[3]:
                found = parts[2] & set(CASES)
                if cases is None or found & cases:
                    return lemma.split(":")[0], found if cases is None else found & cases
        return None, set()

    def _adjective_forms(self, lemma: str, gender: str) -> dict[str, str]:
        forms: dict[str, str] = {}
        for orth, tag in self._generate(lemma):
            parts = self._features(tag)
            if parts[0] != {"adj"} or "sg" not in parts[1] or gender not in parts[3] or "pos" not in parts[-1]:
                continue
            for case in parts[2] & set(CASES):
                forms.setdefault(case, orth)
        return forms

    def _noun_forms(self, lemma: str, gender: str) -> dict[str, str]:
        forms: dict[str, str] = {}
        for orth, tag in self._generate(lemma):
            parts = self._features(tag)
            if parts[0] != {"subst"} or "sg" not in parts[1] or gender not in parts[3]:
                continue
            for case in parts[2] & set(CASES):
                forms.setdefault(case, orth)
        return forms

    @staticmethod
    def adjective_rule_forms(nominative: str, gender: str) -> dict[str, str] | None:
        """Forms of an adjective SGJP does not know (Zurzycka, Grunwaldzki)."""
        low = nominative.lower()
        if gender == "f" and low.endswith("a"):
            stem = nominative[:-1]
            oblique = stem + ("iej" if _ends(stem, "k", "g") else "ej")
            return {"nom": nominative, "gen": oblique, "dat": oblique, "acc": stem + "ą", "inst": stem + "ą",
                    "loc": oblique, "voc": nominative}
        if gender in ("m3", "n") and low.endswith(("y", "i", "e")):
            if low.endswith("i"):
                soft = nominative
            elif low.endswith("ie"):
                soft = nominative[:-1]
            else:
                soft = None
            if soft:
                gen, dat, loc = soft + "ego", soft + "emu", soft + "m"
            else:
                stem = nominative[:-1]
                gen, dat, loc = stem + "ego", stem + "emu", stem + "ym"
            return {"nom": nominative, "gen": gen, "dat": dat, "acc": nominative, "inst": loc, "loc": loc,
                    "voc": nominative}
        return None

    @staticmethod
    def adjective_nominatives(form: str, gender: str) -> list[str]:
        """Nominatives an inflected adjective can come from (Zurzyckiej -> Zurzycka)."""
        low = form.lower()
        out = []
        if gender == "f":
            for ending in ("iej", "ej", "ą", "a"):
                if low.endswith(ending):
                    out.append(form[: len(form) - len(ending)] + "a")
        else:
            for ending in ("iego", "ego", "iemu", "emu", "im", "ym"):
                if low.endswith(ending):
                    stem = form[: len(form) - len(ending)]
                    out += [stem + "y", stem + "i", stem + "ie", stem + "e"]
            out.append(form)
        return list(dict.fromkeys(out))

    def _known(self, word: str) -> bool:
        return any(interp[2][2] != "ign" for interp in self.engine.analyse(word))

    def _is_nominative_adjective(self, word: str, gender: str) -> bool:
        """"Długa", "Słoneczne", "Zurzycka": an adjective in the nominative of
        the street type's gender (SGJP, or the regular endings when SGJP does
        not know the word)."""
        known = False
        for _s, _e, (_orth, _lemma, tag, _types, _q) in self.engine.analyse(word):
            parts = self._features(tag)
            if parts[0] == {"ign"}:
                continue
            known = True
            if parts[0] == {"adj"} and "sg" in parts[1] and "nom" in parts[2] and len(parts) > 3 and gender in parts[3]:
                return True
        if known:
            return False
        endings = {"f": ("ska", "cka", "dzka", "owa", "ewa", "na"), "m3": ("ski", "cki", "dzki", "owy", "ny", "wy"),
                   "n": ("skie", "ckie", "owe", "ne", "we")}
        return word.lower().endswith(endings.get(gender, ()))

    def _street_kind(self, name: str, register_kind: str) -> int:
        """Streets of this kind with this name; a name the register has only
        for another kind ("al. Chopina", registered as ul.) counts as well."""
        kinds = self.base.street(name) if self.base.streets.available else None
        if not kinds:
            return 0
        return kinds.get(register_kind) or sum(kinds.values())

    def _street_reading(self, name_words: list[str], gender: str, register_kind: str, cases: set[str] | None):
        """("agree", [(word, adjective nominative)]) or ("frozen", None) or
        (None, None) when the register has neither reading."""
        observed = " ".join(name_words)
        frozen = self._street_kind(observed, register_kind)
        nominatives: list[str] = []
        for word in name_words:
            core = word.rstrip(",.")
            options = []
            lemma, _found = self._adjective(core, gender, cases) if core[:1].isupper() else (None, set())
            if lemma:
                # The lemma is masculine (wrzosowy); the street's own gender: Wrzosowa.
                options.append(_cap(core, self._adjective_forms(lemma, gender).get("nom", lemma)))
            options += [o for o in self.adjective_nominatives(core, gender) if o not in options]
            nominatives.append(options)
        best = (0, None)
        if len(name_words) == 1:
            for option in nominatives[0]:
                count = self._street_kind(option, register_kind)
                if count > best[0] and (option != observed or self._is_nominative_adjective(option, gender)):
                    best = (count, [option])
        if best[1] and best[1][0] == observed:
            return "agree", best[1]
        if frozen and frozen >= best[0]:
            return "frozen", None
        if best[1]:
            return "agree", best[1]
        return None, None

    def analyze(self, surface: str, context: tuple[str, ...] = ()) -> dict[str, Any]:
        """`context`: the other address mentions of the document; a form two
        localities share ("Łubowie": Łubów or Łubowo) goes to the one the
        document also names."""
        words = surface.split()
        base = {"surface": surface, "canonical": surface, "gender": "n", "genderAlternatives": [],
                "observedCase": "nom", "status": "ok", "warnings": []}
        frozen = {**base, "forms": {c: {"text": surface, "source": "frozen", "confidence": 1.0} for c in CASES}}
        if not words:
            return frozen
        context = tuple(c for c in context if c != surface)
        key, marker, observed = self._marker(words[0])
        if marker and words[0][:1].isupper() and self.base.available:
            # "Osiedle Robotnicze", "Rondo": a locality named like a street type.
            as_locality = self._analyze_locality(surface, base, context)
            if as_locality:
                return as_locality
        if not marker:
            return self._analyze_locality(surface, base, context) or frozen
        gender, marker_lemma = marker
        register_kind = self.REGISTER_KIND.get(key, "ul.")
        marker_forms = self._noun_forms(marker_lemma, gender) if marker_lemma else {}
        name_words: list[str] = []
        tail: list[str] = []
        for word in words[1:]:
            if tail or self.HOUSE.match(word) or re.match(r"^\d{2}-\d{3}$", word):
                tail.append(word)
            else:
                name_words.append(word)
        cases = observed if marker_lemma else None
        plan: list[tuple[str, str | None, dict[str, str] | None]] = []
        reading, nominatives = (None, None)
        if self.base.streets.available and name_words:
            reading, nominatives = self._street_reading(name_words, gender, register_kind, cases)
        if reading == "agree":
            nominative = nominatives[0]
            word = name_words[0]
            lemma, found = self._adjective(nominative, gender, None)
            forms = self._adjective_forms(lemma, gender) if lemma else {}
            if not all(c in forms for c in CASES):
                forms = self.adjective_rule_forms(nominative, gender) or {}
            observed_cases = {c for c, f in forms.items() if f.lower() == word.rstrip(",.").lower()}
            if observed_cases:
                cases = (cases & observed_cases) or observed_cases if cases else observed_cases
            plan.append((word, nominative, forms))
        elif reading == "frozen":
            plan += [(word, None, None) for word in name_words]
        else:
            agreeing = True
            for word in name_words:
                core = word.rstrip(",.")
                forms = None
                if core.lower() in self.FEMALE_PATRON_STREETS:
                    agreeing = False
                if agreeing and core[:1].isupper():
                    lemma, found = self._adjective(core, gender, cases)
                    if lemma:
                        cases = found if cases is None else (cases & found or cases)
                        forms = self._adjective_forms(lemma, gender)
                if not forms and agreeing and len(name_words) == 1 and core[:1].isupper() and not self._known(core) and (
                    gender == "f" and core.lower().endswith(("ą", "ska", "cka", "dzka", "owa", "na"))
                    or gender != "f" and core.lower().endswith(("ym", "ski", "cki", "owy", "owe", "ne", "ny"))
                ):
                    # An adjective neither SGJP nor the register knows (a new
                    # street): its nominative by the regular endings.
                    nominative = self.adjective_nominatives(core, gender)[0]
                    forms = self.adjective_rule_forms(nominative, gender)
                if not forms:
                    agreeing = False
                plan.append((word, None, forms))
        plan += [(word, None, None) for word in tail]
        if not marker_forms and not any(forms for _w, _n, forms in plan):
            return frozen
        result: dict[str, dict[str, Any]] = {}
        complete = True
        for case in CASES:
            parts = [_cap(words[0], marker_forms[case]) if marker_lemma and case in marker_forms else words[0]]
            for word, _nominative, forms in plan:
                if forms and case in forms:
                    tail_punct = word[len(word.rstrip(",.")):]
                    parts.append(_cap(word, forms[case]) + tail_punct)
                else:
                    if forms:
                        complete = False
                    parts.append(word)
            result[case] = {"text": " ".join(parts), "source": "sgjp", "confidence": 1.0}
        return {**base, "canonical": result["nom"]["text"], "gender": gender,
                "observedCase": sorted(cases)[0] if cases else "nom",
                "status": "ok" if complete else "needs_review", "forms": result}

    def _analyze_locality(self, surface: str, base: dict[str, Any], context: tuple[str, ...] = ()) -> dict[str, Any] | None:
        """A locality ("Ponikwi") or village address ("Jemnej 15") mention."""
        words = surface.split()
        name_words: list[str] = []
        for word in words:
            if self.HOUSE.match(word) or re.match(r"^\d{2}-\d{3}$", word) or name_words and word[:1].isdigit():
                break
            name_words.append(word)
        if not name_words:
            return None
        name = " ".join(name_words[:-1] + [name_words[-1].rstrip(",.")])
        tail = surface[surface.index(name) + len(name):] if name in surface else ""
        names = tuple(re.split(r"\s+(?:nr\s*)?\d", c)[0].rstrip(",. ") for c in context)
        readings = self.locality_readings(name, names)
        if not readings:
            return None
        top = readings[0]
        paradigm = top["paradigm"]
        same = [r for r in readings if r["paradigm"]["nom"][0] == top["paradigm"]["nom"][0]]
        warnings = []
        status = "ok" if top["confident"] else "needs_review"
        if len({r["name"] for r in readings}) > 1:
            rivals = [r for r in readings[1:] if r["name"] != top["name"]]
            # Another name of the register with this form: the more frequent one wins.
            if rivals and rivals[0]["towns"] == top["towns"] and rivals[0]["count"] * 2 > top["count"]:
                status = "needs_review"
                warnings.append("AMBIGUOUS_LOCALITY")
        del same
        source = top["source"]
        forms = {c: {"text": paradigm[c][0] + tail, "source": source, "confidence": 1.0 if source == "sgjp" else 0.9}
                 for c in CASES}
        return {**base, "canonical": forms["nom"]["text"], "gender": "n",
                "observedCase": "nom" if "nom" in top["cases"] else sorted(top["cases"])[0],
                "status": status, "warnings": warnings, "forms": forms}
