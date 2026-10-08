"""Builds surnames_pesel.tsv: surnames of living persons in the PESEL register.

Source (public, aggregate): dane.gov.pl dataset 1681 "Nazwiska osób żyjących
występujące w rejestrze PESEL" - two sheets, men and women, surname + count
(surnames used by at least two persons). Download both .xlsx files and run:

    python build_surname_base.py nazwiska-meskie.xlsx nazwiska-zenskie.xlsx surnames_pesel.tsv

Output: one line per surname, lowercase, sorted by UTF-8 bytes (binary search
in surname_base.py): "surname<TAB>men<TAB>women". No person data: a surname
and how many men and women bear it.
"""

from __future__ import annotations

import sys
from collections import defaultdict


def rows(path: str):
    import openpyxl

    sheet = openpyxl.load_workbook(path, read_only=True).active
    for index, row in enumerate(sheet.iter_rows(values_only=True)):
        if index == 0 or not row or not row[0] or row[1] is None:
            continue
        yield str(row[0]).strip(), int(row[1])


def main() -> None:
    men_path, women_path, output = sys.argv[1:4]
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for column, path in ((0, men_path), (1, women_path)):
        for surname, count in rows(path):
            key = " ".join(surname.lower().split())
            if key:
                counts[key][column] += count
    lines = sorted(f"{key}\t{men}\t{women}\n".encode("utf-8") for key, (men, women) in counts.items())
    with open(output, "wb") as handle:
        handle.writelines(lines)
    print(output, len(lines))


if __name__ == "__main__":
    main()
