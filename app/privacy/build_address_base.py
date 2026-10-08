"""Builds the address registers: localities_teryt.tsv and streets_teryt.tsv.

Sources (public):
- GUS TERYT, "pliki pełne", urzędowy: SIMC (localities) and ULIC (streets),
  eteryt.stat.gov.pl -> Udostępnianie danych -> Baza TERYT -> pliki pełne.
- GUGiK PRNG, urzędowe nazwy miejscowości (opendata.geoportal.gov.pl/prng/
  PRNG_MIEJSCOWOSCI_XLSX.zip): the official genitive of each name
  (Dz.U. 2013 poz. 200), linked to SIMC by its identifier.

    python build_address_base.py SIMC.csv ULIC.csv PRNG_MIEJSCOWOSCI.xlsx OUTPUT_DIR

localities_teryt.tsv: "fold<TAB>name<TAB>localities<TAB>towns<TAB>genitive:n|genitive:n"
streets_teryt.tsv:    "fold<TAB>name<TAB>cecha:n|cecha:n<TAB>localities"
Sorted by fold (lowercase, no diacritics) for prefix search in address_base.py.
"""

from __future__ import annotations

import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from address_base import fold  # noqa: E402


def expand_genitive(name: str, notation: str) -> str | None:
    """PRNG notation -> genitive: "Ciemna Wola" + "-nej -li" -> "Ciemnej Woli".

    A token starting with "-" is an ending that replaces the tail of the word
    from the last place the ending's first letters occur; other tokens are
    whole words. Hyphenated names carry one notation ("-wic-Gór").
    """
    words = name.split(" ")
    notes = notation.split(" ")
    if len(notes) != len(words):
        return None
    out = []
    for word, note in zip(words, notes):
        if not note.startswith("-") and not (note[:1].islower() and word[:1].isupper()):
            out.append(note)
            continue
        # "łego" for "-łego": a dash the register left out.
        note = note if note.startswith("-") else "-" + note
        parts = word.split("-")
        endings = note[1:].split("-")
        if len(endings) != len(parts):
            # "-ki" for a hyphenated word: the ending applies to the last part.
            if len(endings) != 1:
                return None
            replaced = parts[:-1] + [_apply(parts[-1], endings[-1])]
        else:
            replaced = [_apply(parts[0], endings[0])] + [
                e if e[:1].isupper() else _apply(p, e) for p, e in zip(parts[1:], endings[1:])
            ]
        if any(r is None for r in replaced):
            return None
        out.append("-".join(replaced))
    return " ".join(out)


def _apply(word: str, ending: str) -> str | None:
    low, end = word.lower(), ending.lower()
    for size in (3, 2, 1):
        if len(end) < size:
            continue
        at = low.rfind(end[:size])
        if at > 0:
            return word[:at] + ending
    return None


def main() -> None:
    simc_path, ulic_path, prng_path, out_dir = sys.argv[1:5]
    out = Path(out_dir)
    simc = list(csv.DictReader(open(simc_path, encoding="utf-8-sig"), delimiter=";"))

    genitive_of: dict[str, str] = {}
    import openpyxl

    sheet = openpyxl.load_workbook(prng_path, read_only=True)["PRNG_MIEJSCOWOSCI_XLS"]
    for index, row in enumerate(sheet.iter_rows(values_only=True)):
        if index == 0 or row[7] != "urzędowa" or row[13] != "TERYT (SIMC)" or not row[5]:
            continue
        symbol = str(row[14]).zfill(7)
        genitive = expand_genitive(str(row[2]), str(row[5]).strip())
        if genitive:
            genitive_of[symbol] = genitive

    localities: dict[str, list] = {}
    for row in simc:
        name = row["NAZWA"].strip()
        entry = localities.setdefault(name, [0, 0, Counter()])
        entry[0] += 1
        entry[1] += row["RM"] == "96"
        if row["SYM"] in genitive_of:
            entry[2][genitive_of[row["SYM"]]] += 1
    lines = sorted((
        f"{fold(name)}\t{name}\t{n}\t{towns}\t{'|'.join(f'{g}:{c}' for g, c in gens.most_common())}\n"
        for name, (n, towns, gens) in localities.items()
    ), key=lambda line: line.encode("utf-8"))
    (out / "localities_teryt.tsv").write_bytes("".join(lines).encode("utf-8"))
    print("localities", len(lines), "with genitive", sum(1 for v in localities.values() if v[2]))

    streets: dict[str, list] = defaultdict(lambda: [Counter(), set()])
    for row in csv.DictReader(open(ulic_path, encoding="utf-8-sig"), delimiter=";"):
        main_name = re.sub(r"\s+", " ", row["NAZWA_1"]).strip()
        prefix = re.sub(r"\s+", " ", row["NAZWA_2"]).strip()
        for name in {main_name, f"{prefix} {main_name}".strip()}:
            if name:
                streets[name][0][row["CECHA"]] += 1
                streets[name][1].add(row["SYM"])
    lines = sorted((
        f"{fold(name)}\t{name}\t{'|'.join(f'{c}:{n}' for c, n in kinds.most_common())}\t{len(places)}\n"
        for name, (kinds, places) in streets.items()
    ), key=lambda line: line.encode("utf-8"))
    (out / "streets_teryt.tsv").write_bytes("".join(lines).encode("utf-8"))
    print("streets", len(lines))


if __name__ == "__main__":
    main()
