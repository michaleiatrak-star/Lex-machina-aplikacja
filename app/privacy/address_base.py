"""Localities and streets of the TERYT register (build_address_base.py).

localities_teryt.tsv: every locality name of SIMC with the official genitive
(PRNG); streets_teryt.tsv: every street name of ULIC with its kinds (ul., al.,
pl. ...). Both are sorted by a folded key (lowercase, no diacritics) and
searched in place: exact lookups and prefix scans, which is what tracing an
inflected form ("Pcimiu", "Ponikwi") back to its nominative needs.
"""

from __future__ import annotations

import mmap
import os
import unicodedata
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).parent


def fold(text: str) -> str:
    # ą and ę alternate in a paradigm (Dąb - Dębu): one letter for both.
    text = text.lower().replace("ł", "l").replace("ą", "e").replace("ę", "e")
    return "".join(ch for ch in unicodedata.normalize("NFD", text) if not unicodedata.combining(ch))


class FoldedTsv:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._map: mmap.mmap | None = None
        if path.is_file() and path.stat().st_size:
            with open(path, "rb") as handle:
                self._map = mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)

    @property
    def available(self) -> bool:
        return self._map is not None

    def _lower_bound(self, key: bytes) -> int:
        data = self._map
        lo, hi = 0, len(data)
        while lo < hi:
            mid = (lo + hi) // 2
            start = data.rfind(b"\n", 0, mid) + 1
            end = data.find(b"\n", mid)
            end = len(data) if end < 0 else end
            if data[start:end].split(b"\t", 1)[0] < key:
                lo = end + 1
            else:
                hi = start
        return lo

    def rows(self, prefix: str, exact: bool = False, limit: int = 20000) -> list[list[str]]:
        """Rows whose folded key starts with (or equals) `prefix`."""
        if self._map is None or not prefix:
            return []
        key = prefix.encode("utf-8")
        data = self._map
        position = self._lower_bound(key)
        found = []
        while position < len(data) and len(found) < limit:
            end = data.find(b"\n", position)
            end = len(data) if end < 0 else end
            line = data[position:end]
            head = line.split(b"\t", 1)[0]
            if not head.startswith(key) or (exact and head != key):
                break
            found.append(line.decode("utf-8").split("\t"))
            position = end + 1
        return found


class Locality:
    __slots__ = ("name", "count", "towns", "genitives")

    def __init__(self, row: list[str]) -> None:
        self.name = row[1]
        self.count = int(row[2])
        self.towns = int(row[3])
        self.genitives = [(g, int(n)) for g, _, n in (item.rpartition(":") for item in row[4].split("|") if item)]

    def __repr__(self) -> str:
        return f"Locality({self.name!r}, {self.count}, {self.genitives})"


class AddressBase:
    def __init__(self, directory: Path | None = None) -> None:
        override = os.environ.get("LEX_ADDRESS_BASE_DIR", "").strip()
        root = Path(override) if override else (directory or HERE)
        self.localities = FoldedTsv(root / "localities_teryt.tsv")
        self.streets = FoldedTsv(root / "streets_teryt.tsv")

    @property
    def available(self) -> bool:
        return self.localities.available

    @lru_cache(maxsize=65536)
    def locality(self, name: str) -> Locality | None:
        for row in self.localities.rows(fold(name), exact=True):
            if row[1] == name:
                return Locality(row)
        return None

    @lru_cache(maxsize=16384)
    def localities_with_prefix(self, prefix: str) -> tuple[Locality, ...]:
        return tuple(Locality(row) for row in self.localities.rows(fold(prefix)))

    @lru_cache(maxsize=65536)
    def street(self, name: str) -> dict[str, int] | None:
        """Kinds (ul., al., pl. ...) of a street name as ULIC writes it, or None."""
        for row in self.streets.rows(fold(name), exact=True):
            if row[1].lower() == name.lower():
                return {c: int(n) for c, _, n in (item.rpartition(":") for item in row[2].split("|") if item)}
        return None

    @lru_cache(maxsize=16384)
    def streets_with_prefix(self, prefix: str) -> tuple[tuple[str, dict[str, int]], ...]:
        return tuple(
            (row[1], {c: int(n) for c, _, n in (item.rpartition(":") for item in row[2].split("|") if item)})
            for row in self.streets.rows(fold(prefix))
        )


@lru_cache(maxsize=1)
def default_base() -> AddressBase:
    return AddressBase()
