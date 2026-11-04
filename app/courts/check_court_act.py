#!/usr/bin/env python3
"""Is the court base still the law? Checks the court regulation in ELI (api.sejm.gov.pl).

The base (app/lex-runtime/src/courts/court-base-data.ts) is built from one consolidated text of
the regulation of the Minister of Justice of 28.12.2018 on the seats and areas of the common
courts and the kinds of cases they hear (ELI DU/2018/2548); amendments published after it are
kept in court-base-amendments.ts with the day they enter into force. Fails (exit 1) when ELI
lists a newer consolidated text or an amending act the base does not know, with what to do.

  python3 app/courts/check_court_act.py
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ACT = "DU/2018/2548"
RUNTIME = Path(__file__).resolve().parents[1] / "lex-runtime" / "src" / "courts"
API = "https://api.sejm.gov.pl/eli/acts/"


def eli(identifier: str) -> dict:
    request = urllib.request.Request(API + identifier, headers={"User-Agent": "LexMachina-court-base-check/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def main() -> int:
    data = (RUNTIME / "court-base-data.ts").read_text(encoding="utf-8")
    base = json.loads(data[data.index("= {") + 2 : data.rindex("}") + 1])
    base_tj = re.search(r"eli/acts/(DU/\d{4}/\d+)", base["zrodla"]["eli"]).group(1)
    known = set(re.findall(r'eli: "(DU/\d{4}/\d+)"', (RUNTIME / "court-base-amendments.ts").read_text(encoding="utf-8")))
    act = eli(ACT)
    refs = act.get("references") or {}
    tj = eli(base_tj)
    tj_published = tj.get("promulgation") or tj.get("announcementDate") or ""
    problems = []
    newer_tj = []
    for item in refs.get("Inf. o tekście jednolitym", []):
        if item["id"] == base_tj:
            continue
        detail = eli(item["id"])
        if (detail.get("promulgation") or "") > tj_published:
            newer_tj.append(f'{item["id"]} ({detail.get("promulgation")})')
    if newer_tj:
        problems.append(f"Nowy tekst jednolity: {', '.join(newer_tj)}. Przebuduj bazę (build_court_base.py --act z nowego tekstu) i opróżnij court-base-amendments.ts.")
    for item in refs.get("Akty zmieniające", []):
        if item["id"] in known:
            continue
        detail = eli(item["id"])
        if (detail.get("promulgation") or "") <= tj_published:
            continue
        problems.append(
            f'Zmiana po t.j. {base_tj}: {item["id"]} (ogłoszona {detail.get("promulgation")}, w życie {item.get("date") or detail.get("entryIntoForce")}): '
            f'{detail.get("title", "")[:160]}. Tekst: {API}{item["id"]}/text.pdf. Dodaj ją do court-base-amendments.ts.'
        )
    print(f"Akt {ACT}: stan w ELI {act.get('changeDate', '')[:10]}; baza: t.j. {base_tj} + {len(known)} zmian(y) {sorted(known)}")
    for problem in problems:
        print("BRAK:", problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
