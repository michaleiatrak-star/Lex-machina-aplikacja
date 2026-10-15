"""Given names of the PESEL register (given_names_pesel.tsv, build_given_name_base.py).

SGJP knows about a tenth of the first names in PESEL (4 298 of 44 675 men's,
2 089 of 26 811 women's): not Oleksandr, Tetiana, Juneyoung. The register says
whether a word is a given name and for which sex; the file has the format of
surnames_pesel.tsv and is searched the same way.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import surname_base

DEFAULT_PATH = Path(__file__).with_name("given_names_pesel.tsv")


@lru_cache(maxsize=1)
def default_base() -> surname_base.SurnameBase:
    return surname_base.SurnameBase(DEFAULT_PATH, env="LEX_GIVEN_NAME_BASE")


@lru_cache(maxsize=65536)
def counts(word: str) -> tuple[int, int]:
    """(men, women) bearing `word` or the nominative it is a case form of
    ("Oleksandrowi" -> Oleksandr, "Tetiany" -> Tetiana); (0, 0) when unknown."""
    base = default_base()
    if not base.available or not word[:1].isalpha():
        return 0, 0
    men = max((n for _, _, n in surname_base.nominatives(word, "m1", base)), default=0)
    women = max((n for _, _, n in surname_base.nominatives(word, "f", base)), default=0)
    return men, women


def is_given_name(word: str) -> bool:
    """A PESEL given name borne more often as a given name than as a surname."""
    men, women = counts(word)
    given = max(men, women)
    if given < 2:
        return False
    surname = max(surname_base.default_base().counts(word) or (0, 0))
    return given >= surname
