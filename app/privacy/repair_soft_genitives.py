"""Repairs localities_teryt.tsv after the soft-consonant bug of build_address_base._apply
(fixed there): Poznań had "Poznia", Toruń no genitive. A genitive is replaced only when
SGJP (Morfeusz2) knows the name as a proper noun and the stored genitive is exactly
what the old _apply made of SGJP's genitive, or is missing.

Run: python repair_soft_genitives.py [localities_teryt.tsv]
"""
from __future__ import annotations

import sys
from pathlib import Path

import morfeusz2


def old_apply(word: str, ending: str) -> str | None:
    low, end = word.lower(), ending.lower()
    for size in (3, 2, 1):
        if len(end) < size:
            continue
        at = low.rfind(end[:size])
        if at > 0:
            return word[:at] + ending
    return None


def sgjp_genitives(engine: morfeusz2.Morfeusz, name: str) -> list[str]:
    out = []
    for _s, _e, (_orth, lemma, tag, names, _q) in engine.analyse(name):
        if lemma.split(":")[0] != name or not tag.startswith("subst:sg:nom") or not any("geograficzna" in n for n in names):
            continue
        for orth, _lem, gtag, _n, _q in engine.generate(lemma):
            if gtag.startswith("subst:sg:gen") and orth not in out:
                out.append(orth)
    return out


def main() -> None:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).with_name("localities_teryt.tsv"))
    engine = morfeusz2.Morfeusz()
    rows, fixed = [], []
    for line in path.read_text(encoding="utf-8").splitlines():
        fold, name, count, towns, gens = (line.split("\t") + [""] * 5)[:5]
        if " " not in name and "-" not in name and name[-1:] in "ńćśź":
            sgjp = sgjp_genitives(engine, name)
            stored = [g.rpartition(":")[0] for g in gens.split("|") if g]
            if sgjp:
                good = sgjp[0]
                # The old _apply's result for SGJP's genitive: the ending after the stem.
                for size in range(1, 4):
                    ending = good[len(name) - size:] if len(good) > len(name) - size else None
                    if ending and old_apply(name, ending) in stored:
                        break
                else:
                    ending = None
                if not stored or ending:
                    new = f"{good}:{count}"
                    fixed.append(f"{name}: {gens or '-'} -> {new}")
                    gens = new
        rows.append("\t".join([fold, name, count, towns, gens]))
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(len(fixed), "naprawionych:", *fixed[:40], sep="\n")


if __name__ == "__main__":
    main()
