"""Surnames of the PESEL register (surnames_pesel.tsv, build_surname_base.py).

Morfeusz2/SGJP knows the surnames of 82% of the people in PESEL but only 15-18%
of the different surnames: rare Polish ones ("Klejny" as a nominative) and most
foreign ones (Tkachuk, Shevchenko, Nguyen, Sharma). For those the register is
the authority on whether a word is a surname and for which gender, which lets
an inflected form ("Tkachukiem", "Sharmy") be traced back to its nominative.

The file is searched in place (binary search over a memory map): no load time
for the one-shot workers that use it.
"""

from __future__ import annotations

import mmap
import os
import re
from functools import lru_cache
from pathlib import Path

DEFAULT_PATH = Path(__file__).with_name("surnames_pesel.tsv")


class SurnameBase:
    def __init__(self, path: Path | None = None) -> None:
        override = os.environ.get("LEX_SURNAME_BASE", "").strip()
        self.path = Path(override) if override else (path or DEFAULT_PATH)
        self._map: mmap.mmap | None = None
        if self.path.is_file() and self.path.stat().st_size:
            with open(self.path, "rb") as handle:
                self._map = mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)

    @property
    def available(self) -> bool:
        return self._map is not None

    def _line_at(self, offset: int) -> tuple[int, bytes, int]:
        """(start, line, next start) of the line containing offset."""
        data = self._map
        assert data is not None
        start = data.rfind(b"\n", 0, offset) + 1
        end = data.find(b"\n", offset)
        if end < 0:
            end = len(data)
        return start, data[start:end], end + 1

    def counts(self, surname: str) -> tuple[int, int] | None:
        """(men, women) bearing the surname, or None when it is not in PESEL."""
        if self._map is None:
            return None
        return self._counts(" ".join(surname.lower().split()))

    @lru_cache(maxsize=65536)
    def _counts(self, key: str) -> tuple[int, int] | None:
        target = key.encode("utf-8")
        lo, hi = 0, len(self._map)
        while lo < hi:
            mid = (lo + hi) // 2
            start, line, after = self._line_at(mid)
            name, _, rest = line.partition(b"\t")
            if name == target:
                men, _, women = rest.partition(b"\t")
                return int(men), int(women)
            if name < target:
                lo = after
            else:
                hi = start
        return None

    def count(self, surname: str, gender: str) -> int:
        found = self.counts(surname)
        if not found:
            return 0
        return found[0] if gender == "m1" else found[1]


@lru_cache(maxsize=1)
def default_base() -> SurnameBase:
    return SurnameBase()


from foreign_surnames import origin  # noqa: E402  (re-exported)


# --- inflected form -> nominative -------------------------------------------

CASES = ("nom", "gen", "dat", "acc", "inst", "loc", "voc")
_PALATAL_LOC = [("strze", "str"), ("ście", "st"), ("ździe", "zd"), ("śle", "sł"), ("rze", "r"),
                ("cie", "t"), ("dzie", "d"), ("nie", "n"), ("sie", "s"), ("zie", "z"), ("le", "ł"),
                ("mie", "m"), ("pie", "p"), ("bie", "b"), ("wie", "w"), ("fie", "f"), ("vie", "v")]
_FEM_DAT_REVERSE = [("ce", "ka"), ("dze", "ga"), ("sze", "cha"), ("rze", "ra"), ("cie", "ta"),
                    ("dzie", "da"), ("nie", "na"), ("sie", "sa"), ("zie", "za"), ("le", "ła"),
                    ("mie", "ma"), ("pie", "pa"), ("bie", "ba"), ("wie", "wa"), ("fie", "fa"), ("vie", "va")]


def _mobile_e(stem: str) -> list[str]:
    """Filipk -> Filipek, Kowalc -> Kowalec (the e that drops in inflection)."""
    if len(stem) >= 3 and stem[-1] in "kcłńr" and stem[-2] not in "aeiouyąęó":
        return [stem[:-1] + "e" + stem[-1]]
    return []


def _readings(word: str, gender: str) -> list[tuple[str, set[str]]]:
    """(candidate nominative, cases) for an inflected form; not checked yet.
    The inverse of foreign_surnames' paradigms."""
    w = word
    found: list[tuple[str, set[str]]] = [(w, {"nom"})]
    # Kennedy’ego, Wayne’a: the apostrophe separates the ending.
    for mark in ("’", "'"):
        if mark in w:
            head, _, tail = w.rpartition(mark)
            if head and tail.isalpha():
                found.append((head, {"gen", "dat", "acc", "inst", "loc"}))
    low = w.lower()

    def noun_stem(stem: str, cases: set[str]) -> None:
        # Smith, Castro (Castr-a), Filipek (Filipk-a).
        if len(stem) >= 2:
            found.append((stem, cases))
            found.append((stem + "o", cases))
            for alt in _mobile_e(stem):
                found.append((alt, cases))

    def feminine_stem(stem: str, cases: set[str]) -> None:
        # Sharma, Zaręba; men's -o: Fredro, Boiko.
        if len(stem) >= 2:
            found.append((stem + "a", cases))
            found.append((stem + "o", cases))

    if gender == "m1":
        for ending, cases in (("owi", {"dat"}), ("iem", {"inst"}), ("em", {"inst"}), ("a", {"gen", "acc"}),
                              ("u", {"loc", "voc"})):
            if low.endswith(ending):
                noun_stem(w[: len(w) - len(ending)], cases)
        for ending, base in _PALATAL_LOC:
            if low.endswith(ending):
                noun_stem(w[: len(w) - len(ending)] + base, {"loc", "voc"})
        # Adjectival: Verdiego, Goethego, Karego, Chornego, Kovalskiego.
        for ending, cases in (("iego", {"gen", "acc"}), ("iemu", {"dat"}), ("im", {"inst", "loc"})):
            if low.endswith(ending):
                stem = w[: len(w) - len(ending)]
                found += [(stem + "i", cases), (stem + "yi", cases)]
        for ending, cases in (("ego", {"gen", "acc"}), ("emu", {"dat"}), ("em", {"inst", "loc"}), ("ym", {"inst", "loc"})):
            if low.endswith(ending):
                stem = w[: len(w) - len(ending)]
                found += [(stem + "e", cases), (stem + "y", cases), (stem + "yi", cases)]
    else:
        for ending, cases in (("iej", {"gen", "dat", "loc"}), ("ej", {"gen", "dat", "loc"}), ("ą", {"acc", "inst"})):
            if low.endswith(ending):
                found.append((w[: len(w) - len(ending)] + "a", cases))
    for ending, cases in (("y", {"gen"}), ("i", {"gen", "dat", "loc"}), ("ę", {"acc"}), ("ą", {"inst"}),
                          ("o", {"voc"})):
        if low.endswith(ending):
            feminine_stem(w[: len(w) - len(ending)], cases)
    for ending, base in _FEM_DAT_REVERSE:
        if low.endswith(ending):
            feminine_stem(w[: len(w) - len(ending)] + base[:-1], {"dat", "loc"})
    return found


def nominatives(word: str, gender: str, base: SurnameBase | None = None) -> list[tuple[str, set[str], int]]:
    """Nominatives in PESEL that `word` can be a case form of, for `gender`
    (m1 or f), most frequent first: [(nominative, cases, persons)]."""
    base = base or default_base()
    if not base.available or not word[:1].isalpha():
        return []
    def persons(nominative: str) -> int:
        found = base.count(nominative, gender)
        # A consonant-final surname is one for men and women (Nowak): one
        # registered for women only is still a man's surname.
        if not found and gender == "m1" and re.search(r"[bcćdfghjklłmnprsśtwzźż]$", nominative.lower()):
            found = base.count(nominative, "f")
        return found

    merged: dict[str, set[str]] = {}
    for nominative, cases in _readings(word, gender):
        if persons(nominative) > 0:
            merged.setdefault(nominative, set()).update(cases)
    ranked = [(nom, cases, persons(nom)) for nom, cases in merged.items()]
    return sorted(ranked, key=lambda item: (item[0].lower() != word.lower(), -item[2]))
