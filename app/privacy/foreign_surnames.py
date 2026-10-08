"""Declension of surnames SGJP does not know, foreign ones in particular.

The rules follow the Polish norms for surnames (Poradnia Językowa PWN
"Odmiana nazwisk obcych", "odmiana nazwisk zakończonych na samogłoskę";
Zasady pisowni PWN 78.C.2 for Ukrainian -ий/-ський/-цький; poradnie UW and
UŁ on Ukrainian names):

- consonant: masculine noun (Smith - Smitha, Nguyen - Nguyena, Tkachuk - Tkachuka);
- -o: a foreign man's surname inflects as a masculine noun (Caruso - Carusa,
  Castro - Castra); a Polish or Ukrainian one as a feminine noun
  (Kościuszko - Kościuszki, Fredro - Fredry, Shevchenko - Shevchenki);
- -a (men): feminine noun (Zaręba - Zaręby, Sharma - Sharmy);
- -i, -e after a consonant: adjective (Verdi - Verdiego, Goethe - Goethego);
- -y after a consonant: adjective (Kary - Karego); Ukrainian -yi/-skyi as the
  Polish -y/-ski (Chornyi - Chornego, Kovalskyi - Kovalskiego);
- -y after a vowel: masculine noun, no apostrophe (Disney - Disneya);
- -u and East/South Asian, Romanian, Georgian vowel-final: not inflected
  (Coseriu, Li, Rusu, Beridze);
- women: -ska/-cka and Russian/Ukrainian adjectival -a (-owa, Chorna) as an
  adjective, other -a as a noun, everything else not inflected.

Where the norms disagree or depend on pronunciation the code cannot hear
(-eau, mute -e in English and French) the result carries a low confidence and
the mention goes to review instead of being guessed.
"""

from __future__ import annotations

import re

CASES = ("nom", "gen", "dat", "acc", "inst", "loc", "voc")
CONSONANT = "bcćdfghjklłmnprsśtwzźżvxq"

VIETNAMESE = {"nguyen", "tran", "le", "pham", "hoang", "huynh", "phan", "vu", "vo", "dang", "bui", "do",
              "ho", "ngo", "duong", "ly", "trinh", "dinh", "doan", "luong", "mai", "truong", "lam", "ha"}
EAST_ASIAN = {"li", "wang", "zhang", "liu", "chen", "yang", "huang", "zhao", "wu", "zhou", "xu", "sun",
              "zhu", "hu", "guo", "he", "lin", "luo", "gao", "zheng", "liang", "xie", "song", "tang",
              "han", "feng", "deng", "cao", "peng", "zeng", "xiao", "tian", "dong", "yuan", "pan", "cai",
              "jiang", "yu", "du", "ye", "cheng", "wei", "su", "lu", "ding", "ren", "shen", "yao",
              "kim", "lee", "park", "choi", "jung", "kang", "cho", "yoon", "jang", "lim", "shin", "oh",
              "seo", "kwon", "hwang", "ahn", "yoo", "jeon", "hong", "moon", "yamamoto", "tanaka",
              "suzuki", "takahashi", "watanabe", "ito", "nakamura", "kobayashi", "sato"}
SOUTH_ASIAN = {"sharma", "singh", "kumar", "thapa", "shrestha", "gurung", "patel", "magar", "tamang",
               "rai", "khan", "ahmed", "ali", "hussain", "das", "gupta", "yadav", "verma", "bhandari",
               "khadka", "karki", "adhikari", "poudel", "pandey", "lama", "basnet", "chaudhary", "rana",
               "joshi", "reddy", "nair", "mishra", "pokharel", "ghimire", "kc", "bista", "budha"}

NOT_INFLECTED_ORIGINS = {"vietnamese", "east-asian", "south-asian", "romanian", "georgian"}


def origin(surname: str) -> str:
    """Rough origin of a surname's spelling: pl, east-slavic, vietnamese,
    east-asian, south-asian, romanian, georgian, turkish, romance, germanic or
    unmarked (a spelling with no sign of origin: Mazur as well as Lolenga).
    It steers declension only; it is never shown as a fact."""
    word = surname.lower().strip()
    if not word:
        return "unmarked"
    if re.search(r"[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđơư]", word) or word in VIETNAMESE:
        return "vietnamese"
    if word in EAST_ASIAN:
        return "east-asian"
    if word in SOUTH_ASIAN:
        return "south-asian"
    if re.search(r"[ăâșțşţ]", word) or re.search(r"(escu|eanu)$", word):
        return "romanian"
    if re.search(r"(dze|shvili|szwili)$", word):
        return "georgian"
    if re.search(r"[ğış]", word) or word.endswith(("oglu", "oğlu")):
        return "turkish"
    polish_spelling = bool(re.search(r"[ąćęłńóśźż]|sz|cz|rz|w", word))
    if not polish_spelling and (
        re.search(r"(shch|kh|zh|ts|yi|ii|yy|iy)", word)
        or re.search(r"(enko|chuk|chyk|iuk|yuk|ych|ouski|ouskaya|ovych|evych|ov|ova|ev|eva|yn|yna|skyi|tskyi)$", word)
    ):
        return "east-slavic"
    if re.search(r"[ąćęłńóśźż]", word):
        return "pl"
    if re.search(r"[ñãõçàèìòùâêîôûëïÿ]", word) or re.search(
        r"(ez|eira|eiro|inho|ini|etti|elli|ucci|acci|eau|oux|ier|aux|ault|chi|ghi|cci|zzi|tti|lli|nni|ino|ano|one|ello|etto)$", word
    ):
        return "romance"
    if re.search(r"[äöüß]", word) or re.search(r"(sch|mann|berg|stein|son|sen|ck$|th|ee|oo|ght|ough)", word):
        return "germanic"
    if polish_spelling or re.search(r"(ski|cki|dzki|ska|cka|dzka|wicz|czyk|czak|ak|ek|ik|yk|uk|ec|ło|ła)$", word):
        return "pl"
    return "unmarked"


# --- paradigms ----------------------------------------------------------------

_LOC_PALATAL = [
    ("str", "strze"), ("st", "ście"), ("zd", "ździe"), ("sł", "śle"),
    ("r", "rze"), ("t", "cie"), ("d", "dzie"), ("n", "nie"), ("s", "sie"),
    ("z", "zie"), ("ł", "le"), ("m", "mie"), ("p", "pie"), ("b", "bie"),
    ("w", "wie"), ("f", "fie"), ("v", "vie"),
]
_FEM_DAT = [("ka", "ce"), ("ga", "dze"), ("cha", "sze"), ("ra", "rze"), ("ta", "cie"),
            ("da", "dzie"), ("na", "nie"), ("sa", "sie"), ("za", "zie"), ("ła", "le"),
            ("ma", "mie"), ("pa", "pie"), ("ba", "bie"), ("wa", "wie"), ("fa", "fie"), ("va", "vie")]


def _locative(stem: str) -> str:
    low = stem.lower()
    if low.endswith(("k", "g", "ch", "h", "c", "cz", "sz", "rz", "ż", "dż", "j", "l", "x")):
        return stem + "u"
    for ending, replacement in _LOC_PALATAL:
        if low.endswith(ending):
            return stem[: len(stem) - len(ending)] + replacement
    return stem + "u"


def masculine_noun(nominative: str, stem: str | None = None) -> dict[str, str]:
    """Smith, Castro (stem Castr), Disney: -a, -owi, -em/-iem, palatalized locative."""
    stem = stem if stem is not None else nominative
    low = stem.lower()
    inst = stem + ("iem" if low.endswith(("k", "g")) else "em")
    loc = _locative(stem)
    return {"nom": nominative, "gen": stem + "a", "dat": stem + "owi", "acc": stem + "a",
            "inst": inst, "loc": loc, "voc": loc}


def feminine_noun(nominative: str) -> dict[str, str] | None:
    """-a and Polish/Ukrainian men's -o: Zaręby, Sharmie, Kościuszki, Fredrze."""
    low = nominative.lower()
    stem = nominative[:-1]
    soft = low.endswith(("ia", "ja", "la", "ca", "cza", "sza", "rza", "ża", "io", "jo", "lo", "co", "czo", "szo", "rzo", "żo"))
    gen = stem + ("i" if re.search(r"[kglj]$|i$", stem.lower()) else "y")
    if soft:
        dat = gen
    else:
        dat = None
        target = stem.lower() + "a"
        for ending, replacement in _FEM_DAT:
            if target.endswith(ending):
                dat = stem[: len(stem) - len(ending) + 1] + replacement
                break
        if dat is None:
            return None
    voc = stem + "o"
    return {"nom": nominative, "gen": gen, "dat": dat, "acc": stem + "ę", "inst": stem + "ą",
            "loc": dat, "voc": voc if low.endswith("a") else nominative}


def adjective_masculine(nominative: str, stem: str, soft: bool) -> dict[str, str]:
    """Verdi - Verdiego (soft), Goethe/Kary - Goethego/Karego, Chornyi - Chornego."""
    i = "i" if soft else ""
    return {"nom": nominative, "gen": stem + i + "ego", "dat": stem + i + "emu", "acc": stem + i + "ego",
            "inst": stem + ("im" if soft else ("em" if nominative.lower().endswith("e") else "ym")),
            "loc": stem + ("im" if soft else ("em" if nominative.lower().endswith("e") else "ym")),
            "voc": nominative}


def adjective_feminine(nominative: str) -> dict[str, str]:
    stem = nominative[:-1]
    soft = bool(re.search(r"(sk|ck|dzk|k|g)a$", nominative.lower()))
    oblique = stem + ("iej" if soft else "ej")
    return {"nom": nominative, "gen": oblique, "dat": oblique, "acc": stem + "ą", "inst": stem + "ą",
            "loc": oblique, "voc": nominative}


def same(nominative: str) -> dict[str, str]:
    return {case: nominative for case in CASES}


def masculine(nominative: str) -> tuple[dict[str, str], float, str] | None:
    """(paradigm, confidence, rule name) for a man's surname SGJP does not know."""
    low = nominative.lower()
    kind = origin(nominative)
    if len(low) < 2:
        return None
    if re.search(r"(ski|cki|dzki)$", low):
        return adjective_masculine(nominative, nominative[:-1], soft=True), 0.9, "adj-ski"
    if kind == "east-slavic" and re.search(r"(sk|ck|tsk|zk)yi$", low):
        # Kovalskyi as Kowalski (PWN 78.C.2): Kovalskiego.
        return adjective_masculine(nominative, nominative[:-2], soft=True), 0.7, "ukr-skyi"
    if kind == "east-slavic" and re.search(r"[" + CONSONANT + "]yi$", low):
        # Chornyi as Czorny (PWN 78.C.2): Chornego, Chornemu, Chornym.
        return adjective_masculine(nominative, nominative[:-2], soft=False), 0.7, "ukr-yi"
    if re.search(r"[" + CONSONANT + "]e[kc]$", low) and len(low) > 4:
        # The e drops (Mrożek - Mrożka, Kowalec - Kowalca), the form the norm
        # prefers for surnames; Filipeka/Kowaleca are only tolerated.
        stem = nominative[:-2] + nominative[-1]
        return masculine_noun(nominative, stem) | {"nom": nominative}, 0.8, "spółgłoska -ek/-ec"
    if re.search(r"[" + CONSONANT + "]$", low):
        return masculine_noun(nominative), 0.85, "spółgłoska"
    if kind in NOT_INFLECTED_ORIGINS and low[-1] in "eiouy":
        return same(nominative), 0.85, "nieodmienne-" + kind
    if low.endswith("u"):
        return same(nominative), 0.8, "-u nieodmienne"
    if low.endswith("o") and len(low) > 2:
        if low.endswith(("ko", "ło")) or kind in {"pl", "east-slavic"}:
            rule = feminine_noun(nominative)
            return (rule, 0.85, "-o żeńska (Kościuszko)") if rule else None
        if low[-2] in "aeiouy":
            return same(nominative), 0.6, "-o po samogłosce"
        return masculine_noun(nominative, nominative[:-1]), 0.75, "-o męska (Caruso)"
    if low.endswith("a") and len(low) > 2:
        rule = feminine_noun(nominative)
        return (rule, 0.8, "-a (Zaręba)") if rule else None
    if re.search(r"[aeiou]y$", low):
        return masculine_noun(nominative), 0.8, "-y po samogłosce (Disney)"
    if re.search(r"[" + CONSONANT + "]y$", low):
        if kind == "germanic":
            return adjective_masculine(nominative, nominative + "’", soft=False) | {
                "inst": nominative + "’m", "loc": nominative + "’m"}, 0.55, "-y angielskie (Kennedy’ego)"
        return adjective_masculine(nominative, nominative[:-1], soft=False), 0.75, "-y przymiotnikowe"
    if re.search(r"[" + CONSONANT + "]i$", low):
        if kind == "east-slavic":
            return None  # Babii, Palii: nouns in -ій; the transliteration hides the stem.
        return adjective_masculine(nominative, nominative[:-1], soft=True), 0.75, "-i przymiotnikowe (Verdi)"
    if re.search(r"[" + CONSONANT + "]e$", low):
        conf = 0.75 if kind in {"germanic", "pl"} else 0.55
        return adjective_masculine(nominative, nominative[:-1], soft=False), conf, "-e przymiotnikowe (Goethe)"
    return None


def feminine(nominative: str, men_count) -> tuple[dict[str, str], float, str] | None:
    """A woman's surname; men_count(surname) is how many men bear it (PESEL)."""
    low = nominative.lower()
    if len(low) < 2:
        return None
    if re.search(r"(ska|cka|dzka)$", low):
        return adjective_feminine(nominative), 0.9, "adj-ska"
    if not low.endswith("a"):
        if re.search(r"(ski|cki|dzki)$", low):
            return None  # a man's form registered for a woman: left for review
        return same(nominative), 0.9, "nieodmienne (żeńskie nie na -a)"
    stem = nominative[:-1]
    if low.endswith(("owa", "ewa", "ova", "eva")) and len(low) > 4:
        # Russian and Bulgarian -ova/-eva like the Polish -owa (Iwanowa - Iwanowej).
        return adjective_feminine(nominative), 0.85, "-owa/-ova"
    if any(men_count(stem + ending) for ending in ("yi", "ii", "yj", "ij", "y")):
        return adjective_feminine(nominative), 0.8, "-a para przymiotnikowa (Chorna/Chornyi)"
    rule = feminine_noun(nominative)
    if not rule:
        return None
    if men_count(nominative):
        return rule, 0.8, "-a rzeczownikowe (to samo u mężczyzn)"
    return rule, 0.5, "-a niepewne (rzeczownik czy przymiotnik)"
