"""Builds given_names_pesel.tsv: first given names of living persons in the PESEL register.

Source (public, aggregate): dane.gov.pl "Lista imion męskich / żeńskich w rejestrze
PESEL - imię pierwsze" (stan na 22.01.2025, resources 63916 and 63924): name, sex,
count (names borne by at least two persons). Download both .xlsx files and run:

    python build_given_name_base.py imiona-meskie.xlsx imiona-zenskie.xlsx given_names_pesel.tsv

Output as in surnames_pesel.tsv: "name<TAB>men<TAB>women", lowercase, sorted by
UTF-8 bytes (binary search in surname_base.SurnameBase). No person data.
"""

from __future__ import annotations

import sys
from collections import defaultdict


def rows(path: str):
    import openpyxl

    sheet = openpyxl.load_workbook(path, read_only=True).active
    for index, row in enumerate(sheet.iter_rows(values_only=True)):
        # IMIĘ_PIERWSZE, PŁEĆ, LICZBA_WYSTĄPIEŃ
        if index == 0 or not row or not row[0] or row[-1] is None:
            continue
        yield str(row[0]).strip(), int(row[-1])


def main() -> None:
    men_path, women_path, output = sys.argv[1:4]
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for column, path in ((0, men_path), (1, women_path)):
        for name, count in rows(path):
            key = " ".join(name.lower().split())
            if key:
                counts[key][column] += count
    lines = sorted(f"{key}\t{men}\t{women}\n".encode("utf-8") for key, (men, women) in counts.items())
    with open(output, "wb") as handle:
        handle.writelines(lines)
    print(output, len(lines))


if __name__ == "__main__":
    main()
